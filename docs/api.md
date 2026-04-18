# API 文档

Base URL:

```text
http://localhost:8787/api
```

## `GET /health`

健康检查与运行时信息。

响应示例：

```json
{
  "ok": true,
  "runtimes": [
    {
      "runtime": "codex-cli",
      "command": "codex",
      "mode": "configured",
      "available": true
    },
    {
      "runtime": "copilot-cli",
      "command": "node dist/mock/copilot-cli-mock.js",
      "mode": "mock",
      "available": true
    }
  ],
  "defaultRuntime": "codex-cli",
  "now": "2026-04-18T10:00:00.000Z"
}
```

## `GET /bootstrap`

返回前端初始化所需信息：

- 默认工作目录
- 可用 runtime 列表
- 默认 runtime
- 当前 session 快照

## `GET /runtime-models?runtime=codex-cli&profile=custom-api`

按 runtime/profile 拉取模型候选列表。

典型用途：

- 前端在用户选定 `runtimeProfile` 后刷新模型下拉
- `codex-cli + custom-api` 时，server 会优先调用对应 provider 的 `/v1/models`
- 如果远端发现失败，会退回到 adapter 的静态候选列表

响应示例：

```json
{
  "runtime": "codex-cli",
  "profile": "custom-api",
  "models": ["Qwen3.5-9B-Q5_K_M", "llama-3.1-8b", "gpt-5-codex"]
}
```

## `POST /sessions`

创建一个新的单会话控制台 session。

请求体：

```json
{
  "title": "修复认证逻辑",
  "workspacePath": "/home/monitor/Multi-Copilot",
  "runtime": "codex-cli",
  "runtimeProfile": "openai-login",
  "model": "gpt-5-codex",
  "sandboxMode": "workspace-write",
  "agentId": "default",
  "agentRole": "general"
}
```

返回值为完整 session snapshot：

```json
{
  "session": {
    "id": "sess_xxx",
    "title": "修复认证逻辑",
    "status": "idle",
    "workspacePath": "/home/monitor/Multi-Copilot",
    "createdAt": "2026-04-18T10:00:00.000Z",
    "updatedAt": "2026-04-18T10:00:00.000Z",
    "runtime": "codex-cli",
    "agentId": "default",
    "agentRole": "general",
    "currentPhase": "idle",
    "runtimeProfile": "openai-login",
    "model": "gpt-5-codex",
    "sandboxMode": "workspace-write"
  },
  "messages": [],
  "tools": [],
  "logs": [],
  "fileChanges": [],
  "timeline": []
}
```

约束：

- 同一时间只允许一个活跃 session
- 如果已有非运行态 session，创建新会话时会替换旧会话
- 如果已有运行中的 session，会返回错误
- `runtime` 当前支持 `copilot-cli` 和 `codex-cli`
- `runtimeProfile` / `model` / `sandboxMode` 会原样传递给对应 adapter

## `GET /sessions/current`

获取当前活跃 session 的完整快照。

如果当前没有 session，返回 `404`。

## `GET /sessions/:sessionId`

获取指定 session 的完整快照。

## `POST /sessions/:sessionId/messages`

发送用户消息。

请求体：

```json
{
  "content": "请分析 auth 模块，并修复登录逻辑，再运行相关测试"
}
```

响应：

```json
{
  "accepted": true
}
```

说明：

- 服务端会立即记录用户消息
- runtime 通过 `stdin` 接收该消息
- 真实状态和流式回复通过 SSE 返回

## `POST /sessions/:sessionId/stop`

停止当前执行。

响应：

```json
{
  "accepted": true
}
```

## `DELETE /sessions/:sessionId`

销毁会话并释放 runtime。

成功返回 `204 No Content`。

## `GET /sessions/:sessionId/events`

SSE 事件流接口。

请求头：

```text
Accept: text/event-stream
```

服务端行为：

- 连接建立后先推送一个 `session.snapshot`
- 后续持续推送统一事件
- 每 15 秒发送一次 heartbeat 注释行

事件示例：

```json
{
  "id": "evt_001",
  "sessionId": "sess_001",
  "type": "assistant.message_delta",
  "timestamp": "2026-04-18T10:00:02.000Z",
  "agentId": "default",
  "agentRole": "general",
  "phase": "thinking",
  "messageId": "msg_001",
  "content": "我先梳理当前问题范围..."
}
```
