import { useMutation, useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  Copy,
  Image as ImageIcon,
  KeyRound,
  LoaderCircle,
  Sparkles,
  Video,
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  extractOutputText,
  generateImage,
  generateText,
  generateVideo,
  getVideo,
  listPublicModels,
  toImageSource,
  type PublicModelDTO,
  type VideoGenerationResult,
} from "@/features/studio/studio-api";
import { cn } from "@/shared/lib/cn";

const studioApiKeyStorageKey = "studio.manualApiKey";
const videoTerminalStates = new Set(["completed", "succeeded", "failed", "cancelled", "error"]);
const imageAspectRatios = ["1:1", "4:3", "3:4", "16:9", "9:16"];
const videoAspectRatios = ["16:9", "9:16", "1:1"];
const imageCountOptions = [1, 2, 3, 4];
const emptyModels: PublicModelDTO[] = [];

function getStoredStudioApiKey() {
  if (typeof window === "undefined") {
    return "";
  }

  return window.localStorage.getItem(studioApiKeyStorageKey) ?? "";
}

function getErrorDisplayMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  if (typeof error === "string" && error.trim()) {
    return error;
  }

  return "请求失败，请检查 API Key 或稍后重试。";
}

function showError(error: unknown) {
  toast.error(getErrorDisplayMessage(error));
}

function normalizeModelId(value: string) {
  return value.trim().toLowerCase();
}

function filterModelsByKeywords(models: PublicModelDTO[] | undefined, keywords: string[]) {
  if (!models?.length) {
    return [];
  }

  return models.filter((model) => {
    const id = normalizeModelId(model.id);
    return keywords.some((keyword) => id.includes(keyword));
  });
}

function filterTextModels(models: PublicModelDTO[] | undefined) {
  if (!models?.length) {
    return [];
  }

  const excluded = ["image", "vision", "video", "tts", "audio", "embedding", "moderation"];
  return models.filter((model) => !excluded.some((keyword) => normalizeModelId(model.id).includes(keyword)));
}

function filterImageModels(models: PublicModelDTO[] | undefined) {
  return filterModelsByKeywords(models, ["image", "vision", "grok-2-image", "flux", "sd"]);
}

function filterVideoModels(models: PublicModelDTO[] | undefined) {
  return filterModelsByKeywords(models, ["video"]);
}

function resolveSelectedModel(models: PublicModelDTO[], requestedModel: string) {
  if (!models.length) {
    return "";
  }

  if (requestedModel && models.some((model) => model.id === requestedModel)) {
    return requestedModel;
  }

  return models[0]?.id ?? "";
}

function copyToClipboard(value: string, label: string) {
  if (!value.trim()) {
    toast.error(`没有可复制的${label}`);
    return;
  }

  if (typeof navigator === "undefined" || !navigator.clipboard) {
    toast.error("当前环境不支持剪贴板复制");
    return;
  }

  navigator.clipboard.writeText(value).then(
    () => toast.success(`${label}已复制`),
    () => toast.error(`${label}复制失败`),
  );
}

