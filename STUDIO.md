# Studio 独立工作台

本仓库包含独立 Studio 应用：`studio/`。

## 自动构建镜像

推送到 `main` 或创建 `v*` 标签后，GitHub Actions 会自动构建并推送：

- Gateway: `ghcr.io/<owner>/grok2api:latest`
- Studio: `ghcr.io/<owner>/grok2api-studio:latest`

工作流文件：`.github/workflows/docker-publish.yml`

## 启动 Studio 容器

```bash
docker run --rm -p 4175:4175 \
  -e STUDIO_PROXY_TARGET=http://host.docker.internal:8000 \
  ghcr.io/<owner>/grok2api-studio:latest
```

或使用 compose profile：

```bash
docker compose --profile studio up -d
```
