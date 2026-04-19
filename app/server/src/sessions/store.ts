import type {
  ChatMessage,
  ConsoleEvent,
  CreateSessionInput,
  FileChange,
  LogEntry,
  SessionSnapshot,
  SessionSummary,
  ToolExecution,
} from "@copilot-console/shared";
import { createId } from "../utils/ids.js";
import { nowIso } from "../utils/time.js";

export interface SessionRecord {
  session: SessionSummary;
  messages: ChatMessage[];
  tools: ToolExecution[];
  logs: LogEntry[];
  fileChanges: FileChange[];
  timeline: ConsoleEvent[];
  runtimeSubscription?: () => void;
}

export class SessionStore {
  private records = new Map<string, SessionRecord>();
  private currentSessionId: string | null = null;

  createPendingSession(input: CreateSessionInput): SessionRecord {
    const timestamp = nowIso();
    const session: SessionSummary = {
      id: createId("sess"),
      title: input.title?.trim() || "Copilot CLI Session",
      status: "idle",
      workspacePath: input.workspacePath,
      createdAt: timestamp,
      updatedAt: timestamp,
      runtime: input.runtime || "copilot-cli",
      agentId: input.agentId || "default",
      agentRole: input.agentRole || "general",
      currentPhase: "idle",
      runtimeProfile: input.runtimeProfile,
      model: input.model,
      sandboxMode: input.sandboxMode,
    };

    const record: SessionRecord = {
      session,
      messages: [],
      tools: [],
      logs: [],
      fileChanges: [],
      timeline: [],
    };

    this.records.set(session.id, record);
    this.currentSessionId = session.id;
    return record;
  }

  finalizeSession(session: SessionSummary): SessionRecord {
    const record = this.getRecord(session.id);
    record.session = session;
    return record;
  }

  getRecord(sessionId: string): SessionRecord {
    const record = this.records.get(sessionId);
    if (!record) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    return record;
  }

  getCurrentSession(): SessionRecord | null {
    if (!this.currentSessionId) {
      return null;
    }
    return this.records.get(this.currentSessionId) || null;
  }

  listSessions(): SessionSummary[] {
    return [...this.records.values()]
      .map((record) => record.session)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  setRuntimeSubscription(sessionId: string, unsubscribe: () => void): void {
    this.getRecord(sessionId).runtimeSubscription = unsubscribe;
  }

  appendUserMessage(sessionId: string, content: string): ChatMessage {
    const record = this.getRecord(sessionId);
    const message: ChatMessage = {
      id: createId("msg"),
      sessionId,
      role: "user",
      content,
      createdAt: nowIso(),
      agentId: record.session.agentId,
      agentRole: record.session.agentRole,
    };

    record.messages.push(message);
    record.session.lastUserMessage = content;
    record.session.updatedAt = message.createdAt;
    return message;
  }

  updateSessionTitle(sessionId: string, title: string): SessionSummary {
    const record = this.getRecord(sessionId);
    const normalized = title.trim();
    if (!normalized) {
      return record.session;
    }

    record.session = {
      ...record.session,
      title: normalized.slice(0, 120),
      updatedAt: nowIso(),
    };
    return record.session;
  }

  getSnapshot(sessionId: string): SessionSnapshot {
    const record = this.getRecord(sessionId);
    return {
      session: record.session,
      messages: record.messages,
      tools: record.tools,
      logs: record.logs,
      fileChanges: record.fileChanges,
      timeline: record.timeline,
    };
  }

  deleteSession(sessionId: string): void {
    const record = this.records.get(sessionId);
    record?.runtimeSubscription?.();
    this.records.delete(sessionId);
    if (this.currentSessionId === sessionId) {
      this.currentSessionId = null;
    }
  }
}