export function StudioPage() {
  const [apiKeyInput, setApiKeyInput] = useState(() => getStoredStudioApiKey());
  const [savedApiKey, setSavedApiKey] = useState(() => getStoredStudioApiKey());

  const [textModel, setTextModel] = useState("");
  const [imageModel, setImageModel] = useState("");
  const [videoModel, setVideoModel] = useState("");

  const [textPrompt, setTextPrompt] = useState(
    "请总结一下这段内容的重点，并给出清晰的行动建议。",
  );
  const [imagePrompt, setImagePrompt] = useState(
    "生成一张未来感工作室场景插画，柔和光线，细节丰富，电影感构图。",
  );
  const [videoPrompt, setVideoPrompt] = useState(
    "生成一段城市夜景延时视频，镜头缓慢推进，霓虹灯反射在雨后街道上。",
  );
  const [imageAspectRatio, setImageAspectRatio] = useState("16:9");
  const [imageCount, setImageCount] = useState(1);
  const [videoAspectRatio, setVideoAspectRatio] = useState("16:9");
  const [videoReferenceUrl, setVideoReferenceUrl] = useState("");

  const [textResult, setTextResult] = useState("");
  const [imageResults, setImageResults] = useState<string[]>([]);
  const [videoRequestResult, setVideoRequestResult] = useState<VideoGenerationResult | null>(null);

  const selectedSecret = savedApiKey.trim();

  const modelsQuery = useQuery({
    queryKey: ["studio-models", selectedSecret],
    queryFn: () => listPublicModels(selectedSecret),
    enabled: Boolean(selectedSecret),
    staleTime: 60_000,
  });

  const models = modelsQuery.data ?? emptyModels;
  const textModels = useMemo(() => filterTextModels(models), [models]);
  const imageModels = useMemo(() => filterImageModels(models), [models]);
  const videoModels = useMemo(() => filterVideoModels(models), [models]);

  const selectedTextModel = resolveSelectedModel(textModels, textModel);
  const selectedImageModel = resolveSelectedModel(imageModels, imageModel);
  const selectedVideoModel = resolveSelectedModel(videoModels, videoModel);

  const textMutation = useMutation({
    mutationFn: () =>
      generateText(selectedSecret, {
        model: selectedTextModel,
        prompt: textPrompt.trim(),
      }),
    onSuccess: (result) => {
      setTextResult(extractOutputText(result));
    },
    onError: showError,
  });

  const imageMutation = useMutation({
    mutationFn: () =>
      generateImage(selectedSecret, {
        model: selectedImageModel,
        prompt: imagePrompt.trim(),
        n: imageCount,
        aspectRatio: imageAspectRatio,
        responseFormat: "b64_json",
      }),
    onSuccess: (result) => {
      const nextImages = result.data.map(toImageSource).filter((value): value is string => Boolean(value));
      setImageResults(nextImages);
      if (!nextImages.length) {
        toast.message("视频任务已提交，正在轮询生成状态。");
      }
    },
    onError: showError,
  });

  const videoMutation = useMutation({
    mutationFn: () =>
      generateVideo(selectedSecret, {
        model: selectedVideoModel,
        prompt: videoPrompt.trim(),
        aspectRatio: videoAspectRatio,
        imageUrl: videoReferenceUrl.trim() || undefined,
      }),
    onSuccess: (result) => setVideoRequestResult(result),
    onError: showError,
  });

  const videoStatusQuery = useQuery({
    queryKey: ["studio-video-status", selectedSecret, videoRequestResult?.request_id],
    queryFn: () => getVideo(selectedSecret, videoRequestResult?.request_id ?? ""),
    enabled: Boolean(
      selectedSecret &&
        videoRequestResult?.request_id &&
        !videoTerminalStates.has(String(videoRequestResult.status ?? "").toLowerCase()),
    ),
    refetchInterval: (query) => {
      const status = String(query.state.data?.status ?? videoRequestResult?.status ?? "").toLowerCase();
      return videoTerminalStates.has(status) ? false : 5000;
    },
  });

  const displayedVideoResult = videoStatusQuery.data ?? videoRequestResult;

  const hasApiKey = Boolean(selectedSecret);
  const isBusy =
    modelsQuery.isLoading ||
    textMutation.isPending ||
    imageMutation.isPending ||
    videoMutation.isPending ||
    videoStatusQuery.isFetching;

  const textDisabled = !hasApiKey || !selectedTextModel || !textPrompt.trim() || textMutation.isPending;
  const imageDisabled = !hasApiKey || !selectedImageModel || !imagePrompt.trim() || imageMutation.isPending;
  const videoDisabled = !hasApiKey || !selectedVideoModel || !videoPrompt.trim() || videoMutation.isPending;

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
      <section className="overflow-hidden rounded-[32px] border bg-card shadow-sm">
        <div className="grid gap-6 p-6 sm:p-8 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="space-y-4">
            <Badge variant="outline" className="rounded-full px-3 py-1 text-xs tracking-[0.2em]">
              Studio 控制台
            </Badge>
            <div className="space-y-3">
              <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">统一体验你的多模态创作能力</h1>
              <p className="max-w-3xl text-sm leading-6 text-muted-foreground sm:text-base">
                在 Studio 中直接输入 API Key，即可体验文本、图像与视频生成，并通过
                <code className="mx-1 rounded bg-muted px-1.5 py-0.5 text-xs">/v1</code>
                接口访问模型能力。
              </p>
              <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                <span>如果你还没有可用凭证，可以先前往管理后台登录。</span>
                <a href="/admin/login" className="underline underline-offset-4">
                  前往登录
                </a>
              </div>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
            <MetricCard label="可用模型" value={String(models.length || 0)} />
            <MetricCard label="图像模型" value={String(imageModels.length || 0)} />
            <MetricCard label="视频模型" value={String(videoModels.length || 0)} />
          </div>
        </div>
      </section>

      <section className="rounded-[28px] border bg-card p-5 shadow-sm sm:p-6">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">设置 API Key</h2>
            <p className="text-sm leading-6 text-muted-foreground">
              这里保存的 Key 仅会写入当前浏览器的 localStorage，方便你在本地继续调试。
            </p>
          </div>
          {isBusy ? (
            <div className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs text-muted-foreground">
              <Spinner className="size-4" />
              处理中
            </div>
          ) : null}
        </div>

        <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
          <Field label="API Key">
            <div className="flex flex-col gap-3 sm:flex-row">
              <div className="flex-1">
                <Input
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  value={apiKeyInput}
                  onChange={(event) => setApiKeyInput(event.target.value)}
                  placeholder="请输入用于 /v1 接口的 Bearer Token"
                />
              </div>
              <Button
                type="button"
                className="rounded-2xl"
                onClick={() => {
                  const nextKey = apiKeyInput.trim();
                  setSavedApiKey(nextKey);
                  if (typeof window !== "undefined") {
                    window.localStorage.setItem(studioApiKeyStorageKey, nextKey);
                  }
                  toast.success(nextKey ? "API Key 已保存到本地" : "已清空 API Key");
                }}
              >
                <KeyRound className="mr-2 size-4" />
                保存 Key
              </Button>
            </div>
          </Field>
          <Button
            type="button"
            variant="outline"
            className="rounded-2xl"
            onClick={() => {
              setApiKeyInput("");
              setSavedApiKey("");
              if (typeof window !== "undefined") {
                window.localStorage.removeItem(studioApiKeyStorageKey);
              }
              toast.success("已移除本地保存的 API Key");
            }}
          >
            清除 Key
          </Button>
        </div>

        {!hasApiKey ? (
          <div className="mt-4">
            <InlineError message="请先输入 API Key，随后才能加载模型并开始体验。" />
          </div>
        ) : null}

        {modelsQuery.isError ? (
          <div className="mt-4">
            <InlineError message={getErrorDisplayMessage(modelsQuery.error)} />
          </div>
        ) : null}
      </section>

      <Tabs defaultValue="text" className="space-y-6">
        <TabsList className="grid w-full grid-cols-3 rounded-[22px] p-1">
          <TabsTrigger value="text" className="rounded-[18px]">
            <Sparkles className="mr-2 size-4" />
            文本
          </TabsTrigger>
          <TabsTrigger value="image" className="rounded-[18px]">
            <ImageIcon className="mr-2 size-4" />
            图像
          </TabsTrigger>
          <TabsTrigger value="video" className="rounded-[18px]">
            <Video className="mr-2 size-4" />
            视频
          </TabsTrigger>
        </TabsList>

        <TabsContent value="text">
          <StudioPanel
            title="文本生成"
            description="输入提示词，调用文本模型生成回答，并在右侧实时查看返回内容。"
            controls={
              <>
                <ModelPicker
                  label="模型"
                  value={selectedTextModel}
                  onChange={setTextModel}
                  options={textModels}
                  disabled={!hasApiKey || modelsQuery.isLoading || !textModels.length}
                />
                <PromptBox
                  label="提示词"
                  value={textPrompt}
                  onChange={setTextPrompt}
                  placeholder="输入你想让模型完成的任务，例如总结、改写、翻译或头脑风暴。"
                />
                <div className="flex flex-wrap gap-3">
                  <Button type="button" className="rounded-2xl" disabled={textDisabled} onClick={() => textMutation.mutate()}>
                    {textMutation.isPending ? <LoaderCircle className="mr-2 size-4 animate-spin" /> : <Sparkles className="mr-2 size-4" />}
                    生成文本
                  </Button>
                  <Button type="button" variant="outline" className="rounded-2xl" onClick={() => copyToClipboard(textResult, "文本结果")}>
                    <Copy className="mr-2 size-4" />
                    复制结果
                  </Button>
                </div>
                {!textModels.length && hasApiKey && !modelsQuery.isLoading ? (
                  <InlineError message="当前 API Key 下没有可用的文本模型。" />
                ) : null}
              </>
            }
            result={
              <div className="space-y-4">
                <StatusLine label="当前模型" value={selectedTextModel || "未选择"} />
                <div className="rounded-[24px] border bg-background/70 p-4">
                  <pre className="whitespace-pre-wrap break-words text-sm leading-6 text-foreground">
                    {textResult || "生成结果会显示在这里。"}
                  </pre>
                </div>
              </div>
            }
          />
        </TabsContent>

        <TabsContent value="image">
          <StudioPanel
            title="图像生成"
            description="输入图像描述，选择比例与张数，生成后可直接预览或打开原图。"
            controls={
              <>
                <ModelPicker
                  label="模型"
                  value={selectedImageModel}
                  onChange={setImageModel}
                  options={imageModels}
                  disabled={!hasApiKey || modelsQuery.isLoading || !imageModels.length}
                />
                <PromptBox
                  label="提示词"
                  value={imagePrompt}
                  onChange={setImagePrompt}
                  placeholder="描述你想生成的画面内容、风格、镜头语言或光影氛围。"
                />
                <div className="grid gap-4 sm:grid-cols-2">
                  <SelectField
                    label="画面比例"
                    value={imageAspectRatio}
                    onChange={setImageAspectRatio}
                    options={imageAspectRatios}
                  />
                  <SelectField
                    label="生成数量"
                    value={String(imageCount)}
                    onChange={(value) => setImageCount(Number(value))}
                    options={imageCountOptions.map((value) => String(value))}
                  />
                </div>
                <div className="flex flex-wrap gap-3">
                  <Button type="button" className="rounded-2xl" disabled={imageDisabled} onClick={() => imageMutation.mutate()}>
                    {imageMutation.isPending ? <LoaderCircle className="mr-2 size-4 animate-spin" /> : <ImageIcon className="mr-2 size-4" />}
                    生成图像
                  </Button>
                </div>
                {!imageModels.length && hasApiKey && !modelsQuery.isLoading ? (
                  <InlineError message="当前 API Key 下没有可用的图像模型。" />
                ) : null}
              </>
            }
            result={
              imageResults.length ? (
                <div className="grid gap-4 md:grid-cols-2">
                  {imageResults.map((src, index) => (
                    <div key={`${src}-${index}`} className="overflow-hidden rounded-[24px] border bg-background/70 p-3">
                      <img src={src} alt={`生成图片 ${index + 1}`} className="aspect-video w-full rounded-[18px] object-cover" />
                      <div className="mt-3 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                        <span>图片 {index + 1}</span>
                        <a href={src} target="_blank" rel="noreferrer" className="underline underline-offset-4">
                          打开原图
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyResult message="生成后的图片会显示在这里。" />
              )
            }
          />
        </TabsContent>

        <TabsContent value="video">
          <StudioPanel
            title="视频生成"
            description="提交视频生成任务后会返回 request ID，页面会自动轮询并展示最新状态。"
            controls={
              <>
                <ModelPicker
                  label="模型"
                  value={selectedVideoModel}
                  onChange={setVideoModel}
                  options={videoModels}
                  disabled={!hasApiKey || modelsQuery.isLoading || !videoModels.length}
                />
                <PromptBox
                  label="提示词"
                  value={videoPrompt}
                  onChange={setVideoPrompt}
                  placeholder="描述你想生成的视频内容、运镜方式、节奏与整体氛围。"
                />
                <div className="grid gap-4 sm:grid-cols-2">
                  <SelectField
                    label="视频比例"
                    value={videoAspectRatio}
                    onChange={setVideoAspectRatio}
                    options={videoAspectRatios}
                  />
                  <Field label="参考图 URL（可选）">
                    <Input
                      value={videoReferenceUrl}
                      onChange={(event) => setVideoReferenceUrl(event.target.value)}
                      placeholder="https://example.com/reference.png"
                    />
                  </Field>
                </div>
                <div className="flex flex-wrap gap-3">
                  <Button type="button" className="rounded-2xl" disabled={videoDisabled} onClick={() => videoMutation.mutate()}>
                    {videoMutation.isPending ? <LoaderCircle className="mr-2 size-4 animate-spin" /> : <Video className="mr-2 size-4" />}
                    生成视频
                  </Button>
                </div>
                {!videoModels.length && hasApiKey && !modelsQuery.isLoading ? (
                  <InlineError message="当前 API Key 下没有可用的视频模型。" />
                ) : null}
              </>
            }
            result={<VideoResultCard result={displayedVideoResult} loading={videoStatusQuery.isFetching} />}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function StudioPanel(props: {
  title: string;
  description: string;
  controls: ReactNode;
  result: ReactNode;
}) {
  return (
    <div className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
      <section className="rounded-[28px] border bg-card p-5 shadow-sm sm:p-6">
        <div className="mb-5 space-y-1">
          <h2 className="text-lg font-semibold">{props.title}</h2>
          <p className="text-sm leading-6 text-muted-foreground">{props.description}</p>
        </div>
        <div className="space-y-4">{props.controls}</div>
      </section>
      <section className="rounded-[28px] border bg-card p-5 shadow-sm sm:p-6">{props.result}</section>
    </div>
  );
}

function ModelPicker(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: PublicModelDTO[];
  disabled?: boolean;
}) {
  return (
    <Field label={props.label}>
      <select
        className="flex h-10 w-full rounded-2xl border bg-background px-3 text-sm outline-none"
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        disabled={props.disabled}
      >
        <option value="">请选择模型</option>
        {props.options.map((model) => (
          <option key={model.id} value={model.id}>
            {model.id}
          </option>
        ))}
      </select>
    </Field>
  );
}

function SelectField(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
}) {
  return (
    <Field label={props.label}>
      <select
        className="flex h-10 w-full rounded-2xl border bg-background px-3 text-sm outline-none"
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
      >
        {props.options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </Field>
  );
}

function PromptBox(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <Field label={props.label}>
      <Textarea
        className="min-h-36 rounded-[24px] px-4 py-3 text-sm leading-6"
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        placeholder={props.placeholder}
      />
    </Field>
  );
}

function Field(props: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <Label className="text-sm">{props.label}</Label>
      {props.children}
    </div>
  );
}

function StatusLine(props: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{props.label}</span>
      <span className="font-mono text-foreground">{props.value}</span>
    </div>
  );
}

