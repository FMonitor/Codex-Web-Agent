import type {
  ChatMessage,
  ConsoleEvent,
  CreateSessionInput,
  SessionSummary,
  SessionSnapshot,
} from "@copilot-console/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  apiClient,
  type BootstrapResponse,
  type WorkspaceFileResponse,
  type WorkspaceTreeNode,
} from "../api/client";

const ARCHIVE_STORAGE_KEY = "copilot-console-archived-sessions";

interface OpenedFile {
  path: string;
  loading: boolean;
  supported: boolean;
  reason: string | null;
  language: string;
  content: string;
}

function applyEvent(snapshot: SessionSnapshot, event: ConsoleEvent): SessionSnapshot {
  if (event.type === "session.snapshot" && event.snapshot) {
    return event.snapshot;
  }

  const next: SessionSnapshot = {
    session: {
      ...snapshot.session,
      updatedAt: event.timestamp,
      currentPhase: event.phase || snapshot.session.currentPhase,
      status: event.status || snapshot.session.status,
    },
    messages: [...snapshot.messages],
    tools: [...snapshot.tools],
    logs: [...snapshot.logs],
    fileChanges: [...snapshot.fileChanges],
    timeline: [...snapshot.timeline, event],
  };

  const ensureAssistant = (): ChatMessage => {
    const messageId = event.messageId || event.id;
    const existing = next.messages.find((item) => item.id === messageId);
    if (existing) {
      return existing;
    }
    const created: ChatMessage = {
      id: messageId,
      sessionId: next.session.id,
      role: "assistant",
      content: "",
      createdAt: event.timestamp,
      agentId: event.agentId,
      agentRole: event.agentRole,
    };
    next.messages.push(created);
    return created;
  };

  switch (event.type) {
    case "session.started":
      next.session.status = "running";
      break;
    case "session.completed":
      next.session.status = "completed";
      next.session.currentPhase = "completed";
      break;
    case "session.failed":
      next.session.status = "failed";
      next.session.currentPhase = "failed";
      break;
    case "session.stopped":
      next.session.status = "stopped";
      break;
    case "assistant.message_start":
      ensureAssistant();
      break;
    case "assistant.message_delta": {
      const message = ensureAssistant();
      message.content += event.content || "";
      next.session.lastAssistantMessage = message.content;
      break;
    }
    case "assistant.message_complete": {
      const message = ensureAssistant();
      if (event.content) {
        message.content = event.content;
      }
      next.session.lastAssistantMessage = message.content;
      break;
    }
    case "tool.execution_start":
    case "tool.execution_progress":
    case "tool.execution_complete":
    case "tool.execution_failed":
      if (event.toolCall) {
        const index = next.tools.findIndex((item) => item.id === event.toolCall?.id);
        if (index >= 0) {
          next.tools[index] = { ...next.tools[index], ...event.toolCall };
        } else {
          next.tools.unshift(event.toolCall);
        }
      }
      break;
    case "file.changed":
      if (event.fileChange) {
        next.fileChanges.unshift(event.fileChange);
      }
      break;
    case "log.stdout":
    case "log.stderr":
      if (event.logEntry) {
        next.logs.push(event.logEntry);
      }
      break;
    default:
      break;
  }

  return next;
}

