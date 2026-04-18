import type {
  CreateSessionInput,
  RuntimeName,
  SendMessageInput,
  SessionSnapshot,
} from "@copilot-console/shared";

export interface RuntimeInfo {
  runtime: RuntimeName;
  command: string;
  mode: "mock" | "configured";
  available: boolean;
  notes?: string;
  profiles?: string[];
  models?: string[];
}

export interface BootstrapResponse {
  defaultWorkspacePath: string;
  runtimes: RuntimeInfo[];
  defaultRuntime: RuntimeName;
  currentSession: SessionSnapshot | null;
}

export interface RuntimeModelsResponse {
  runtime: RuntimeName;
  profile: string | null;
  models: string[];
}

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const error = (await response.json().catch(() => ({ error: "Request failed" }))) as {
      error?: string;
    };
    throw new Error(error.error || `HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

export const apiClient = {
  bootstrap(): Promise<BootstrapResponse> {
    return fetch("/api/bootstrap").then((response) => readJson<BootstrapResponse>(response));
  },
  createSession(input: Partial<CreateSessionInput>): Promise<SessionSnapshot> {
    return fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }).then((response) => readJson<SessionSnapshot>(response));
  },
  sendMessage(sessionId: string, input: SendMessageInput): Promise<{ accepted: boolean }> {
    return fetch(`/api/sessions/${sessionId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }).then((response) => readJson<{ accepted: boolean }>(response));
  },
  stopSession(sessionId: string): Promise<{ accepted: boolean }> {
    return fetch(`/api/sessions/${sessionId}/stop`, {
      method: "POST",
    }).then((response) => readJson<{ accepted: boolean }>(response));
  },
  listRuntimeModels(runtime: RuntimeName, profile?: string): Promise<RuntimeModelsResponse> {
    const query = new URLSearchParams({ runtime });
    if (profile) {
      query.set("profile", profile);
    }
    return fetch(`/api/runtime-models?${query.toString()}`).then((response) =>
      readJson<RuntimeModelsResponse>(response),
    );
  },
};
