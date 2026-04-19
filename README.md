# Codex Web Agent

一个面向桌面与移动端浏览器的 Codex 会话控制台，提供实时消息流、工具调用展示、文件树操作与内置终端能力。

## 核心能力

- Codex CLI 单运行时会话创建、发送消息、停止执行
- SSE 实时事件流（消息、工具、日志、文件变更、执行计划）
- 消息流中的工具调用时间线与执行中状态指示
- Todo/Plan 过程可视化，并额外输出简短进展与下一步摘要
- 工作区文件树：复制、粘贴、删除、拖拽移动
- 多 Console 标签页与命令执行后文件树自动刷新

## 项目结构

```text
.
|- app/
|  |- server/          # Express + SSE + Codex runtime adapter
|  |- web/             # React + Vite 前端
|- packages/
|  |- shared/          # 共享类型、常量、输入 schema
|- CodexCLI/           # Codex 运行时容器
|- APIAdapter/         # /v1/responses 兼容适配层
|- deploy/             # Docker Compose 编排
|- workspace/          # 默认工作区挂载目录
```

## 本地开发

```bash
npm install
npm run dev
```

默认地址：

- Web: http://localhost:5173
- Server API: http://localhost:8787

生产构建：

```bash
npm run build
npm run start
```

## Docker 启动

```bash
cd deploy
cp .env.example .env
docker compose up -d --build
```

默认暴露端口：

- App (WebUI + API): http://localhost:8787
- APIAdapter: http://localhost:11434/v1

主要环境变量见 `deploy/.env.example`。

## Codex 运行时

默认通过 Codex CLI 执行任务，可通过以下方式接入：

- 宿主机安装 `codex` 命令，由 server 直接调用
- 使用容器命令注入：`CODEX_CLI_COMMAND=docker exec -i codex-cli-runtime codex`

支持 profile：

- `openai-login`
- `custom-api`

`custom-api` 模式会通过 APIAdapter 将 `/v1/responses` 兼容转发至上游 `/v1/chat/completions`。

## 当前约束

- 同一时刻仅允许一个 running 会话
- 会话历史当前为内存态
- Codex 执行基于 non-interactive `codex exec --json`
- stop 会终止进程组并进行强制回收
