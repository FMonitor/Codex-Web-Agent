# APIAdapter

该目录提供 Codex 需要的 OpenAI Responses 兼容层。

## 功能

- 对外提供 `/v1/models`
- 接收 `/v1/responses`
- 转换并转发到上游 `/v1/chat/completions`
- 兼容 SSE 流式输出

## 运行方式

建议通过 `../deploy/docker-compose.yml` 统一启动。

如需单独调试：

1. 构建镜像
2. 传入环境变量 `UPSTREAM_BASE_URL`（例如 `https://gemma4.lcmonitor.dynv6.net:8002/v1`）
3. 启动后访问 `http://localhost:11434/v1/models`
