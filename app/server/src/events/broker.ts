import type { ConsoleEvent } from "@codex-web-agent/shared";

type Listener = (event: ConsoleEvent) => void;

export class EventBroker {
  private listeners = new Map<string, Set<Listener>>();

  subscribe(sessionId: string, listener: Listener): () => void {
    const listeners = this.listeners.get(sessionId) || new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(sessionId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        this.listeners.delete(sessionId);
      }
    };
  }

  publish(sessionId: string, event: ConsoleEvent): void {
    const listeners = this.listeners.get(sessionId);
    if (!listeners) {
      return;
    }
    for (const listener of listeners) {
      listener(event);
    }
  }
}

