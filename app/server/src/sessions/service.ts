import type { ConsoleEvent, CreateSessionInput, RuntimeName, SessionSnapshot, SessionSummary } from "@copilot-console/shared";
import { EventBroker } from "../events/broker.js";
import { applyEventToRecord } from "../events/reducer.js";
import type { RuntimeAdapter, RuntimeLoginResult } from "../runtime/runtime-adapter.js";
import { RuntimeRegistry } from "../runtime/runtime-registry.js";
import { SessionStore } from "./store.js";

export class SessionService {
  private readonly adaptersBySessionId = new Map<string, RuntimeAdapter>();

  constructor(
    private readonly store: SessionStore,
    private readonly runtimes: RuntimeRegistry,
    private readonly broker: EventBroker,
  ) {}

  async createSession(input: CreateSessionInput): Promise<SessionSnapshot> {
    const current = this.store.getCurrentSession();
    if (current && current.session.status === "running") {
      throw new Error("An active running session already exists. Stop it before creating a new one.");
    }

    const pending = this.store.createPendingSession(input);
    const adapter = this.runtimes.getAdapter(input.runtime);
    const session = await adapter.createSession({
      ...input,
      runtime: adapter.runtimeName,
      id: pending.session.id,
    });
    const record = this.store.finalizeSession(session);
    this.adaptersBySessionId.set(session.id, adapter);
    const unsubscribe = await adapter.subscribe(session.id, (event) => {
      applyEventToRecord(record, event);
      this.broker.publish(session.id, event);
    });
    this.store.setRuntimeSubscription(session.id, unsubscribe);

    return this.store.getSnapshot(session.id);
  }

  getCurrentSession(): SessionSnapshot | null {
    const current = this.store.getCurrentSession();
    return current ? this.store.getSnapshot(current.session.id) : null;
  }

  getSession(sessionId: string): SessionSnapshot {
    return this.store.getSnapshot(sessionId);
  }

  listSessions() {
    return this.store.listSessions();
  }

  async sendMessage(sessionId: string, content: string): Promise<void> {
    this.store.appendUserMessage(sessionId, content);
    const adapter = this.getAdapterForSession(sessionId);

    const prompt = adapter.runtimeName === "codex-cli"
      ? this.buildCodexPromptWithContext(this.store.getSnapshot(sessionId), content)
      : content;

    await adapter.sendMessage(sessionId, prompt);
  }

  async generateSessionTitle(sessionId: string, content: string): Promise<SessionSummary> {
    const adapter = this.getAdapterForSession(sessionId);
    const generated = adapter.generateTitle
      ? await adapter.generateTitle(sessionId, content)
      : null;

    const fallback = this.fallbackTitle(content);
    const title = (generated || fallback || "新会话").trim();
    return this.store.updateSessionTitle(sessionId, title);
  }

  async stopSession(sessionId: string): Promise<void> {
    await this.getAdapterForSession(sessionId).stopSession(sessionId);
  }

  async disposeSession(sessionId: string): Promise<void> {
    const adapter = this.adaptersBySessionId.get(sessionId);
    if (adapter) {
      await adapter.disposeSession(sessionId);
      this.adaptersBySessionId.delete(sessionId);
    }
    this.store.deleteSession(sessionId);
  }

  subscribe(sessionId: string, listener: (event: ConsoleEvent) => void): () => void {
    return this.broker.subscribe(sessionId, listener);
  }

  buildSnapshotEvent(sessionId: string): ConsoleEvent {
    const snapshot = this.store.getSnapshot(sessionId);
    return {
      id: `evt_snapshot_${sessionId}`,
      sessionId,
      type: "session.snapshot",
      timestamp: snapshot.session.updatedAt,
      agentId: snapshot.session.agentId,
      agentRole: snapshot.session.agentRole,
      phase: snapshot.session.currentPhase,
      snapshot,
    };
  }

  getRuntimeInfo() {
    return this.runtimes.listRuntimeInfo();
  }

  getDefaultRuntime(preferred?: RuntimeName): RuntimeName {
    return this.runtimes.getDefaultRuntime(preferred);
  }

  async listRuntimeModels(runtime?: RuntimeName, profile?: string): Promise<string[]> {
    const adapter = this.runtimes.getAdapter(runtime);
    if (adapter.listModels) {
      return adapter.listModels(profile);
    }
    return adapter.getRuntimeInfo().models || [];
  }

  async ensureRuntimeProfileLogin(
    runtime: RuntimeName | undefined,
    profile: string | undefined,
    workspacePath: string,
  ): Promise<RuntimeLoginResult> {
    const adapter = this.runtimes.getAdapter(runtime);
    if (!adapter.ensureProfileLogin) {
      return { authenticated: true, output: [] };
    }
    return adapter.ensureProfileLogin(profile || "", workspacePath);
  }

  private fallbackTitle(content: string): string {
    const normalized = content.replace(/\s+/g, " ").trim();
    if (!normalized) {
      return "新会话";
    }
    return normalized.slice(0, 24);
  }

  private buildLanguageGuidance(latestUserContent: string): string {
    if (/[\u4e00-\u9fff]/.test(latestUserContent)) {
      return "必须使用中文回复，除非用户明确要求其他语言。";
    }
    return "Use the same language as the latest user message unless the user explicitly asks otherwise.";
  }

  private buildCodexPromptWithContext(snapshot: SessionSnapshot, latestUserContent: string): string {
    const recent = snapshot.messages.slice(-12);

    const lines: string[] = [
      "你正在一个持续会话中执行任务。",
      this.buildLanguageGuidance(latestUserContent),
      "对于需要多个步骤的请求（实现、修改、调试、运行命令、排查问题），必须先创建 Todo/执行计划，并在关键进展时更新。",
      "执行计划更新过程由系统事件自动展示。除非用户明确要求，不要额外输出“执行计划已创建/更新”这类过程提示。",
      "不要逐项罗列完整 Todo 列表或状态计数，除非用户明确要求。",
    ];

    if (recent.length > 1) {
      lines.push("以下是最近的对话上下文（按时间顺序）：");
    }

    for (const message of recent) {
      const role = message.role === "user" ? "用户" : message.role === "assistant" ? "助手" : "系统";
      const content = message.content.replace(/\s+/g, " ").trim().slice(0, 1600);
      if (!content) {
        continue;
      }
      lines.push(`[${role}] ${content}`);
    }

    lines.push(`最后一条用户消息：${latestUserContent.replace(/\s+/g, " ").trim()}`);
    lines.push("请基于以上上下文继续，并重点回应最后一条用户消息。不要重复输出上下文原文。");
    return lines.join("\n");
  }

  private getAdapterForSession(sessionId: string): RuntimeAdapter {
    const adapter = this.adaptersBySessionId.get(sessionId);
    if (!adapter) {
      throw new Error(`Runtime adapter not found for session: ${sessionId}`);
    }
    return adapter;
  }
}
