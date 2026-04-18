import type { ChatMessage } from "@copilot-console/shared";

interface MessageListProps {
  messages: ChatMessage[];
}

export function MessageList({ messages }: MessageListProps) {
  return (
    <div className="messages">
      {messages.length === 0 ? (
        <div className="empty-state">
          <h3>会话已创建</h3>
          <p>输入一个任务开始流式执行，例如“请分析 auth 模块，并修复登录逻辑，再运行相关测试”。</p>
        </div>
      ) : null}
      {messages.map((message) => (
        <article key={message.id} className={`message-bubble message-${message.role}`}>
          <div className="message-heading">
            <span>{message.role === "user" ? "你" : "Copilot"}</span>
            <time>{new Date(message.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time>
          </div>
          <div className="message-content">{message.content}</div>
        </article>
      ))}
    </div>
  );
}

