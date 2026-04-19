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

export interface RuntimeLoginResponse {
  runtime: RuntimeName;
  profile: string | null;
  authenticated: boolean;
  output: string[];
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

export interface WorkspaceFileResponse {
  path: string;
  supported: boolean;
  language?: string;
  content?: string;
  reason?: string;
}

export type ConsoleTabStatus = "idle" | "running";
export type ConsoleTabEntrySource = "stdout" | "stderr" | "system";

export interface ConsoleTabEntry {
  id: string;
  source: ConsoleTabEntrySource;
  content: string;
  timestamp: string;
}

export interface ConsoleTabSnapshot {
  id: string;
  cwd: string;
  status: ConsoleTabStatus;
  createdAt: string;
  updatedAt: string;
  entries: ConsoleTabEntry[];
}

export type ConsoleTabEvent =
  | { type: "snapshot"; snapshot: ConsoleTabSnapshot }
  | { type: "entry"; entry: ConsoleTabEntry }
  | { type: "status"; status: ConsoleTabStatus; updatedAt: string; message?: string; cwd?: string };

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
  deleteSession(sessionId: string): Promise<void> {
    return fetch(`/api/sessions/${sessionId}`, {
      method: "DELETE",
    }).then(async (response) => {
      if (!response.ok && response.status !== 204) {
        const payload = (await response.json().catch(() => ({ error: "Request failed" }))) as {
          error?: string;
        };
        throw new Error(payload.error || `HTTP ${response.status}`);
      }
    });
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
  generateSessionTitle(sessionId: string, content: string): Promise<{ session: SessionSummary }> {
    return fetch(`/api/sessions/${sessionId}/title`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    }).then((response) => readJson<{ session: SessionSummary }>(response));
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
  requestRuntimeLogin(
    runtime: RuntimeName,
    profile: string,
    workspacePath?: string,
  ): Promise<RuntimeLoginResponse> {
    return fetch("/api/runtime-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runtime, profile, workspacePath }),
    }).then((response) => readJson<RuntimeLoginResponse>(response));
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
  workspaceFile(path: string): Promise<WorkspaceFileResponse> {
    const query = new URLSearchParams({ path });
    return fetch(`/api/workspace-file?${query.toString()}`).then((response) =>
      readJson<WorkspaceFileResponse>(response),
    );
  },
  saveWorkspaceFile(path: string, content: string): Promise<{ saved: boolean; size: number }> {
    return fetch("/api/workspace-file", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, content }),
    }).then((response) => readJson<{ saved: boolean; size: number }>(response));
  },
  createConsoleTab(cwd?: string): Promise<ConsoleTabSnapshot> {
    return fetch("/api/console/tabs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cwd }),
    }).then((response) => readJson<ConsoleTabSnapshot>(response));
  },
  getConsoleTab(tabId: string): Promise<ConsoleTabSnapshot> {
    return fetch(`/api/console/tabs/${tabId}`).then((response) => readJson<ConsoleTabSnapshot>(response));
  },
  execConsoleTab(tabId: string, command: string): Promise<{ accepted: boolean }> {
    return fetch(`/api/console/tabs/${tabId}/exec`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command }),
    }).then((response) => readJson<{ accepted: boolean }>(response));
  },
  stopConsoleTab(tabId: string): Promise<{ accepted: boolean }> {
    return fetch(`/api/console/tabs/${tabId}/stop`, {
      method: "POST",
    }).then((response) => readJson<{ accepted: boolean }>(response));
  },
  clearConsoleTab(tabId: string): Promise<{ accepted: boolean }> {
    return fetch(`/api/console/tabs/${tabId}/clear`, {
      method: "POST",
    }).then((response) => readJson<{ accepted: boolean }>(response));
  },
  deleteConsoleTab(tabId: string): Promise<void> {
    return fetch(`/api/console/tabs/${tabId}`, {
      method: "DELETE",
    }).then(async (response) => {
      if (!response.ok && response.status !== 204) {
        const payload = (await response.json().catch(() => ({ error: "Request failed" }))) as {
          error?: string;
        };
        throw new Error(payload.error || `HTTP ${response.status}`);
      }
    });
  },
};
