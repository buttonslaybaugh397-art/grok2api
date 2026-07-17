package web

import (
	"net/url"
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/chenyme/grok2api/backend/internal/domain/account"
	domainegress "github.com/chenyme/grok2api/backend/internal/domain/egress"
	"github.com/chenyme/grok2api/backend/internal/infra/egress"
	"github.com/chenyme/grok2api/backend/internal/infra/provider"
)

func (a *Adapter) GenerateVideo(ctx context.Context, request provider.VideoRequest) (provider.VideoResult, error) {
	cfg := a.config()
	token, err := a.cipher.Decrypt(request.Credential.EncryptedAccessToken)
	if err != nil {
		return provider.VideoResult{}, err
	}
	lease, err := a.egress.Acquire(ctx, domainegress.ScopeWeb, fmt.Sprintf("%d", request.Credential.ID))
	if err != nil {
		return provider.VideoResult{}, err
	}
	defer lease.Release()
	parentID := ""
	references := make([]string, 0, len(request.ReferenceURLs))
	for _, rawReference := range request.ReferenceURLs {
		reference, referenceErr := a.prepareVideoReference(ctx, cfg, lease, token, rawReference)
		if referenceErr != nil {
			return provider.VideoResult{}, referenceErr
		}
		references = append(references, reference)
	}
	if len(references) > 0 {
		parentID, err = a.createMediaPost(ctx, cfg, lease, token, "MEDIA_POST_TYPE_IMAGE", references[0], "")
	} else {
		parentID, err = a.createMediaPost(ctx, cfg, lease, token, "MEDIA_POST_TYPE_VIDEO", "", request.Prompt)
	}
	if err != nil {
		return provider.VideoResult{}, err
	}
	segments := videoSegments(request.Duration)
	if len(segments) == 0 {
		return provider.VideoResult{}, fmt.Errorf("duration 必须在 1 到 15 秒之间")
	}
	ratio := resolveAspectRatio(request.AspectRatio)
	resolution := request.Resolution
	if resolution == "" {
		resolution = "720p"
	}
	payload := videoCreatePayload(request.Prompt, parentID, ratio, resolution, segments[0], references)
	response, err := a.postJSON(ctx, cfg, lease, token, cfg.BaseURL+"/rest/app-chat/conversations/new", payload, time.Duration(cfg.VideoTimeoutSeconds)*time.Second)
	if err != nil {
		return provider.VideoResult{}, err
	}
	result, _, parseErr := parseVideoStream(response, request.Progress)
	_ = response.Body.Close()
	if parseErr != nil {
		return provider.VideoResult{}, parseErr
	}
	if result.URL == "" {
		return provider.VideoResult{}, fmt.Errorf("???? URL ????")
	}
	return result, nil
}

func (a *Adapter) prepareVideoReference(ctx context.Context, cfg Config, lease *egress.Lease, token, value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", fmt.Errorf("视频参考图片 URL 不能为空")
	}
	image, err := a.loadChatImage(ctx, lease, value, 20<<20)
	if err != nil {
		return "", err
	}
	uploaded, err := a.uploadImage(ctx, cfg, lease, token, image, cfg.BaseURL+"/imagine")
	if err != nil {
		return "", err
	}
	if uploaded.URI == "" {
		return "", fmt.Errorf("上传视频参考图片后未返回 fileUri")
	}
	return uploaded.URI, nil
}

func parseVideoStream(response *http.Response, progress func(int)) (provider.VideoResult, string, error) {
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(response.Body, 1<<20))
		if response.StatusCode == http.StatusUnauthorized {
			return provider.VideoResult{}, "", provider.ErrUnauthorized
		}
		return provider.VideoResult{}, "", fmt.Errorf("视频上游返回 %d: %s", response.StatusCode, strings.TrimSpace(string(body)))
	}
	var result provider.VideoResult
	var postID string
	handle := func(root map[string]any) (bool, error) {
		if errorValue, ok := root["error"].(map[string]any); ok {
			return false, fmt.Errorf("视频上游错误: %v", errorValue["message"])
		}
		stream := nestedMap(root, "result", "response", "streamingVideoGenerationResponse")
		if stream == nil {
			return false, nil
		}
		if value, ok := numberAsInt(stream["progress"]); ok && progress != nil {
			progress(value)
		}
		if value, _ := stream["videoPostId"].(string); value != "" {
			postID = value
		} else if value, _ := stream["videoId"].(string); value != "" {
			postID = value
		}
		moderated, _ := stream["moderated"].(bool)
		if moderated {
			return false, nil
		}
		if value, _ := stream["videoUrl"].(string); value != "" {
			result.URL = absoluteAssetURL(value)
			result.ContentType = "video/mp4"
			return true, nil
		}
		return false, nil
	}

	reader := bufio.NewReader(response.Body)
	prefix, _ := reader.Peek(64)
	trimmedPrefix := strings.TrimSpace(string(prefix))
	var err error
	if strings.HasPrefix(trimmedPrefix, "data:") || strings.HasPrefix(trimmedPrefix, "event:") {
		err = consumeVideoSSE(reader, handle)
	} else {
		err = consumeVideoJSON(reader, handle)
	}
	if err != nil {
		return provider.VideoResult{}, "", err
	}
	return result, postID, nil
}

