import type {
  ChatMessage,
  ConsoleEvent,
  ToolExecution,
} from "@codex-web-agent/shared";

type MutableSessionRecord = import("../sessions/store.js").SessionRecord;

function ensureAssistantMessage(record: MutableSessionRecord, event: ConsoleEvent): ChatMessage {
  const messageId = event.messageId || event.id;
  let message = record.messages.find((item) => item.id === messageId);
  if (!message) {
    message = {
      id: messageId,
      sessionId: event.sessionId,
      role: "assistant",
      content: "",
      createdAt: event.timestamp,
      agentId: event.agentId,
      agentRole: event.agentRole,
    };
    record.messages.push(message);
  }
  return message;
}

function upsertTool(record: MutableSessionRecord, tool: ToolExecution): void {
  const index = record.tools.findIndex((item) => item.id === tool.id);
  if (index >= 0) {
    record.tools[index] = {
      ...record.tools[index],
      ...tool,
    };
    return;
  }
  record.tools.unshift(tool);
}

export function applyEventToRecord(record: MutableSessionRecord, event: ConsoleEvent): void {
  if (event.type !== "session.snapshot") {
    record.timeline.push(event);
  }

  record.session.updatedAt = event.timestamp;
  record.session.currentPhase = event.phase || record.session.currentPhase;

  switch (event.type) {
    case "session.created":
      record.session.status = "idle";
      break;
    case "session.started":
      record.session.status = "running";
      break;
    case "session.completed":
      record.session.status = "completed";
      record.session.currentPhase = "completed";
      break;
    case "session.failed":
      record.session.status = "failed";
      record.session.currentPhase = "failed";
      break;
    case "session.stopped":
      record.session.status = "stopped";
      break;
    case "assistant.message_start":
      ensureAssistantMessage(record, event);
      break;
    case "assistant.message_delta": {
      const message = ensureAssistantMessage(record, event);
      message.content += event.content || "";
      record.session.lastAssistantMessage = message.content;
      break;
    }
    case "assistant.message_complete": {
      const message = ensureAssistantMessage(record, event);
      if (event.content && !message.content.endsWith(event.content)) {
        message.content = event.content;
      }
      record.session.lastAssistantMessage = message.content;
      break;
    }
    case "tool.execution_start":
    case "tool.execution_progress":
    case "tool.execution_complete":
    case "tool.execution_failed":
      if (event.toolCall) {
        upsertTool(record, event.toolCall);
      }
      break;
    case "file.changed":
      if (event.fileChange) {
        record.fileChanges.unshift(event.fileChange);
      }
      break;
    case "log.stdout":
    case "log.stderr":
      if (event.logEntry) {
        record.logs.push(event.logEntry);
      }
      break;
    default:
      break;
  }
}
