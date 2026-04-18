# Codex CLI Container

这个目录只负责 Codex 运行时容器，不再内置 API 兼容代理。

## 作用

- 预装 `@openai/codex`
- 持久化 `~/.codex`
- 生成 `openai-login`、`custom-api` 配置
- 通过挂载宿主目录，保证 `workspacePath` 在容器内可访问

## 快速启动（单独调试）

```bash
cd /home/monitor/Multi-Copilot/CodexCLI
cp .env.example .env
docker compose up -d --build
```

## 与完整部署联动

完整三容器编排在 `../deploy/docker-compose.yml`：

- `app`：前后端主应用
- `codex-cli`：本目录容器
- `api-adapter`：`/v1/responses` 兼容适配层

建议优先使用 `deploy` 目录统一启动。

## 认证

```bash
docker compose exec codex-cli codex login
docker compose exec codex-cli codex login status
```

无图形环境可使用设备码登录：

```bash
docker compose exec codex-cli codex login --device-auth
```