func consumeVideoSSE(reader io.Reader, handle func(map[string]any) (bool, error)) error {
	scanner := bufio.NewScanner(reader)
	scanner.Buffer(make([]byte, 64<<10), 8<<20)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if strings.HasPrefix(line, "data:") {
			line = strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		}
		if line == "" || line == "[DONE]" || !strings.HasPrefix(line, "{") {
			continue
		}
		var root map[string]any
		if json.Unmarshal([]byte(line), &root) != nil {
			continue
		}
		complete, err := handle(root)
		if err != nil {
			return err
		}
		if complete {
			return nil
		}
	}
	return scanner.Err()
}

func consumeVideoJSON(reader io.Reader, handle func(map[string]any) (bool, error)) error {
	decoder := json.NewDecoder(io.LimitReader(reader, 64<<20))
	for {
		var root map[string]any
		if err := decoder.Decode(&root); err != nil {
			if err == io.EOF {
				return nil
			}
			return fmt.Errorf("解析视频上游流: %w", err)
		}
		complete, err := handle(root)
		if err != nil {
			return err
		}
		if complete {
			return nil
		}
	}
}

func nestedMap(value map[string]any, keys ...string) map[string]any {
	current := value
	for _, key := range keys {
		next, ok := current[key].(map[string]any)
		if !ok {
			return nil
		}
		current = next
	}
	return current
}

func videoSegments(seconds int) []int {
	if seconds < 1 || seconds > 15 {
		return nil
	}
	return []int{seconds}
}

func videoCreatePayload(prompt, parentID, ratio, resolution string, seconds int, references []string) map[string]any {
	config := map[string]any{"parentPostId": parentID, "aspectRatio": ratio, "videoLength": seconds, "resolutionName": resolution}
	if len(references) > 0 {
		config["isVideoEdit"] = false
		config["isReferenceToVideo"] = true
		config["imageReferences"] = references
	}
	return map[string]any{
		"temporary": true, "modelName": "imagine-video-gen", "message": prompt + " --mode=custom", "enableSideBySide": true,
		"responseMetadata": map[string]any{"experiments": []any{}, "modelConfigOverride": map[string]any{"modelMap": map[string]any{"videoGenModelConfig": config}}},
	}
}


// OpenVideoAsset streams a completed Grok asset video with SSO cookies.
// Browser-side anonymous downloads of assets.grok.com often receive HTTP 403.
func (a *Adapter) OpenVideoAsset(ctx context.Context, credential account.Credential, rawURL, rangeHeader string) (io.ReadCloser, http.Header, int, error) {
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || parsed.Scheme != "https" || !trustedImageAssetHost(parsed.Hostname()) || parsed.User != nil {
		return nil, nil, 0, fmt.Errorf("???? URL ????")
	}
	token, err := a.cipher.Decrypt(credential.EncryptedAccessToken)
	if err != nil {
		return nil, nil, 0, err
	}
	lease, err := a.egress.Acquire(ctx, domainegress.ScopeWebAsset, fmt.Sprintf("%d", credential.ID))
	if err != nil {
		return nil, nil, 0, err
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodGet, parsed.String(), nil)
	if err != nil {
		lease.Release()
		return nil, nil, 0, err
	}
	request.Header = buildHeaders(token, lease, "")
	request.Header.Del("Content-Type")
	request.Header.Set("Accept", "video/mp4,video/*;q=0.9,*/*;q=0.8")
	request.Header.Set("Referer", "https://grok.com/")
	request.Header.Set("Origin", "https://grok.com")
	if value := strings.TrimSpace(rangeHeader); value != "" {
		request.Header.Set("Range", value)
	}

	response, err := lease.Do(request)
	if err != nil {
		lease.Release()
		return nil, nil, 0, err
	}
	// Keep the egress lease alive until the caller finishes reading the body.
	return &leaseClosingBody{ReadCloser: response.Body, release: lease.Release}, response.Header.Clone(), response.StatusCode, nil
}

type leaseClosingBody struct {
	io.ReadCloser
	release func()
	closed  bool
}

func (b *leaseClosingBody) Close() error {
	if b.closed {
		return nil
	}
	b.closed = true
	err := b.ReadCloser.Close()
	if b.release != nil {
		b.release()
	}
	return err
}
