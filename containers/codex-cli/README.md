# Codex CLI Container

这个目录提供一个可长期驻留的 Codex CLI 容器，方便宿主机上的 `apps/server` 通过 `docker exec -i codex-cli-runtime codex ...` 调用。

## 特点

- 预装 `@openai/codex`
- 持久化 `~/.codex`
- 支持 `openai-login` profile
- 支持 `custom-api` profile
- 预留 `custom-openai-auth` profile，适配使用 OpenAI 认证的代理
- 内置一个 `Responses -> /chat/completions` 兼容代理，方便对接只支持 `/v1/chat/completions` 的 llama 后端
- 通过把宿主工作目录挂载到同一路径，让 server 传入的 `workspacePath` 在容器内仍然有效
- 默认以 `root` 身份运行，避免宿主挂载目录权限不匹配导致 `os error 13`

## 启动

```bash
cd /home/monitor/Multi-Copilot/containers/codex-cli
cp .env.example .env
docker compose up -d --build
```

## 认证方式

### 1. OpenAI / ChatGPT 登录

官方 Codex 文档说明，你可以直接在 CLI 中选择 `Sign in with ChatGPT`，也可以把已有的 `~/.codex/auth.json` 拷进容器。

容器内登录：

```bash
docker compose exec codex-cli codex login
```

如果是在无图形环境中，也可以使用：

```bash
docker compose exec codex-cli codex login --device-auth
```

把宿主机的认证缓存复制进容器：

```bash
CONTAINER_HOME=$(docker exec codex-cli-runtime printenv HOME)
docker exec codex-cli-runtime mkdir -p "$CONTAINER_HOME/.codex"
docker cp ~/.codex/auth.json codex-cli-runtime:"$CONTAINER_HOME/.codex/auth.json"
```

### 2. 自定义 API

在 `.env` 中配置：

```bash
CODEX_CUSTOM_API_BASE_URL=http://host.docker.internal:1234/v1
CUSTOM_LLM_API_KEY=your-key
```

这里的 `CODEX_CUSTOM_API_BASE_URL` 指的是你真实的 llama / OpenAI-compatible 上游地址。
容器启动后会自动再起一层 `codex-responses-proxy`：

- Codex CLI 的 `custom-api` profile 会连 `http://codex-responses-proxy:11434/v1`
- 代理再把 `/v1/responses` 翻译成上游 `/v1/chat/completions`
- WebUI 的模型下拉会通过代理请求 `/v1/models`

如果你的模型服务就在宿主机上，不要再填 `localhost`，而是优先使用：

```bash
CODEX_CUSTOM_API_BASE_URL=http://host.docker.internal:1234/v1
```

这样容器才能访问到宿主机服务。

## 与本项目 server 联动

在宿主机上启动 server 前设置：

```bash
export CODEX_CLI_COMMAND="docker exec -i codex-cli-runtime codex"
export DEFAULT_RUNTIME="codex-cli"
```

然后回到项目根目录：

```bash
cd /home/monitor/Multi-Copilot
npm run dev
```

在 WebUI 中创建会话时：

- `runtime` 选择 `codex-cli`
- `profile` 选 `openai-login` 或 `custom-api`
- 选定 `custom-api` 后，前端会自动拉取 `/v1/models` 并刷新模型候选

## 容器内验证

```bash
docker compose exec codex-cli codex --version
docker compose exec codex-cli codex login status
docker compose exec codex-cli codex exec --json --skip-git-repo-check --sandbox read-only "say hello"
curl http://127.0.0.1:11434/health
curl http://127.0.0.1:11434/v1/models
```

## 关于容器日志

这个容器的主进程默认是 `sleep infinity`，因此：

- `docker logs codex-cli-runtime` 通常几乎没有内容
- 真正的 Codex 执行日志来自 `docker exec ... codex ...` 的子进程
- 在本项目里，这些日志会由 server 收集后回传到 WebUI 的日志面板
