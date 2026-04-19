import type {
  ConsoleEvent,
  FileChange,
  RuntimePhase,
  SessionSummary,
  ToolExecution,
} from "@copilot-console/shared";
import { createId } from "../utils/ids.js";
import { nowIso } from "../utils/time.js";

interface CodexItem {
  id?: string;
  type?: string;
  status?: string;
  text?: string;
  title?: string;
  summary?: string;
  command?: string;
  exit_code?: number;
  stdout?: string;
  stderr?: string;
  path?: string;
  patch?: string;
  diff?: string;
  change_type?: string;
  tool_name?: string;
  provider?: string;
  query?: string;
  args?: unknown;
  steps?: Array<{ description?: string; status?: string }>;
  [key: string]: unknown;
}

export interface CodexRawEvent {
  type: string;
  thread_id?: string;
  turn_id?: string;
  usage?: Record<string, unknown>;
  error?: string | { message?: string };
  message?: string;
  item?: CodexItem;
  [key: string]: unknown;
}

function phaseFromItemType(type?: string): RuntimePhase {
  switch (type) {
    case "reasoning":
      return "thinking";
    case "plan_update":
      return "planning";
    case "web_search":
    case "mcp_tool_call":
      return "searching";
    case "file_read":
      return "reading";
    case "file_change":
    case "apply_patch":
      return "editing";
    case "command_execution":
      return "running";
    case "agent_message":
      return "summarizing";
    default:
      return "thinking";
  }
}

function toolStatusFromItemStatus(status?: string): ToolExecution["status"] {
  switch (status) {
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    case "pending":
      return "pending";
    default:
      return "running";
  }
}

function fileChangeType(value?: string): FileChange["changeType"] {
  switch (value) {
    case "added":
    case "created":
      return "created";
    case "deleted":
    case "removed":
      return "deleted";
    default:
      return "modified";
  }
}

export class CodexEventMapper {
  private readonly messageTextByItemId = new Map<string, string>();
  private readonly threadEventsSeen = new Set<string>();
  private turnSequence = 0;

  constructor(private readonly session: SessionSummary) {}

