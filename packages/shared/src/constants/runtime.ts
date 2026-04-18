export const SESSION_STATUSES = [
  "idle",
  "running",
  "waiting_input",
  "stopped",
  "completed",
  "failed",
] as const;

export const TOOL_STATUSES = [
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
] as const;

export const RUNTIME_PHASES = [
  "thinking",
  "planning",
  "searching",
  "reading",
  "editing",
  "creating",
  "running",
  "approval",
  "summarizing",
  "completed",
  "failed",
  "idle",
] as const;

export const CONSOLE_EVENT_TYPES = [
  "session.snapshot",
  "session.created",
  "session.started",
  "session.completed",
  "session.failed",
  "session.stopped",
  "assistant.message_start",
  "assistant.message_delta",
  "assistant.message_complete",
  "assistant.intent",
  "tool.execution_start",
  "tool.execution_progress",
  "tool.execution_complete",
  "tool.execution_failed",
  "file.changed",
  "log.stdout",
  "log.stderr",
  "approval.requested",
  "approval.resolved",
] as const;

