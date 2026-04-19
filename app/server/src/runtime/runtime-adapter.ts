import type { ConsoleEvent, CreateSessionInput, RuntimeName, SessionSummary } from "@copilot-console/shared";

export type RuntimeEventListener = (event: ConsoleEvent) => void;

export interface RuntimeInfo {
  runtime: RuntimeName;
  command: string;
  mode: "mock" | "configured";
  available: boolean;
  notes?: string;
  profiles?: string[];
  models?: string[];
}

export interface RuntimeLoginResult {
  authenticated: boolean;
  output: string[];
}

export interface RuntimeAdapter {
  readonly runtimeName: RuntimeName;
  createSession(input: CreateSessionInput & { id: string }): Promise<SessionSummary>;
  sendMessage(sessionId: string, content: string): Promise<void>;
  generateTitle?(sessionId: string, content: string): Promise<string | null>;
  ensureProfileLogin?(profile: string, workspacePath: string): Promise<RuntimeLoginResult>;
  stopSession(sessionId: string): Promise<void>;
  subscribe(sessionId: string, listener: RuntimeEventListener): Promise<() => void>;
  disposeSession(sessionId: string): Promise<void>;
  getRuntimeInfo(): RuntimeInfo;
  listModels?(profile?: string): Promise<string[]>;
}
