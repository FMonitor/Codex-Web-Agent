# Copilot CLI Web Console

一个面向浏览器和手机的单会话 coding-agent 控制台。

本项目实现了：

- 单个 Copilot CLI session 创建与管理
- 单个 Codex CLI session 创建与管理
- WebUI 聊天界面
- SSE 事件流
- 流式消息展示
- 执行状态展示
- 工具调用展示
- 日志输出展示
- 文件变更展示
- 停止当前执行
- `RuntimeAdapter` 抽象层和 `CopilotCliAdapter`
- `CodexCliAdapter`，基于官方 `codex exec --json` JSONL 事件流
- `agentId` / `agentRole` 字段预留

当前仓库内置了一个可运行的 mock Copilot runtime，因此即使机器上没有安装真实 Copilot CLI，也可以完整演示前后端链路。Codex CLI 则优先使用本机 `codex` 命令，也支持通过 `CODEX_CLI_COMMAND` 接到容器内的 `docker exec ... codex`。

## 目录结构

```text
Multi-Copilot/
├── app/
│   ├── server/        # Express + SSE + RuntimeAdapter
│   └── web/           # React + Vite 移动端优先 WebUI
├── CodexCLI/          # Codex runtime container
├── APIAdapter/        # Responses compatibility adapter
├── deploy/            # 统一三容器编排
├── packages/
│   └── shared/        # 共享类型、常量、输入 schema
├── docs/
│   ├── api.md
│   ├── event-model.md
│   └── examples/
│       └── basic-session.json
└── README.md
```

## 快速启动

```bash
cd /home/monitor/Multi-Copilot
npm install
npm run dev
```

默认服务：

- Web: `http://localhost:5173`
- Server API: `http://localhost:8787`

默认 runtime 选择逻辑：

- 若 `DEFAULT_RUNTIME` 已设置，则优先使用它
- 否则优先选择可用的 `codex-cli`
- 再退回到 `copilot-cli`

如果你希望只跑构建后的服务：

```bash
cd /home/monitor/Multi-Copilot
npm run build
npm run start
```

## 运行时接入

默认情况下，`CopilotCliAdapter` 会启动仓库内置的 mock runtime。

### 1. Copilot CLI bridge

如果你已经有自己的 Copilot CLI bridge，可以通过环境变量切换：

```bash
export COPILOT_CLI_COMMAND="your-copilot-bridge-command"
export DEFAULT_WORKSPACE_PATH="/path/to/workspace"
cd /home/monitor/Multi-Copilot
npm run dev
```

要求这个 bridge：

- 从 `stdin` 接收 JSON Lines 命令
- 向 `stdout` 输出 JSON Lines 事件
- 事件格式可参考 [docs/event-model.md](./docs/event-model.md) 中的原始协议示例

### 2. Codex CLI

如果宿主机已经安装 `codex`，server 会直接调用它。

如果你希望通过容器调用：

```bash
export CODEX_CLI_COMMAND="docker exec -i codex-cli-runtime codex"
export DEFAULT_RUNTIME="codex-cli"
```

Codex 官方文档当前支持两类主要认证思路：

- ChatGPT / OpenAI 登录
- API key / 自定义 provider

这个仓库已经把容器配置放在：

- [CodexCLI/README.md](./CodexCLI/README.md)
- [deploy/docker-compose.yml](./deploy/docker-compose.yml)

容器默认提供的 profile：

- `openai-login`
- `custom-api`
- `custom-openai-auth`

其中 `custom-api` 会先进入 `APIAdapter` 的 Responses 兼容代理：

- WebUI 选定 `custom-api` 后，模型候选会通过 server 调用 `/v1/models`
- 代理会把 Codex 的 `POST /v1/responses` 转成上游 `POST /v1/chat/completions`
- 如果你的模型服务跑在宿主机上，优先把 `.env` 里的 `CODEX_CUSTOM_API_BASE_URL` 配成 `http://host.docker.internal:<port>/v1`
- 代理默认暴露在宿主机 `http://127.0.0.1:11434/v1`

## 容器化启动（三容器）

```bash
cd /home/monitor/Multi-Copilot/deploy
cp .env.example .env
docker compose up -d --build
```

默认暴露：

- App (含 WebUI + API): `http://localhost:8787`
- APIAdapter: `http://localhost:11434/v1`

## API 与事件文档

- API 文档：[docs/api.md](./docs/api.md)
- 事件模型：[docs/event-model.md](./docs/event-model.md)
- 基础会话示例：[docs/examples/basic-session.json](./docs/examples/basic-session.json)

## 当前 MVP 取舍

- 只支持单个活跃 session
- 不实现 Todo
- 不实现 Default / Bypass / Autopilot 模式
- 不实现多 Agent 协作，但保留 `agentId` / `agentRole`
- 历史持久化暂时为内存态
- Codex 当前接入的是官方 non-interactive `codex exec --json` 模式；执行中补充消息会被排队，在当前 turn 结束后自动 resume
