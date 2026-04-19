import type { ConsoleEvent, SessionSnapshot, ToolExecution, ToolStatus } from "@copilot-console/shared";
import { Check, ChevronDown, Loader2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type WheelEvent as ReactWheelEvent } from "react";

interface MessageListProps {
  snapshot: SessionSnapshot | null;
}

type StreamEntry =
  | {
      id: string;
      kind: "message";
      messageId: string;
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
      kind: "tool";
      timestamp: string;
      status: ToolStatus;
      summary: string;
      detail: string;
    }
  | {
      id: string;
      kind: "log";
      timestamp: string;
      source: "stdout" | "stderr";
      content: string;
    };

function normalizeSingleLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function describeStatus(event: ConsoleEvent): string | null {
  const message = event.message || event.content || "";
  if (message.includes("用户消息已接收") || message.includes("开始执行 Codex CLI")) {
    return null;
  }

  switch (event.type) {
    case "assistant.intent":
      return message || "Agent 更新了执行意图";
    case "file.changed":
      return `文件 ${event.fileChange?.path || "unknown"}: ${event.fileChange?.summary || "已变更"}`;
    default:
      return null;
  }
}

function buildToolSummary(tool: ToolExecution): string {
  const summary = normalizeSingleLine(tool.summary || "");
  if (summary) {
    return summary;
  }
  return normalizeSingleLine(tool.name || "tool");
}

function buildToolDetail(tool: ToolExecution): string {
  const parts: string[] = [];
  if (tool.inputSummary?.trim()) {
    parts.push(`输入: ${tool.inputSummary.trim()}`);
  }
  if (tool.outputSummary?.trim()) {
    parts.push(`输出: ${tool.outputSummary.trim()}`);
  }
  if (tool.errorMessage?.trim()) {
    parts.push(`错误: ${tool.errorMessage.trim()}`);
  }

  if (parts.length === 0) {
    return buildToolSummary(tool);
  }

  return parts.join("\n");
}