  map(raw: CodexRawEvent): ConsoleEvent[] {
    const timestamp = nowIso();
    const eventId = () => createId("evt");
    const base = (type: ConsoleEvent["type"], phase?: RuntimePhase): ConsoleEvent => ({
      id: eventId(),
      sessionId: this.session.id,
      type,
      timestamp,
      agentId: this.session.agentId,
      agentRole: this.session.agentRole,
      phase,
      raw,
    });

    if (raw.type === "thread.started") {
      const key = raw.thread_id || "default";
      if (this.threadEventsSeen.has(key)) {
        return [];
      }
      this.threadEventsSeen.add(key);
      return [
        {
          ...base("session.created", "idle"),
          message: raw.thread_id ? `Codex thread started: ${raw.thread_id}` : "Codex thread started",
          status: "idle",
        },
      ];
    }

    if (raw.type === "turn.started") {
      this.turnSequence += 1;
      this.messageTextByItemId.clear();
      return [
        {
          ...base("session.started", "planning"),
          message: "Codex started a new turn",
          status: "running",
        },
      ];
    }

    if (raw.type === "turn.completed") {
      return [
        {
          ...base("session.completed", "completed"),
          message: "Codex completed the current turn",
          status: "completed",
        },
      ];
    }

    if (raw.type === "turn.failed") {
      return [
        {
          ...base("session.failed", "failed"),
          message: "Codex failed the current turn",
          status: "failed",
        },
      ];
    }

    if (raw.type === "error") {
      const message =
        typeof raw.error === "string"
          ? raw.error
          : raw.error?.message || raw.message || "Unknown Codex error";
      return [
        {
          ...base("session.failed", "failed"),
          message,
          status: "failed",
        },
      ];
    }

    if (!raw.type.startsWith("item.") || !raw.item) {
      return [];
    }

    const item = raw.item;
    const itemId = item.id || createId("item");
    const phase = phaseFromItemType(item.type);
    const events: ConsoleEvent[] = [];

    if (item.type === "agent_message") {
      const turnKey = raw.turn_id || `turn_${this.turnSequence}`;
      const messageKey = `${turnKey}:${itemId}`;

      if (raw.type === "item.started") {
        events.push({
          ...base("assistant.message_start", phase),
          messageId: messageKey,
        });
      }

      const nextText = typeof item.text === "string" ? item.text : "";
      const previousText = this.messageTextByItemId.get(messageKey) || "";
      const delta = nextText.startsWith(previousText) ? nextText.slice(previousText.length) : nextText;
      if (nextText) {
        this.messageTextByItemId.set(messageKey, nextText);
      }

      if (raw.type === "item.updated" && delta) {
        events.push({
          ...base("assistant.message_delta", phase),
          messageId: messageKey,
          content: delta,
        });
      }

      if (raw.type === "item.completed") {
        events.push({
          ...base("assistant.message_complete", "completed"),
          messageId: messageKey,
          content: nextText || previousText,
        });
      }

      return events;
    }

    if (item.type === "reasoning") {
      const content = typeof item.text === "string" ? item.text : item.summary || item.title;
      events.push({
        ...base("assistant.intent", phase),
        message: typeof content === "string" ? content : "Codex reasoning update",
      });
      return events;
    }

    if (item.type === "plan_update") {
      const steps = Array.isArray(item.steps)
        ? item.steps
            .map((step) => `${step.status || "pending"}: ${step.description || "step"}`)
            .join(" | ")
        : undefined;
      events.push({
        ...base("assistant.intent", "planning"),
        message: steps || item.summary || item.title || "Codex updated the execution plan",
      });
      return events;
    }

    if (item.type === "file_change" || item.type === "apply_patch") {
      if (raw.type === "item.completed" || raw.type === "item.updated") {
        events.push({
          ...base("file.changed", "editing"),
          fileChange: {
            id: itemId,
            sessionId: this.session.id,
            path: (item.path as string) || "unknown",
            changeType: fileChangeType(item.change_type as string | undefined),
            summary:
              (item.summary as string) ||
              (item.title as string) ||
              `Codex ${raw.type === "item.completed" ? "updated" : "is updating"} ${(item.path as string) || "a file"}`,
            patch: (item.patch as string) || (item.diff as string) || undefined,
            timestamp,
            agentId: this.session.agentId,
            agentRole: this.session.agentRole,
          },
        });
      }
      return events;
    }

    if (item.type === "command_execution" || item.type === "mcp_tool_call" || item.type === "web_search") {
      const toolName =
        (item.tool_name as string) ||
        (item.type === "command_execution"
          ? "run_command"
          : item.type === "mcp_tool_call"
            ? "mcp_tool"
            : "web_search");

      const toolCall: ToolExecution = {
        id: itemId,
        sessionId: this.session.id,
        name: toolName,
        status: toolStatusFromItemStatus(item.status as string | undefined),
        summary:
          (item.summary as string) ||
          (item.title as string) ||
          (item.command as string) ||
          (item.query as string) ||
          `${toolName} ${raw.type.replace("item.", "")}`,
        startedAt: timestamp,
        endedAt: raw.type === "item.completed" || raw.type === "item.failed" ? timestamp : null,
        inputSummary:
          (item.command as string) ||
          (item.query as string) ||
          (typeof item.args === "string" ? item.args : undefined),
        outputSummary:
          typeof item.exit_code === "number" ? `exit code ${item.exit_code}` : undefined,
        errorMessage: raw.type === "item.failed" ? "Codex reported this tool call as failed" : undefined,
        agentId: this.session.agentId,
        agentRole: this.session.agentRole,
      };

      const toolEventType =
        raw.type === "item.completed"
          ? "tool.execution_complete"
          : raw.type === "item.failed"
            ? "tool.execution_failed"
            : raw.type === "item.updated"
              ? "tool.execution_progress"
              : "tool.execution_start";

      events.push({
        ...base(toolEventType, phase),
        toolCall,
      });

      if (typeof item.stdout === "string" && item.stdout.trim()) {
        events.push({
          ...base("log.stdout", phase),
          logEntry: {
            id: createId("log"),
            sessionId: this.session.id,
            source: "stdout",
            content: item.stdout,
            timestamp,
            agentId: this.session.agentId,
            agentRole: this.session.agentRole,
          },
        });
      }

      if (typeof item.stderr === "string" && item.stderr.trim()) {
        events.push({
          ...base("log.stderr", phase),
          logEntry: {
            id: createId("log"),
            sessionId: this.session.id,
            source: "stderr",
            content: item.stderr,
            timestamp,
            agentId: this.session.agentId,
            agentRole: this.session.agentRole,
          },
        });
      }

      return events;
    }

    events.push({
      ...base("assistant.intent", phase),
      message: item.summary || item.title || `Codex item event: ${item.type || "unknown"}`,
    });
    return events;
  }
}
