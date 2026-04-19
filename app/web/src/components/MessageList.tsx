import type { ConsoleEvent, SessionSnapshot } from "@copilot-console/shared";
import { useMemo, useState } from "react";

interface MessageListProps {
  snapshot: SessionSnapshot | null;
}

type StreamEntry =
  | {
      id: string;
      kind: "message";
      timestamp: string;
      role: "user" | "assistant" | "system";
      content: string;
    }
  | {
      id: string;
      kind: "status";
      timestamp: string;
      text: string;
    }
  | {
      id: string;
      kind: "log";
      timestamp: string;
      source: "stdout" | "stderr";
      content: string;
    };

function describeStatus(event: ConsoleEvent): string | null {
  const message = event.message || event.content || "";
  if (message.includes("用户消息已接收") || message.includes("开始执行 Codex CLI")) {
    return null;
  }

  switch (event.type) {
    case "assistant.intent":
      return message || "Agent 更新了执行意图";
    case "session.started":
      return event.message || "开始执行";
    case "session.completed":
      return event.message || "执行完成";
    case "session.failed":
      return event.message || "执行失败";
    case "session.stopped":
      return event.message || "已停止执行";
    case "tool.execution_start":
    case "tool.execution_progress":
    case "tool.execution_complete":
    case "tool.execution_failed": {
      const status = event.toolCall?.status || "running";
      return `工具 ${event.toolCall?.name || "unknown"}: ${status} - ${event.toolCall?.summary || ""}`;
    }
    case "file.changed":
      return `文件 ${event.fileChange?.path || "unknown"}: ${event.fileChange?.summary || "已变更"}`;
    default:
      return null;
  }
}

function toLogPreview(content: string): string {
  const oneLine = content.replace(/\s+/g, " ").trim();
  if (oneLine.length <= 120) {
    return oneLine;
  }
  return `${oneLine.slice(0, 120)}...`;
}

export function MessageList({ snapshot }: MessageListProps) {
  const [openLogs, setOpenLogs] = useState<Record<string, boolean>>({});

  const entries = useMemo<StreamEntry[]>(() => {
    if (!snapshot) {
      return [];
    }

    const messageEntries: StreamEntry[] = snapshot.messages.map((message) => ({
      id: `msg_${message.id}`,
      kind: "message",
      timestamp: message.createdAt,
      role: message.role,
      content: message.content,
    }));

    const statusEntries: StreamEntry[] = snapshot.timeline.reduce<StreamEntry[]>((acc, event) => {
      const text = describeStatus(event);
      if (!text) {
        return acc;
      }
      acc.push({
        id: `evt_${event.id}`,
        kind: "status",
        timestamp: event.timestamp,
        text,
      });
      return acc;
    }, []);

    const logEntries: StreamEntry[] = snapshot.logs.map((log) => ({
      id: `log_${log.id}`,
      kind: "log",
      timestamp: log.timestamp,
      source: log.source,
      content: log.content,
    }));

    const ordered = [...messageEntries, ...statusEntries, ...logEntries].sort((a, b) =>
      a.timestamp.localeCompare(b.timestamp),
    );

    const merged: StreamEntry[] = [];
    for (const entry of ordered) {
      if (entry.kind !== "log") {
        merged.push(entry);
        continue;
      }

      const previous = merged[merged.length - 1];
      if (previous && previous.kind === "log" && previous.source === entry.source) {
        previous.content = `${previous.content}\n${entry.content}`;
        previous.timestamp = entry.timestamp;
        continue;
      }

      merged.push({ ...entry });
    }

    return merged;
  }, [snapshot]);

  const toggleLog = (id: string) => {
    setOpenLogs((current) => ({
      ...current,
      [id]: !current[id],
    }));
  };

  return (
    <div className="messages">
      {entries.length === 0 ? (
        <div className="empty-state">
          <h3>会话已创建</h3>
          <p>输入一个任务开始流式执行，例如“请分析 auth 模块，并修复登录逻辑，再运行相关测试”。</p>
        </div>
      ) : null}

      {entries.map((entry) => {
        if (entry.kind === "message") {
          return (
            <article key={entry.id} className={`message-bubble message-${entry.role}`}>
              <div className="message-heading">
                <span>{entry.role === "user" ? "你" : "Codex"}</span>
                <time>
                  {new Date(entry.timestamp).toLocaleTimeString("zh-CN", {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  })}
                </time>
              </div>
              <div className="message-content">{entry.content}</div>
            </article>
          );
        }

        if (entry.kind === "status") {
          return (
            <div key={entry.id} className="status-line">
              <span className="status-dot" />
              <span>{entry.text}</span>
            </div>
          );
        }

        const isOpen = Boolean(openLogs[entry.id]);
        const lineCount = entry.content
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean).length;
        return (
          <article key={entry.id} className={`log-bubble log-${entry.source}`}>
            <div className="log-bubble-head">
              <span>
                {entry.source.toUpperCase()} 日志
                {lineCount > 1 ? ` (${lineCount} lines)` : ""}
              </span>
              <button type="button" className="ghost-button small-button" onClick={() => toggleLog(entry.id)}>
                {isOpen ? "收起" : "展开"}
              </button>
            </div>
            <pre className={`log-content ${isOpen ? "expanded" : "collapsed"}`}>
              {isOpen ? entry.content : toLogPreview(entry.content)}
            </pre>
          </article>
        );
      })}
    </div>
  );
}

