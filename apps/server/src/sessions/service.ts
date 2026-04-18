import type { ConsoleEvent, CreateSessionInput, RuntimeName, SessionSnapshot } from "@copilot-console/shared";
import { EventBroker } from "../events/broker.js";
import { applyEventToRecord } from "../events/reducer.js";
import type { RuntimeAdapter } from "../runtime/runtime-adapter.js";
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

    if (current) {
      await this.disposeSession(current.session.id);
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

  async sendMessage(sessionId: string, content: string): Promise<void> {
    this.store.appendUserMessage(sessionId, content);
    await this.getAdapterForSession(sessionId).sendMessage(sessionId, content);
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

  private getAdapterForSession(sessionId: string): RuntimeAdapter {
    const adapter = this.adaptersBySessionId.get(sessionId);
    if (!adapter) {
      throw new Error(`Runtime adapter not found for session: ${sessionId}`);
    }
    return adapter;
  }
}
