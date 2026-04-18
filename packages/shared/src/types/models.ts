import type {
  CONSOLE_EVENT_TYPES,
  RUNTIME_PHASES,
  SESSION_STATUSES,
  TOOL_STATUSES,
} from "../constants/runtime.js";

export type SessionStatus = (typeof SESSION_STATUSES)[number];
export type RuntimePhase = (typeof RUNTIME_PHASES)[number];
export type ToolStatus = (typeof TOOL_STATUSES)[number];
export type ConsoleEventType = (typeof CONSOLE_EVENT_TYPES)[number];

export type RuntimeName = "copilot-cli" | "codex-cli";
export type SandboxMode = "read-only" | "workspace-write" | "danger-full-access";
export type MessageRole = "user" | "assistant" | "system";

export interface SessionSummary {
  id: string;
  title: string;
  status: SessionStatus;
  workspacePath: string;
  createdAt: string;
  updatedAt: string;
  runtime: RuntimeName;
  agentId: string;
  agentRole: string;
  currentPhase: RuntimePhase;
  runtimeProfile?: string;
  model?: string;
  sandboxMode?: SandboxMode;
  lastUserMessage?: string;
  lastAssistantMessage?: string;
}

export interface ChatMessage {
  id: string;
  sessionId: string;
  role: MessageRole;
  content: string;
  createdAt: string;
  agentId?: string;
  agentRole?: string;
}

export interface ToolExecution {
  id: string;
  sessionId: string;
  name: string;
  status: ToolStatus;
  summary: string;
  startedAt: string;
  endedAt: string | null;
  inputSummary?: string;
  outputSummary?: string;
  errorMessage?: string;
  agentId: string;
  agentRole: string;
}

export type FileChangeType = "created" | "modified" | "deleted";

export interface FileChange {
  id: string;
  sessionId: string;
  path: string;
  changeType: FileChangeType;
  summary: string;
  patch?: string;
  timestamp: string;
  agentId: string;
  agentRole: string;
}

export interface LogEntry {
  id: string;
  sessionId: string;
  source: "stdout" | "stderr";
  content: string;
  timestamp: string;
  agentId: string;
  agentRole: string;
}

export interface ConsoleEvent {
  id: string;
  sessionId: string;
  type: ConsoleEventType;
  timestamp: string;
  agentId: string;
  agentRole: string;
  phase?: RuntimePhase;
  title?: string;
  message?: string;
  content?: string;
  status?: SessionStatus;
  messageId?: string;
  toolCall?: ToolExecution;
  fileChange?: FileChange;
  logEntry?: LogEntry;
  raw?: unknown;
  snapshot?: SessionSnapshot;
}

export interface SessionSnapshot {
  session: SessionSummary;
  messages: ChatMessage[];
  tools: ToolExecution[];
  logs: LogEntry[];
  fileChanges: FileChange[];
  timeline: ConsoleEvent[];
}

export interface CreateSessionInput {
  title?: string;
  workspacePath: string;
  runtime?: RuntimeName;
  runtimeProfile?: string;
  model?: string;
  sandboxMode?: SandboxMode;
  agentId?: string;
  agentRole?: string;
}

export interface SendMessageInput {
  content: string;
}
