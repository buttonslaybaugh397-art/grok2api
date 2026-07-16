# Grok Studio

独立的 AI 创作工作台（对话 / 图片 / 视频），只依赖公共 `/v1/*` 接口，不依赖后台管理员登录。

## 本地开发

```bash
cd studio
cp .env.example .env
npm install
npm run dev
```

默认地址：`http://127.0.0.1:5175`

## 生产启动（本地反代，免 CORS）

```bash
cd studio
npm run serve
```

默认地址：`http://127.0.0.1:4175`

环境变量：

- `STUDIO_PROXY_TARGET`：上游 grok2api 地址，例如 `http://154.201.92.160:8000`
- `PORT`：服务端口，默认 `4175`
- `HOST`：监听地址，默认 `127.0.0.1`（Docker 镜像默认 `0.0.0.0`）

## Docker

```bash
cd studio
docker compose up -d --build
```

或直接使用 GHCR 镜像：

```bash
docker run --rm -p 4175:4175 \
  -e STUDIO_PROXY_TARGET=http://host.docker.internal:8000 \
  ghcr.io/buttonslaybaugh397-art/grok2api-studio:latest
```

打开 `http://127.0.0.1:4175`，填写 API Key 后即可使用。
