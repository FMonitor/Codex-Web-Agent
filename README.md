# Codex Web Agent Console

一个面向浏览器和手机的 coding agent 控制台，支持 Codex CLI 与 Copilot CLI 运行时接入。

项目目录名是 Multi-Copilot，当前主要定位是 Codex Web Agent：

- Web 聊天与执行面板
- SSE 实时事件流
- 工具调用、日志、文件变更可视化
- 执行计划（Todo/Plan）实时展示
- 工作区文件树操作（复制、粘贴、删除、拖拽移动）
- 内置 Console 终端标签页

## 核心能力

### 会话与运行时

- 支持 Codex CLI 会话创建、发送消息、停止执行
- 支持 Copilot CLI 抽象适配层（可接真实 bridge，也可使用内置 mock）
- 统一 RuntimeAdapter 模型，保留 agentId 和 agentRole 字段
- 同时支持 runtimeProfile、model、sandboxMode

### 实时可视化

- SSE 推送 session 事件与快照
- Assistant 流式消息展示（含前端逐字回放观感）
- 工具调用状态与输入输出摘要展示
- stdout 和 stderr 日志展示
- 文件变更展示

### 计划与过程展示

- TodoStrip 实时展示执行计划
- 支持 todo_list 与 plan_update 事件来源
- 在执行过程中展示“已完成进度 + 下一步”摘要
- 结束时不额外重复过程提示，避免与最终回答冲突

### 工作区文件树

- 左键打开文件
- 右键复制，目标目录右键粘贴
- 粘贴冲突自动生成副本名（如 name-copy、name-copy-2）
- 右键删除采用二次确认按钮（无弹窗）
- 左键长按拖拽移动到目录
- 拖拽悬停目录 500ms 自动展开
- 拖放目标目录高亮

### Console 标签页

- 多 Console tab
- 命令执行、停止、历史导航
- clear 作为一等 API 行为（清空当前 tab 历史）
- 命令执行完成后自动刷新文件树

## 目录结构

	Multi-Copilot/
	|- app/
	|  |- server/          # Express + SSE + RuntimeAdapter
	|  |- web/             # React + Vite WebUI
	|- CodexCLI/           # Codex runtime container
	|- APIAdapter/         # Responses compatibility adapter
	|- deploy/             # Docker Compose 编排
	|- packages/
	|  |- shared/          # 共享类型、常量、输入 schema
	|- docs/
	|  |- api.md
	|  |- event-model.md
	|  |- examples/
	|     |- basic-session.json
	|- README.md

## 本地开发

### 1) 安装与启动

	cd /home/monitor/Multi-Copilot
	npm install
	npm run dev

默认地址：

- Web: http://localhost:5173
- Server API: http://localhost:8787

### 2) 构建与启动生产包

	cd /home/monitor/Multi-Copilot
	npm run build
	npm run start

## Docker 三容器启动

	cd /home/monitor/Multi-Copilot/deploy
	cp .env.example .env
	docker compose up -d --build

默认暴露：

- App（WebUI + API）: http://localhost:8787
- APIAdapter: http://localhost:11434/v1

主要环境变量见 [deploy/.env.example](deploy/.env.example)。

## 运行时接入说明

### Codex CLI

默认优先使用 Codex 运行时，可通过以下两种方式接入：

- 宿主机安装 codex 命令，server 直接调用
- 使用容器命令注入：CODEX_CLI_COMMAND=docker exec -i codex-cli-runtime codex

当前支持 profile：

- openai-login
- custom-api

custom-api 路径会走 APIAdapter：

- server 调用模型列表
- 代理将 /v1/responses 转上游 /v1/chat/completions
- 若上游在宿主机，建议 UPSTREAM_BASE_URL 或 CODEX_CUSTOM_API_BASE_URL 使用 host.docker.internal

### Copilot CLI

如果未配置 COPILOT_CLI_COMMAND，默认使用内置 mock runtime，便于端到端演示。

如需接入自定义 bridge，可设置：

	export COPILOT_CLI_COMMAND="your-copilot-bridge-command"
	export DEFAULT_WORKSPACE_PATH="/path/to/workspace"

bridge 约定：

- stdin 接收 JSON Lines 命令
- stdout 输出 JSON Lines 事件

## 默认 runtime 选择逻辑

- 若设置 DEFAULT_RUNTIME，则优先使用该 runtime（并且存在于注册列表）
- 否则优先选择可用的 runtime
- 当前服务默认配置偏向 codex-cli

## API 与事件文档

- API 文档: [docs/api.md](docs/api.md)
- 事件模型: [docs/event-model.md](docs/event-model.md)
- 基础会话示例: [docs/examples/basic-session.json](docs/examples/basic-session.json)

## 当前约束与说明

- 一次仅允许一个 running 会话，新会话需要等待当前 running 会话结束或停止
- 会话历史当前为内存态
- Codex 执行基于官方 non-interactive 模式 codex exec --json
- 执行中补充消息会进入队列，在当前 turn 结束后继续处理
- stop 已做增强：支持进程组终止与强制回收，提升停止成功率
