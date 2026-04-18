# 事件模型文档

## 设计目标

前端永远只依赖统一事件模型，不直接依赖底层 CLI 的原始输出格式。

服务端负责两件事：

1. 读取 CLI 原始事件
2. 映射为统一的 `ConsoleEvent`

当前支持两类 runtime：

- `copilot-cli`
- `codex-cli`

## 统一事件字段

```json
{
  "id": "evt_001",
  "sessionId": "sess_001",
  "type": "tool.execution_start",
  "timestamp": "2026-04-18T10:00:02.000Z",
  "agentId": "default",
  "agentRole": "general",
  "phase": "searching",
  "title": "搜索认证模块相关代码",
  "message": "正在查找 auth/login 相关实现",
  "raw": {}
}
```

## 统一事件类型

- `session.snapshot`
- `session.created`
- `session.started`
- `session.completed`
- `session.failed`
- `session.stopped`
- `assistant.message_start`
- `assistant.message_delta`
- `assistant.message_complete`
- `assistant.intent`
- `tool.execution_start`
- `tool.execution_progress`
- `tool.execution_complete`
- `tool.execution_failed`
- `file.changed`
- `log.stdout`
- `log.stderr`
- `approval.requested`
- `approval.resolved`

## phase 映射

- `idle`
- `thinking`
- `planning`
- `searching`
- `reading`
- `editing`
- `creating`
- `running`
- `approval`
- `summarizing`
- `completed`
- `failed`

## 原始 Copilot bridge 协议

当前 `CopilotCliAdapter` 期望 runtime 使用 JSON Lines 协议。

### 输入命令

发送消息：

```json
{"type":"message","id":"cmd_001","content":"请分析 auth 模块"}
```

停止执行：

```json
{"type":"stop","id":"cmd_002"}
```

### 原始输出事件示例

```json
{"type":"session.ready","phase":"idle","message":"Mock Copilot CLI runtime ready"}
{"type":"run.started","phase":"planning","message":"Copilot CLI accepted the task"}
{"type":"assistant.start","phase":"thinking","messageId":"msg_001"}
{"type":"assistant.delta","phase":"thinking","messageId":"msg_001","content":"我先梳理当前问题范围"}
{"type":"tool.start","phase":"searching","tool":{"id":"tool_001","name":"search_code","status":"running","summary":"搜索相关代码"}}
{"type":"tool.complete","phase":"searching","tool":{"id":"tool_001","name":"search_code","status":"completed","summary":"搜索完成","outputSummary":"匹配 src/auth/login.ts"}}
{"type":"file.change","phase":"editing","file":{"path":"src/auth/login.ts","changeType":"modified","summary":"补充错误处理"}}
{"type":"log.stdout","phase":"running","log":{"source":"stdout","content":"Running auth tests..."}}
{"type":"assistant.complete","phase":"completed","messageId":"msg_001","content":"我已完成本轮处理"}
{"type":"run.completed","phase":"completed","message":"Run completed"}
```

## 原始事件到统一事件映射

| 原始事件 | 统一事件 |
| --- | --- |
| `session.ready` | `session.created` |
| `run.started` | `session.started` |
| `assistant.start` | `assistant.message_start` |
| `assistant.delta` | `assistant.message_delta` |
| `assistant.complete` | `assistant.message_complete` |
| `assistant.intent` | `assistant.intent` |
| `tool.start` | `tool.execution_start` |
| `tool.progress` | `tool.execution_progress` |
| `tool.complete` | `tool.execution_complete` |
| `tool.failed` | `tool.execution_failed` |
| `file.change` | `file.changed` |
| `log.stdout` | `log.stdout` |
| `log.stderr` | `log.stderr` |
| `approval.requested` | `approval.requested` |
| `approval.resolved` | `approval.resolved` |
| `run.completed` | `session.completed` |
| `run.failed` | `session.failed` |
| `run.stopped` | `session.stopped` |

## 原始 Codex CLI 协议

当前 `CodexCliAdapter` 基于官方 `codex exec --json`。

官方文档说明：

- `codex exec --json` 会把 `stdout` 变成 JSON Lines 事件流
- 事件类型包括 `thread.started`、`turn.started`、`turn.completed`、`turn.failed`、`item.*` 和 `error`
- item 类型包括 agent messages、reasoning、command executions、file changes、MCP tool calls、web searches 和 plan updates

示例：

```bash
codex exec --json "summarize the repo structure"
```

官方文档示例流：

```json
{"type":"thread.started","thread_id":"0199a213-81c0-7800-8aa1-bbab2a035a53"}
{"type":"turn.started"}
{"type":"item.started","item":{"id":"item_1","type":"command_execution","command":"bash -lc ls","status":"in_progress"}}
{"type":"item.completed","item":{"id":"item_3","type":"agent_message","text":"Repo contains docs, sdk, and examples directories."}}
{"type":"turn.completed","usage":{"input_tokens":24763,"cached_input_tokens":24448,"output_tokens":122}}
```

### Codex 原始事件到统一事件映射

| 原始事件 | 统一事件 |
| --- | --- |
| `thread.started` | `session.created` |
| `turn.started` | `session.started` |
| `turn.completed` | `session.completed` |
| `turn.failed` | `session.failed` |
| `item.started` + `agent_message` | `assistant.message_start` |
| `item.updated` + `agent_message` | `assistant.message_delta` |
| `item.completed` + `agent_message` | `assistant.message_complete` |
| `item.*` + `reasoning` | `assistant.intent` |
| `item.*` + `plan_update` | `assistant.intent` |
| `item.*` + `command_execution` | `tool.execution_*` |
| `item.*` + `mcp_tool_call` | `tool.execution_*` |
| `item.*` + `web_search` | `tool.execution_*` |
| `item.updated/completed` + `file_change` | `file.changed` |
| `error` | `session.failed` |

### Codex 设计说明

Codex 的 non-interactive 模式不是长驻 stdin session，而是按 turn 执行：

- 首轮通过 `codex exec --json "<prompt>"` 启动
- 后续消息通过 `codex exec resume <thread_id> --json "<prompt>"` 继续
- 停止执行通过终止当前 `codex` 子进程完成

因此 `CodexCliAdapter` 在本项目中的实现采用：

- 单会话
- 单 turn 子进程
- thread id 追踪
- 执行中补充消息排队

## Session Snapshot

SSE 建立连接后，服务端首先发送：

```json
{
  "id": "evt_snapshot_sess_001",
  "sessionId": "sess_001",
  "type": "session.snapshot",
  "timestamp": "2026-04-18T10:00:00.000Z",
  "agentId": "default",
  "agentRole": "general",
  "phase": "idle",
  "snapshot": {
    "session": {},
    "messages": [],
    "tools": [],
    "logs": [],
    "fileChanges": [],
    "timeline": []
  }
}
```
