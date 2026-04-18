# Deploy

该目录用于统一编排三个容器：

- `app`：WebUI + Backend
- `codex-cli`：Codex 运行时
- `api-adapter`：Responses 兼容 API 适配层

## 启动

```bash
cd /home/monitor/Multi-Copilot/deploy
cp .env.example .env
docker compose up -d --build
```

## 默认端口

- App: `8787`
- APIAdapter: `11434`

## 当前 LLM 上游

默认使用：

- `UPSTREAM_BASE_URL=https://gemma4.lcmonitor.dynv6.net:8002/v1`

该地址与你本地转发的 `8002` 配置兼容。
