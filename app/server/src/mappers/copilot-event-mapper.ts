import type {
  ConsoleEvent,
  FileChange,
  RuntimePhase,
  SessionSummary,
  ToolExecution,
} from "@copilot-console/shared";
import { createId } from "../utils/ids.js";
import { nowIso } from "../utils/time.js";

export interface CopilotRawEvent {
  type: string;
  timestamp?: string;
  phase?: RuntimePhase;
  title?: string;
  message?: string;
  content?: string;
  status?: string;
  agentId?: string;
  agentRole?: string;
  messageId?: string;
  tool?: {
    id?: string;
    name: string;
    status?: ToolExecution["status"];
    summary?: string;
    inputSummary?: string;
    outputSummary?: string;
    errorMessage?: string;
    startedAt?: string;
    endedAt?: string | null;
  };
  file?: {
    id?: string;
    path: string;
    changeType: FileChange["changeType"];
    summary: string;
    patch?: string;
  };
  log?: {
    id?: string;
    source: "stdout" | "stderr";
    content: string;
  };
  raw?: unknown;
}

function baseEvent(
  session: SessionSummary,
  raw: CopilotRawEvent,
  type: ConsoleEvent["type"],
): ConsoleEvent {
  return {
    id: createId("evt"),
    sessionId: session.id,
    type,
    timestamp: raw.timestamp || nowIso(),
    agentId: raw.agentId || session.agentId,
    agentRole: raw.agentRole || session.agentRole,
    phase: raw.phase,
    title: raw.title,
    message: raw.message,
    raw,
  };
}

function mapTool(session: SessionSummary, raw: CopilotRawEvent): ToolExecution | undefined {
  if (!raw.tool) {
    return undefined;
  }
  return {
    id: raw.tool.id || createId("tool"),
    sessionId: session.id,
    name: raw.tool.name,
    status: raw.tool.status || "running",
    summary: raw.tool.summary || raw.tool.name,
    startedAt: raw.tool.startedAt || raw.timestamp || nowIso(),
    endedAt: raw.tool.endedAt || null,
    inputSummary: raw.tool.inputSummary,
    outputSummary: raw.tool.outputSummary,
    errorMessage: raw.tool.errorMessage,
    agentId: raw.agentId || session.agentId,
    agentRole: raw.agentRole || session.agentRole,
  };
}

function mapFileChange(session: SessionSummary, raw: CopilotRawEvent): FileChange | undefined {
  if (!raw.file) {
    return undefined;
  }
  return {
    id: raw.file.id || createId("chg"),
    sessionId: session.id,
    path: raw.file.path,
    changeType: raw.file.changeType,
    summary: raw.file.summary,
    patch: raw.file.patch,
    timestamp: raw.timestamp || nowIso(),
    agentId: raw.agentId || session.agentId,
    agentRole: raw.agentRole || session.agentRole,
  };
}

export function mapCopilotRawEvent(session: SessionSummary, raw: CopilotRawEvent): ConsoleEvent | null {
  switch (raw.type) {
    case "session.ready":
      return {
        ...baseEvent(session, raw, "session.created"),
        phase: "idle",
        status: "idle",
        message: raw.message || "Copilot CLI session ready",
      };
    case "run.started":
      return {
        ...baseEvent(session, raw, "session.started"),
        phase: raw.phase || "planning",
        status: "running",
      };
    case "assistant.start":
      return {
        ...baseEvent(session, raw, "assistant.message_start"),
        messageId: raw.messageId || createId("msg"),
      };
    case "assistant.delta":
      return {
        ...baseEvent(session, raw, "assistant.message_delta"),
        messageId: raw.messageId,
        content: raw.content || "",
      };
    case "assistant.complete":
      return {
        ...baseEvent(session, raw, "assistant.message_complete"),
        messageId: raw.messageId,
        content: raw.content,
      };
    case "assistant.intent":
      return {
        ...baseEvent(session, raw, "assistant.intent"),
        content: raw.content,
      };
    case "tool.start":
      return {
        ...baseEvent(session, raw, "tool.execution_start"),
        toolCall: mapTool(session, raw),
      };
    case "tool.progress":
      return {
        ...baseEvent(session, raw, "tool.execution_progress"),
        toolCall: mapTool(session, raw),
      };
    case "tool.complete":
      return {
        ...baseEvent(session, raw, "tool.execution_complete"),
        toolCall: mapTool(session, raw),
      };
    case "tool.failed":
      return {
        ...baseEvent(session, raw, "tool.execution_failed"),
        toolCall: mapTool(session, raw),
      };
    case "file.change":
      return {
        ...baseEvent(session, raw, "file.changed"),
        fileChange: mapFileChange(session, raw),
      };
    case "log.stdout":
      return {
        ...baseEvent(session, raw, "log.stdout"),
        logEntry: raw.log
          ? {
              id: raw.log.id || createId("log"),
              sessionId: session.id,
              source: "stdout",
              content: raw.log.content,
              timestamp: raw.timestamp || nowIso(),
              agentId: raw.agentId || session.agentId,
              agentRole: raw.agentRole || session.agentRole,
            }
          : undefined,
      };
    case "log.stderr":
      return {
        ...baseEvent(session, raw, "log.stderr"),
        logEntry: raw.log
          ? {
              id: raw.log.id || createId("log"),
              sessionId: session.id,
              source: "stderr",
              content: raw.log.content,
              timestamp: raw.timestamp || nowIso(),
              agentId: raw.agentId || session.agentId,
              agentRole: raw.agentRole || session.agentRole,
            }
          : undefined,
      };
    case "approval.requested":
      return baseEvent(session, raw, "approval.requested");
    case "approval.resolved":
      return baseEvent(session, raw, "approval.resolved");
    case "run.completed":
      return {
        ...baseEvent(session, raw, "session.completed"),
        phase: "completed",
        status: "completed",
      };
    case "run.failed":
      return {
        ...baseEvent(session, raw, "session.failed"),
        phase: "failed",
        status: "failed",
      };
    case "run.stopped":
      return {
        ...baseEvent(session, raw, "session.stopped"),
        phase: raw.phase || "idle",
        status: "stopped",
      };
    default:
      return {
        ...baseEvent(session, raw, "assistant.intent"),
        message: raw.message || `Unmapped Copilot event: ${raw.type}`,
      };
  }
}