function ToolStateIcon({ status }: { status: ToolStatus }) {
  if (status === "running" || status === "pending") {
    return (
      <span className="tool-status-icon running" aria-label="running">
        <Loader2 className="tool-icon-spin" size={12} />
      </span>
    );
  }

  if (status === "completed") {
    return (
      <span className="tool-status-icon completed" aria-label="completed">
        <Check size={12} />
      </span>
    );
  }

  if (status === "failed" || status === "cancelled") {
    return (
      <span className="tool-status-icon failed" aria-label="failed">
        <X size={12} />
      </span>
    );
  }

  return <span className="tool-status-icon" aria-label={status} />;
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
  const [typedAssistantById, setTypedAssistantById] = useState<Record<string, string>>({});
  const listRef = useRef<HTMLDivElement | null>(null);
  const typingTimersRef = useRef<Record<string, number>>({});
  const typedAssistantRef = useRef<Record<string, string>>({});
  const sessionRef = useRef<string | null>(null);

  const entries = useMemo<StreamEntry[]>(() => {
    if (!snapshot) {
      return [];
    }

    const messageEntries: StreamEntry[] = snapshot.messages.map((message) => ({
      id: `msg_${message.id}`,
      kind: "message",
      messageId: message.id,
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

    const toolEntries: StreamEntry[] = snapshot.tools.map((tool) => ({
      id: `tool_${tool.id}`,
      kind: "tool",
      timestamp: tool.endedAt || tool.startedAt,
      status: tool.status,
      summary: buildToolSummary(tool),
      detail: buildToolDetail(tool),
    }));

    const logEntries: StreamEntry[] = snapshot.logs.map((log) => ({
      id: `log_${log.id}`,
      kind: "log",
      timestamp: log.timestamp,
      source: log.source,
      content: log.content,
    }));

    const kindOrder: Record<StreamEntry["kind"], number> = {
      message: 0,
      status: 1,
      tool: 2,
      log: 3,
    };
    const ordered = [...messageEntries, ...statusEntries, ...toolEntries, ...logEntries].sort((a, b) => {
      const delta = a.timestamp.localeCompare(b.timestamp);
      if (delta !== 0) {
        return delta;
      }
      return kindOrder[a.kind] - kindOrder[b.kind];
    });

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

  useEffect(() => {
    typedAssistantRef.current = typedAssistantById;
  }, [typedAssistantById]);

  useEffect(() => {
    const sessionId = snapshot?.session.id || null;
    if (sessionRef.current === sessionId) {
      return;
    }

    for (const timeoutId of Object.values(typingTimersRef.current)) {
      window.clearTimeout(timeoutId);
    }
    typingTimersRef.current = {};
    typedAssistantRef.current = {};
    setTypedAssistantById({});
    sessionRef.current = sessionId;
  }, [snapshot?.session.id]);

  useEffect(() => {
    if (!snapshot) {
      return;
    }

    const assistantMessages = snapshot.messages.filter((message) => message.role === "assistant");
    const lastAssistantId = assistantMessages[assistantMessages.length - 1]?.id;

    setTypedAssistantById((current) => {
      const next: Record<string, string> = {};
      const hadAssistantState = Object.keys(current).length > 0;
      for (const message of assistantMessages) {
        const existing = current[message.id];
        if (existing === undefined) {
          const shouldAnimate =
            message.id === lastAssistantId && (snapshot.session.status === "running" || hadAssistantState);
          next[message.id] = shouldAnimate ? "" : message.content;
          continue;
        }

        if (existing.length > message.content.length || !message.content.startsWith(existing)) {
          next[message.id] = message.content;
          continue;
        }

        next[message.id] = existing;
      }
      return next;
    });
  }, [snapshot]);

  useEffect(() => {
    if (!snapshot) {
      return;
    }

    const assistantMessages = snapshot.messages.filter((message) => message.role === "assistant");
    const assistantIds = new Set(assistantMessages.map((message) => message.id));

    for (const [messageId, timeoutId] of Object.entries(typingTimersRef.current)) {
      if (!assistantIds.has(messageId)) {
        window.clearTimeout(timeoutId);
        delete typingTimersRef.current[messageId];
      }
    }

    for (const message of assistantMessages) {
      const typed = typedAssistantById[message.id] || "";
      const target = message.content;

      if (typed.length >= target.length) {
        const timeoutId = typingTimersRef.current[message.id];
        if (timeoutId) {
          window.clearTimeout(timeoutId);
          delete typingTimersRef.current[message.id];
        }
        continue;
      }

      if (typingTimersRef.current[message.id]) {
        continue;
      }

      const tick = () => {
        const currentValue = typedAssistantRef.current[message.id] || "";
        if (currentValue.length >= target.length) {
          delete typingTimersRef.current[message.id];
          return;
        }

        const nextChunk = Math.max(1, Math.ceil((target.length - currentValue.length) / 20));
        const nextLength = Math.min(target.length, currentValue.length + nextChunk);
        const nextValue = target.slice(0, nextLength);

        typedAssistantRef.current = {
          ...typedAssistantRef.current,
          [message.id]: nextValue,
        };

        setTypedAssistantById((current) => {
          if (current[message.id] === nextValue) {
            return current;
          }
          return {
            ...current,
            [message.id]: nextValue,
          };
        });

        if (nextLength >= target.length) {
          delete typingTimersRef.current[message.id];
          return;
        }

        typingTimersRef.current[message.id] = window.setTimeout(tick, 18);
      };

      typingTimersRef.current[message.id] = window.setTimeout(tick, 18);
    }
  }, [snapshot, typedAssistantById]);

  useEffect(() => () => {
    for (const timeoutId of Object.values(typingTimersRef.current)) {
      window.clearTimeout(timeoutId);
    }
    typingTimersRef.current = {};
  }, []);

  const stopWheelPropagation = (event: ReactWheelEvent<HTMLElement>) => {
    event.stopPropagation();
  };

  useEffect(() => {
    if (!listRef.current) {
      return;
    }
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [entries.length, typedAssistantById]);

  return (
    <div className="messages" ref={listRef}>
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
              <div className="message-content">
                {entry.role === "assistant"
                  ? typedAssistantById[entry.messageId] || entry.content
                  : entry.content}
              </div>
            </article>
          );
        }

        if (entry.kind === "status") {
          return (
            <div key={entry.id} className="status-line">
              <span className="status-dot">
                <span className="status-dot-core" />
              </span>
              <span>{entry.text}</span>
            </div>
          );
        }

        if (entry.kind === "tool") {
          const hasExtraDetail = normalizeSingleLine(entry.detail) !== normalizeSingleLine(entry.summary);
          return (
            <details key={entry.id} className={`tool-line tool-${entry.status}`}>
              <summary className="tool-line-summary">
                <ToolStateIcon status={entry.status} />
                <span className="tool-line-text" title={entry.summary}>
                  {entry.summary}
                </span>
                {hasExtraDetail ? <ChevronDown className="tool-line-caret" size={14} /> : null}
              </summary>
              {hasExtraDetail ? (
                <pre className="tool-line-detail" onWheelCapture={stopWheelPropagation}>
                  {entry.detail}
                </pre>
              ) : null}
            </details>
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
            <pre
              className={`log-content ${isOpen ? "expanded" : "collapsed"}`}
              onWheelCapture={isOpen ? stopWheelPropagation : undefined}
            >
              {isOpen ? entry.content : toLogPreview(entry.content)}
            </pre>
          </article>
        );
      })}
    </div>
  );
}

