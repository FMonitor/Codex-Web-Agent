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

## 统一工作区入口

在 `.env` 里通过单个配置项统一 Agent 对话根路径和文件树根路径：

- `WORKSPACE_PATH=../workspace`

该值会同时用于：

- App 与 Codex 容器的同一挂载目录 `/workspace`
- App 的 `DEFAULT_WORKSPACE_PATH=/workspace`
- Codex 运行时容器的 `working_dir=/workspace`

说明：

- App 运行代码已打包进镜像内目录 `/opt/copilot-console`。
- `/workspace` 仅作为会话工作区挂载点，可保持为空的干净目录，不再要求包含 `package.json`。

## 模型来源

- deploy 环境变量不再配置模型名。
- 模型列表仅通过上游接口 `/models` 动态读取。
- deploy 仅保留 API 地址与密钥相关配置。

## 默认端口

- App: `8787`
- APIAdapter: `11434`

## 当前 LLM 上游

默认使用：

- `UPSTREAM_BASE_URL=http://host.docker.internal:8002/v1`

该地址与你本地转发的 `8002` 配置兼容。