export function useConsoleSession() {
  const [bootstrap, setBootstrap] = useState<BootstrapResponse | null>(null);
  const [snapshot, setSnapshot] = useState<SessionSnapshot | null>(null);
  const [createOptions, setCreateOptions] = useState<Partial<CreateSessionInput>>({
    runtimeProfile: "custom-api",
    model: "",
    sandboxMode: "workspace-write",
  });
  const [transportState, setTransportState] = useState<"idle" | "connecting" | "open" | "closed">(
    "idle",
  );
  const [modelOptions, setModelOptions] = useState<string[]>([]);
  const [allSessions, setAllSessions] = useState<SessionSummary[]>([]);
  const [archivedSessionIds, setArchivedSessionIds] = useState<string[]>([]);
  const [sidebarTab, setSidebarTab] = useState<"sessions" | "files">("sessions");
  const [workspaceTree, setWorkspaceTree] = useState<WorkspaceTreeNode | null>(null);
  const [workspaceRootLabel, setWorkspaceRootLabel] = useState("");
  const [workspaceTreeLoading, setWorkspaceTreeLoading] = useState(false);
  const [openedFile, setOpenedFile] = useState<OpenedFile | null>(null);
  const [error, setError] = useState<string>("");
  const eventSourceRef = useRef<EventSource | null>(null);
  const fileRequestSeqRef = useRef(0);
  const modelCacheRef = useRef<Record<string, string[]>>({});

  const refreshSessions = useCallback(async () => {
    const response = await apiClient.listSessions();
    setAllSessions(response.sessions);
  }, []);

  const refreshWorkspaceTree = useCallback(async (options?: { silent?: boolean }) => {
    const silent = Boolean(options?.silent);
    if (!silent) {
      setWorkspaceTreeLoading(true);
    }
    try {
      const response = await apiClient.workspaceTree(undefined, 3);
      const requestedPath = response.requestedPath === "." ? "" : response.requestedPath.replace(/^\.\//, "");
      const label = requestedPath
        ? `${response.rootPath}/${requestedPath}`.replace(/\/$/, "")
        : response.rootPath;
      setWorkspaceRootLabel(label);
      setWorkspaceTree(response.tree);
    } finally {
      if (!silent) {
        setWorkspaceTreeLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    try {
      const value = localStorage.getItem(ARCHIVE_STORAGE_KEY);
      if (value) {
        const parsed = JSON.parse(value) as string[];
        setArchivedSessionIds(parsed);
      }
    } catch {
      // ignore local storage parsing errors
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(ARCHIVE_STORAGE_KEY, JSON.stringify(archivedSessionIds));
  }, [archivedSessionIds]);

  useEffect(() => {
    apiClient
      .bootstrap()
      .then(async (data) => {
        setBootstrap(data);
        setCreateOptions((current) => ({
          ...current,
          runtimeProfile: data.currentSession?.session.runtimeProfile || current.runtimeProfile || "custom-api",
          model: data.currentSession?.session.model || current.model || "",
          sandboxMode: data.currentSession?.session.sandboxMode || current.sandboxMode || "workspace-write",
        }));
        setSnapshot(data.currentSession || null);
        await refreshSessions();
        await refreshWorkspaceTree();
      })
      .catch((reason: Error) => setError(reason.message));
  }, []);

  useEffect(() => {
    if (!bootstrap) {
      return;
    }

    const runtime = "codex-cli";
    const profilesToPrefetch = ["custom-api", "openai-login"];
    const fallbackRuntime = bootstrap.runtimes.find((item) => item.runtime === runtime);
    let cancelled = false;

    Promise.all(
      profilesToPrefetch.map(async (profile) => {
        try {
          const response = await apiClient.listRuntimeModels(runtime, profile);
          return [profile, response.models] as const;
        } catch {
          return [profile, fallbackRuntime?.models || []] as const;
        }
      }),
    ).then((entries) => {
      if (cancelled) {
        return;
      }

      for (const [profile, models] of entries) {
        modelCacheRef.current[profile] = models;
      }

      const currentProfile = createOptions.runtimeProfile || "custom-api";
      setModelOptions(modelCacheRef.current[currentProfile] || []);
    });

    return () => {
      cancelled = true;
    };
  }, [bootstrap]);

  useEffect(() => {
    if (!bootstrap) {
      return;
    }

    const runtime = "codex-cli";
    const profile = createOptions.runtimeProfile || "custom-api";
    const cached = modelCacheRef.current[profile];
    if (cached && cached.length > 0) {
      setModelOptions(cached);
      return;
    }

    let cancelled = false;

    apiClient
      .listRuntimeModels(runtime, profile)
      .then((response) => {
        if (cancelled) {
          return;
        }
        modelCacheRef.current[profile] = response.models;
        setModelOptions(response.models);
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        const fallbackRuntime = bootstrap.runtimes.find((item) => item.runtime === runtime);
        const fallbackModels = fallbackRuntime?.models || [];
        modelCacheRef.current[profile] = fallbackModels;
        setModelOptions(fallbackModels);
      });

    return () => {
      cancelled = true;
    };
  }, [bootstrap, createOptions.runtimeProfile]);

  useEffect(() => {
    if (!snapshot?.session.id) {
      return;
    }

    setTransportState("connecting");
    const source = new EventSource(`/api/sessions/${snapshot.session.id}/events`);
    eventSourceRef.current = source;

    source.onmessage = (message) => {
      const event = JSON.parse(message.data) as ConsoleEvent;
      setSnapshot((current) => (current ? applyEvent(current, event) : event.snapshot || null));
      setTransportState("open");
    };

    source.onerror = () => {
      setTransportState("closed");
    };

    return () => {
      source.close();
      eventSourceRef.current = null;
    };
  }, [snapshot?.session.id]);

  useEffect(() => {
    if (!snapshot?.fileChanges.length) {
      return;
    }
    void refreshWorkspaceTree();
  }, [snapshot?.fileChanges[0]?.id, refreshWorkspaceTree]);

  useEffect(() => {
    let disposed = false;

    const poll = async () => {
      if (disposed) {
        return;
      }

      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return;
      }

      try {
        await refreshSessions();
      } catch {
        // Ignore background polling failures.
      }

      try {
        await refreshWorkspaceTree({ silent: true });
      } catch {
        // Ignore background polling failures.
      }
    };

    const timer = window.setInterval(() => {
      void poll();
    }, 10000);

    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [refreshSessions, refreshWorkspaceTree]);

  useEffect(() => {
    if (!snapshot) {
      return;
    }
    setAllSessions((current) => {
      const index = current.findIndex((item) => item.id === snapshot.session.id);
      if (index < 0) {
        return [snapshot.session, ...current].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      }
      const next = [...current];
      next[index] = snapshot.session;
      return next.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    });
  }, [snapshot?.session.updatedAt, snapshot?.session.id]);

  const createSession = async () => {
    if (!bootstrap) {
      return;
    }
    setError("");
    const created = await apiClient.createSession({
      title: `Console ${new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`,
      workspacePath: bootstrap.defaultWorkspacePath,
      runtime: "codex-cli",
      runtimeProfile: createOptions.runtimeProfile || "custom-api",
      model: createOptions.model || undefined,
      sandboxMode: createOptions.sandboxMode,
      agentId: "default",
      agentRole: "general",
    });
    setSnapshot(created);
    await refreshSessions();
    return created;
  };

  const selectSession = async (sessionId: string) => {
    setError("");
    const next = await apiClient.getSession(sessionId);
    setSnapshot(next);
  };

  const archiveSession = (sessionId: string) => {
    setArchivedSessionIds((current) => (current.includes(sessionId) ? current : [sessionId, ...current]));
  };

  const exportSession = async (sessionId: string) => {
    const data = await apiClient.getSession(sessionId);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `session-${sessionId}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const deleteSession = async (sessionId: string) => {
    await apiClient.deleteSession(sessionId);
    await refreshSessions();
    if (snapshot?.session.id === sessionId) {
      const response = await apiClient.listSessions();
      if (response.sessions.length > 0) {
        const next = await apiClient.getSession(response.sessions[0].id);
        setSnapshot(next);
      } else {
        setSnapshot(null);
      }
    }
  };

  const openWorkspaceFile = async (path: string) => {
    const requestId = ++fileRequestSeqRef.current;
    setOpenedFile({
      path,
      loading: true,
      supported: true,
      reason: null,
      language: "plaintext",
      content: "",
    });
    let response: WorkspaceFileResponse;
    try {
      response = await apiClient.workspaceFile(path);
    } catch (cause) {
      if (requestId !== fileRequestSeqRef.current) {
        return;
      }
      setOpenedFile({
        path,
        loading: false,
        supported: false,
        reason: cause instanceof Error ? cause.message : "Failed to load file",
        language: "plaintext",
        content: "",
      });
      return;
    }

    if (requestId !== fileRequestSeqRef.current) {
      return;
    }

    setOpenedFile({
      path,
      loading: false,
      supported: response.supported,
      reason: response.reason || null,
      language: response.language || "plaintext",
      content: response.content || "",
    });
  };

  const closeWorkspaceFile = () => {
    setOpenedFile(null);
  };

  const saveWorkspaceFile = async (filePath: string, content: string) => {
    try {
      await apiClient.saveWorkspaceFile(filePath, content);
      setOpenedFile((current) => {
        if (!current || current.path !== filePath) {
          return current;
        }
        return {
          ...current,
          content,
          reason: null,
        };
      });
    } catch (error) {
      throw error instanceof Error ? error : new Error("Failed to save file");
    }
  };

  const sendMessage = async (content: string) => {
    const currentSnapshot = snapshot;
    
    // If no session exists, create one first
    if (!currentSnapshot) {
      setError("");
      try {
        const newSession = await createSession();
        if (newSession) {
          // Send message to newly created session
          const optimisticMessage: ChatMessage = {
            id: `local_${Date.now()}`,
            sessionId: newSession.session.id,
            role: "user",
            content,
            createdAt: new Date().toISOString(),
            agentId: newSession.session.agentId,
            agentRole: newSession.session.agentRole,
          };
          setSnapshot((current) =>
            current
              ? {
                  ...current,
                  session: {
                    ...current.session,
                    lastUserMessage: content,
                    updatedAt: optimisticMessage.createdAt,
                  },
                  messages: [...current.messages, optimisticMessage],
                }
              : current,
          );
          await apiClient.sendMessage(newSession.session.id, { content });
        }
      } catch (error) {
        setError(error instanceof Error ? error.message : "Failed to send message");
      }
      return;
    }

    setError("");
    const optimisticMessage: ChatMessage = {
      id: `local_${Date.now()}`,
      sessionId: currentSnapshot.session.id,
      role: "user",
      content,
      createdAt: new Date().toISOString(),
      agentId: currentSnapshot.session.agentId,
      agentRole: currentSnapshot.session.agentRole,
    };
    setSnapshot((current) =>
      current
        ? {
            ...current,
            session: {
              ...current.session,
              lastUserMessage: content,
              updatedAt: optimisticMessage.createdAt,
            },
            messages: [...current.messages, optimisticMessage],
          }
        : current,
    );
    await apiClient.sendMessage(currentSnapshot.session.id, { content });
  };

  const stopSession = async () => {
    if (!snapshot) {
      return;
    }
    await apiClient.stopSession(snapshot.session.id);
  };

  const runtimeInfo = useMemo(
    () => bootstrap?.runtimes.find((item) => item.runtime === "codex-cli") || null,
    [bootstrap],
  );

  const sessions = useMemo(
    () => allSessions.filter((item) => !archivedSessionIds.includes(item.id)),
    [allSessions, archivedSessionIds],
  );

  const activeSessionId = snapshot?.session.id || null;

  return {
    bootstrap,
    snapshot,
    transportState,
    error,
    createOptions,
    modelOptions,
    runtimeInfo,
    sessions,
    activeSessionId,
    sidebarTab,
    setSidebarTab,
    workspaceTree,
    workspaceRootLabel,
    workspaceTreeLoading,
    refreshSessions,
    refreshWorkspaceTree,
    selectSession,
    archiveSession,
    exportSession,
    deleteSession,
    openedFile,
    openWorkspaceFile,
    closeWorkspaceFile,
    saveWorkspaceFile,
    setCreateOptions,
    createSession,
    sendMessage,
    stopSession,
  };
}
