import type {
  ConsoleEvent,
  FileChange,
  RuntimePhase,
  SessionSummary,
  ToolExecution,
} from "@codex-web-agent/shared";
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
  aggregated_output?: string;
  path?: string;
  patch?: string;
  diff?: string;
  change_type?: string;
  tool_name?: string;
  provider?: string;
  query?: string;
  args?: unknown;
  steps?: Array<{ description?: string; status?: string }>;
  items?: Array<{ text?: string; completed?: boolean }>;
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

function trimSummaryText(value: string, maxLength = 360): string {
  const normalized = value.replace(/\r/g, "").trim();
  if (!normalized) {
    return "";
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength)}...`;
}

function buildToolOutputSummary(item: CodexItem): string | undefined {
  const parts: string[] = [];
  let hasExplicitStreamOutput = false;

  if (typeof item.exit_code === "number") {
    parts.push(`exit code ${item.exit_code}`);
  }

  if (typeof item.stdout === "string") {
    const stdout = trimSummaryText(item.stdout);
    if (stdout) {
      parts.push(`stdout: ${stdout}`);
      hasExplicitStreamOutput = true;
    }
  }

  if (typeof item.stderr === "string") {
    const stderr = trimSummaryText(item.stderr);
    if (stderr) {
      parts.push(`stderr: ${stderr}`);
      hasExplicitStreamOutput = true;
    }
  }

  if (!hasExplicitStreamOutput && typeof item.aggregated_output === "string") {
    const aggregated = trimSummaryText(item.aggregated_output);
    if (aggregated) {
      parts.push(`output: ${aggregated}`);
    }
  }

  return parts.length > 0 ? parts.join("\n") : undefined;
}

interface NormalizedTodoStep {
  text: string;
  status: "pending" | "in_progress" | "completed";
}

function normalizeTodoStepStatus(value?: string, completed?: boolean): "pending" | "in_progress" | "completed" {
  if (completed) {
    return "completed";
  }

  const normalized = (value || "").trim().toLowerCase();
  if (!normalized) {
    return "pending";
  }

  if (normalized === "completed" || normalized === "complete" || normalized === "done" || normalized === "finished") {
    return "completed";
  }

  if (normalized === "in_progress" || normalized === "in-progress" || normalized.includes("progress")) {
    return "in_progress";
  }

  return "pending";
}

function normalizeTodoSteps(item: CodexItem): NormalizedTodoStep[] {
  if (Array.isArray(item.steps) && item.steps.length > 0) {
    return item.steps.map((step) => ({
      text: (step.description || "未命名步骤").trim(),
      status: normalizeTodoStepStatus(step.status),
    }));
  }

  if (Array.isArray(item.items) && item.items.length > 0) {
    return item.items.map((step) => ({
      text: (step.text || "未命名步骤").trim(),
      status: normalizeTodoStepStatus(undefined, Boolean(step.completed)),
    }));
  }

  return [];
}

function buildTodoProgressMessage(rawType: string, steps: NormalizedTodoStep[]): string | null {
  if (rawType === "item.completed") {
    return null;
  }

  const action = rawType === "item.started" ? "执行计划已创建" : "执行计划已更新";
  if (steps.length === 0) {
    if (rawType === "item.started") {
      return `${action}。下一步：正在生成任务清单。`;
    }
    return `${action}。下一步：继续执行计划。`;
  }

  const completedCount = steps.filter((step) => step.status === "completed").length;
  const inProgress = steps.find((step) => step.status === "in_progress");
  const nextPending = steps.find((step) => step.status === "pending");
  const nextStep = inProgress || nextPending;

  if (nextStep) {
    return `${action}：已完成 ${completedCount}/${steps.length}。下一步：${nextStep.text}`;
  }

  return `${action}：已完成 ${completedCount}/${steps.length}。下一步：整理结果并回复。`;
}

function buildTodoReplyMessage(rawType: string, steps: NormalizedTodoStep[]): string | null {
  if (rawType === "item.completed") {
    return null;
  }

  const completedCount = steps.filter((step) => step.status === "completed").length;
  const inProgress = steps.find((step) => step.status === "in_progress");
  const nextPending = steps.find((step) => step.status === "pending");
  const nextStep = inProgress || nextPending;

  if (rawType === "item.started") {
    if (nextStep) {
      return `我已创建执行计划，当前先处理：${nextStep.text}。我会在关键进展时继续同步。`;
    }
    return "我已创建执行计划。下一步我会先拆解任务并开始第一步。";
  }

  if (steps.length === 0) {
    return "进展已更新。下一步我会继续推进当前任务并同步结果。";
  }

  if (nextStep) {
    return `进展：已完成 ${completedCount}/${steps.length}。下一步我会处理：${nextStep.text}。`;
  }

  return `进展：已完成 ${completedCount}/${steps.length}。下一步我会整理结果并给出结论。`;
}

export class CodexEventMapper {
  private readonly messageTextByItemId = new Map<string, string>();
  private readonly threadEventsSeen = new Set<string>();
  private readonly syntheticItemIds = new Map<string, string>();
  private readonly todoStepsByItemId = new Map<string, NormalizedTodoStep[]>();
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
      this.syntheticItemIds.clear();
      this.todoStepsByItemId.clear();
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
    const itemId = this.resolveItemId(raw, item);
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
      const steps = normalizeTodoSteps(item);
      events.push({
        ...base("assistant.intent", "planning"),
        message: "执行计划已更新",
      });

      const reply = buildTodoReplyMessage(raw.type, steps);
      if (reply) {
        events.push({
          ...base("assistant.message_complete", "planning"),
          messageId: `${raw.turn_id || `turn_${this.turnSequence}`}:plan_summary:${itemId}:${raw.type}:${timestamp}`,
          content: reply,
        });
      }

      return events;
    }

    if (item.type === "todo_list") {
      const incomingSteps = normalizeTodoSteps(item);
      const cachedSteps = this.todoStepsByItemId.get(itemId) || [];
      const effectiveSteps = incomingSteps.length > 0 ? incomingSteps : cachedSteps;
      if (incomingSteps.length > 0) {
        this.todoStepsByItemId.set(itemId, incomingSteps);
      }

      const message = buildTodoProgressMessage(raw.type, effectiveSteps);
      if (message) {
        events.push({
          ...base("assistant.intent", "planning"),
          message,
        });
      }

      const reply = buildTodoReplyMessage(raw.type, effectiveSteps);
      if (reply) {
        events.push({
          ...base("assistant.message_complete", "planning"),
          messageId: `${raw.turn_id || `turn_${this.turnSequence}`}:todo_summary:${itemId}:${raw.type}:${timestamp}`,
          content: reply,
        });
      }

      if (raw.type === "item.completed") {
        this.todoStepsByItemId.delete(itemId);
      }

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
        outputSummary: buildToolOutputSummary(item),
        errorMessage:
          raw.type === "item.failed"
            ? trimSummaryText(typeof item.stderr === "string" ? item.stderr : "") ||
              "Codex reported this tool call as failed"
            : undefined,
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
      message:
        item.summary ||
        item.title ||
        `Codex item ${raw.type.replace("item.", "")}: ${item.type || "unknown"}`,
    });
    return events;
  }

  private resolveItemId(raw: CodexRawEvent, item: CodexItem): string {
    if (typeof item.id === "string" && item.id.trim()) {
      return item.id.trim();
    }

    const turnKey = raw.turn_id || `turn_${this.turnSequence}`;
    const signature = [
      turnKey,
      item.type || "unknown",
      typeof item.command === "string" ? item.command : "",
      typeof item.query === "string" ? item.query : "",
      typeof item.title === "string" ? item.title : "",
      typeof item.path === "string" ? item.path : "",
    ].join("|");

    const existing = this.syntheticItemIds.get(signature);
    if (existing) {
      return existing;
    }

    const generated = createId("item");
    this.syntheticItemIds.set(signature, generated);
    return generated;
  }
}
