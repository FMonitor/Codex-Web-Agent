import type {
  CreateSessionInput,
  RuntimeName,
  SessionSummary,
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

export interface SessionListResponse {
  sessions: SessionSummary[];
}

export interface WorkspaceTreeNode {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: WorkspaceTreeNode[];
  truncated?: boolean;
}

export interface WorkspaceTreeResponse {
  rootPath: string;
  requestedPath: string;
  depth: number;
  tree: WorkspaceTreeNode;
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
  listSessions(): Promise<SessionListResponse> {
    return fetch("/api/sessions").then((response) => readJson<SessionListResponse>(response));
  },
  getSession(sessionId: string): Promise<SessionSnapshot> {
    return fetch(`/api/sessions/${sessionId}`).then((response) => readJson<SessionSnapshot>(response));
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
  workspaceTree(path?: string, depth = 2): Promise<WorkspaceTreeResponse> {
    const query = new URLSearchParams();
    if (path && path.trim()) {
      query.set("path", path.trim());
    }
    query.set("depth", String(depth));
    return fetch(`/api/workspace-tree?${query.toString()}`).then((response) =>
      readJson<WorkspaceTreeResponse>(response),
    );
  },
};