function MetricCard(props: { label: string; value: string }) {
  return (
    <div className="rounded-[22px] border border-white/60 bg-white/70 p-4 backdrop-blur dark:border-white/10 dark:bg-white/5">
      <div className="text-xs tracking-[0.18em] text-muted-foreground">{props.label}</div>
      <div className="mt-2 text-2xl font-semibold">{props.value}</div>
    </div>
  );
}

function InlineError(props: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-2xl border border-destructive/20 bg-destructive/5 p-3 text-xs text-destructive">
      <AlertCircle className="mt-0.5 size-4 shrink-0" />
      <span>{props.message}</span>
    </div>
  );
}

function EmptyResult(props: { message: string }) {
  return (
    <div className="col-span-full flex min-h-64 items-center justify-center rounded-[24px] border border-dashed bg-muted/30 p-6 text-sm text-muted-foreground">
      {props.message}
    </div>
  );
}

function VideoResultCard(props: { result: VideoGenerationResult | null; loading: boolean }) {
  const status = props.result?.status ?? "等待中";
  const normalizedStatus = status.toLowerCase();
  const readyUrl = props.result?.url ?? props.result?.download_url;

  return (
    <div className="space-y-4">
      <div className="rounded-[24px] border bg-background/80 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <Badge
            variant="outline"
            className={cn(
              "rounded-full px-3 py-1 text-xs",
              (normalizedStatus === "completed" || normalizedStatus === "succeeded") &&
                "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
              (normalizedStatus === "failed" || normalizedStatus === "error") &&
                "border-destructive/30 bg-destructive/10 text-destructive",
            )}
          >
            {status}
          </Badge>
          {props.loading ? <LoaderCircle className="size-4 animate-spin text-muted-foreground" /> : null}
          {props.result?.request_id ? (
            <span className="font-mono text-xs text-muted-foreground">request_id: {props.result.request_id}</span>
          ) : null}
        </div>
        <div className="mt-4 space-y-2 text-sm text-muted-foreground">
          <p>视频生成通常需要一些时间，页面会自动刷新状态，请耐心等待。</p>
          {props.result?.error?.message ? <p className="text-destructive">{props.result.error.message}</p> : null}
        </div>
      </div>
      {readyUrl ? (
        <div className="rounded-[24px] border bg-background/80 p-4">
          <video className="aspect-video w-full rounded-[18px] bg-black" controls src={readyUrl} />
          <div className="mt-3 flex items-center justify-between gap-3 text-xs text-muted-foreground">
            <span>视频已就绪</span>
            <a href={readyUrl} target="_blank" rel="noreferrer" className="underline underline-offset-4">
              打开视频
            </a>
          </div>
        </div>
      ) : (
        <EmptyResult message="视频生成结果会显示在这里。" />
      )}
    </div>
  );
}



