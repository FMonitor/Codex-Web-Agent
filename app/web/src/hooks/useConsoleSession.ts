import type {
  ChatMessage,
  ConsoleEvent,
  CreateSessionInput,
  SessionSummary,
  SessionSnapshot,
} from "@codex-web-agent/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  apiClient,
  type BootstrapResponse,
  type WorkspaceFileResponse,
  type WorkspaceTreeNode,
} from "../api/client";

const ARCHIVE_STORAGE_KEY = "codex-web-agent-archived-sessions";
const LEGACY_ARCHIVE_STORAGE_KEY = "copilot-console-archived-sessions";

interface OpenedFile {
  path: string;
  loading: boolean;
  supported: boolean;
  reason: string | null;
  language: string;
  content: string;
}

const LOCAL_MESSAGE_PREFIX = "local_";
const MESSAGE_TIME_TOLERANCE_MS = 20_000;

function normalizeRelativePath(value: string): string {
  const normalized = value.trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "").replace(/\/+$/, "");
  return normalized || ".";
}

function isSameOrNestedPath(targetPath: string, parentPath: string): boolean {
  const target = normalizeRelativePath(targetPath);
  const parent = normalizeRelativePath(parentPath);

  if (target === parent) {
    return true;
  }

  if (parent === ".") {
    return true;
  }

  return target.startsWith(`${parent}/`);
}

function isSameOptimisticUserMessage(serverMessage: ChatMessage, localMessage: ChatMessage): boolean {
  if (serverMessage.role !== "user" || localMessage.role !== "user") {
    return false;
  }
  if (serverMessage.content !== localMessage.content) {
    return false;
  }

  const serverTime = Date.parse(serverMessage.createdAt);
  const localTime = Date.parse(localMessage.createdAt);
  if (!Number.isFinite(serverTime) || !Number.isFinite(localTime)) {
    return true;
  }

  return Math.abs(serverTime - localTime) <= MESSAGE_TIME_TOLERANCE_MS;
}

function mergeSnapshotMessages(
  currentMessages: ChatMessage[],
  incomingMessages: ChatMessage[],
): ChatMessage[] {
  const optimisticMessages = currentMessages.filter(
    (message) => message.role === "user" && message.id.startsWith(LOCAL_MESSAGE_PREFIX),
  );
  if (optimisticMessages.length === 0) {
    return incomingMessages;
  }

  const pending = optimisticMessages.filter((localMessage) =>
    !incomingMessages.some(
      (serverMessage) =>
        serverMessage.id === localMessage.id ||
        isSameOptimisticUserMessage(serverMessage, localMessage),
    ),
  );
  if (pending.length === 0) {
    return incomingMessages;
  }

  return [...incomingMessages, ...pending].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function applyEvent(snapshot: SessionSnapshot, event: ConsoleEvent): SessionSnapshot {
  if (event.type === "session.snapshot" && event.snapshot) {
    const mergedMessages = mergeSnapshotMessages(snapshot.messages, event.snapshot.messages);
    if (mergedMessages === event.snapshot.messages) {
      return event.snapshot;
    }

    const latestUserMessage = [...mergedMessages]
      .reverse()
      .find((message) => message.role === "user")?.content;

    return {
      ...event.snapshot,
      session: {
        ...event.snapshot.session,
        lastUserMessage: latestUserMessage || event.snapshot.session.lastUserMessage,
      },
      messages: mergedMessages,
    };
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
  const [draftSessionRequested, setDraftSessionRequested] = useState(false);
  const [modelOptionsLoading, setModelOptionsLoading] = useState(false);
  const [openaiLoginPending, setOpenaiLoginPending] = useState(false);
  const [openaiPromptShown, setOpenaiPromptShown] = useState(false);
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
      const legacyValue = localStorage.getItem(LEGACY_ARCHIVE_STORAGE_KEY);
      const source = value || legacyValue;
      if (!source) {
        return;
      }

      const parsed = JSON.parse(source) as string[];
      setArchivedSessionIds(parsed);

      if (!value && legacyValue) {
        localStorage.setItem(ARCHIVE_STORAGE_KEY, source);
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
      setModelOptionsLoading(false);
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
      setModelOptionsLoading(false);
      return;
    }

    let cancelled = false;
    setModelOptionsLoading(true);

    apiClient
      .listRuntimeModels(runtime, profile)
      .then((response) => {
        if (cancelled) {
          return;
        }
        modelCacheRef.current[profile] = response.models;
        setModelOptions(response.models);
        setModelOptionsLoading(false);
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        const fallbackRuntime = bootstrap.runtimes.find((item) => item.runtime === runtime);
        const fallbackModels = fallbackRuntime?.models || [];
        modelCacheRef.current[profile] = fallbackModels;
        setModelOptions(fallbackModels);
        setModelOptionsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [bootstrap, createOptions.runtimeProfile]);

  const requestOpenAILogin = useCallback(async (): Promise<boolean> => {
    if (!bootstrap || openaiLoginPending) {
      return false;
    }

    setOpenaiLoginPending(true);
    setError("");
    try {
      const loginResult = await apiClient.requestRuntimeLogin(
        "codex-cli",
        "openai-login",
        bootstrap.defaultWorkspacePath,
      );

      const modelsResponse = await apiClient.listRuntimeModels("codex-cli", "openai-login");
      modelCacheRef.current["openai-login"] = modelsResponse.models;
      if ((createOptions.runtimeProfile || "custom-api") === "openai-login") {
        setModelOptions(modelsResponse.models);
      }

      if (!loginResult.authenticated) {
          const details = loginResult.output.slice(-8).join("\n");
          const lastLine = loginResult.output[loginResult.output.length - 1] || "OpenAI 登录未完成，请重试。";
          if (details && typeof window !== "undefined") {
            window.alert(`OpenAI 登录失败详情：\n${details}`);
          }
          setError(`OpenAI 登录失败：${lastLine}`);
        return false;
      }

      if (loginResult.output.length > 0 && typeof window !== "undefined") {
        const hint = loginResult.output.slice(-6).join("\n");
        window.alert(`OpenAI 登录流程输出：\n${hint}`);
      }
      return true;
    } catch (error) {
      setError(error instanceof Error ? error.message : "OpenAI 登录失败");
      return false;
    } finally {
      setOpenaiLoginPending(false);
    }
  }, [bootstrap, createOptions.runtimeProfile, openaiLoginPending]);

  useEffect(() => {
    const profile = createOptions.runtimeProfile || "custom-api";
    if (profile !== "openai-login") {
      setOpenaiPromptShown(false);
      return;
    }

    const openaiModelsResolved = Object.prototype.hasOwnProperty.call(modelCacheRef.current, "openai-login");
    if (!openaiModelsResolved) {
      return;
    }

    if (openaiPromptShown || modelOptionsLoading || openaiLoginPending) {
      return;
    }

    if (modelOptions.length > 0) {
      return;
    }

    setOpenaiPromptShown(true);
    if (typeof window === "undefined") {
      return;
    }

    const shouldLogin = window.confirm("检测到 OpenAI 模型列表为空，可能尚未登录。是否现在拉起登录流程？");
    if (shouldLogin) {
      void requestOpenAILogin();
    }
  }, [
    createOptions.runtimeProfile,
    modelOptions.length,
    modelOptionsLoading,
    openaiLoginPending,
    openaiPromptShown,
    requestOpenAILogin,
  ]);

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
    const lastEvent = snapshot?.timeline[snapshot.timeline.length - 1];
    if (!lastEvent) {
      return;
    }

    if (
      lastEvent.type === "file.changed" ||
      lastEvent.type === "tool.execution_complete" ||
      lastEvent.type === "tool.execution_failed"
    ) {
      void refreshWorkspaceTree({ silent: true });
    }
  }, [snapshot?.timeline.length, refreshWorkspaceTree]);

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
      title: createOptions.model?.trim() || "新会话",
      workspacePath: bootstrap.defaultWorkspacePath,
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

  const startNewSessionDraft = () => {
    setError("");
    setSnapshot(null);
    setDraftSessionRequested(true);
    setOpenedFile(null);
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

  const copyWorkspaceEntry = async (
    sourcePath: string,
    targetPath: string,
    options?: { autoRename?: boolean },
  ) => {
    const result = await apiClient.copyWorkspaceEntry(sourcePath, targetPath, options);
    await refreshWorkspaceTree({ silent: true });
    return result;
  };

  const moveWorkspaceEntry = async (sourcePath: string, targetPath: string) => {
    const result = await apiClient.moveWorkspaceEntry(sourcePath, targetPath);

    setOpenedFile((current) => {
      if (!current) {
        return current;
      }

      if (isSameOrNestedPath(current.path, sourcePath)) {
        const source = normalizeRelativePath(sourcePath);
        const target = normalizeRelativePath(targetPath);
        const currentPath = normalizeRelativePath(current.path);

        if (currentPath === source) {
          return {
            ...current,
            path: target,
          };
        }

        const suffix = currentPath.slice(source.length);
        return {
          ...current,
          path: `${target}${suffix}`,
        };
      }

      return current;
    });

    await refreshWorkspaceTree({ silent: true });
    return result;
  };

  const deleteWorkspaceEntry = async (path: string) => {
    const result = await apiClient.deleteWorkspaceEntry(path);

    setOpenedFile((current) => {
      if (!current) {
        return current;
      }

      if (isSameOrNestedPath(current.path, path)) {
        return null;
      }

      return current;
    });

    await refreshWorkspaceTree({ silent: true });
    return result;
  };

  const sendMessage = async (content: string) => {
    const currentSnapshot = snapshot;

    // If no session exists, create one first
    if (!currentSnapshot) {
      setError("");
      try {
        const newSession = await createSession();
        if (newSession) {
          setDraftSessionRequested(false);
          const messageTimestamp = new Date().toISOString();
          const optimisticMessage: ChatMessage = {
            id: `local_${Date.now()}`,
            sessionId: newSession.session.id,
            role: "user",
            content,
            createdAt: messageTimestamp,
            agentId: newSession.session.agentId,
            agentRole: newSession.session.agentRole,
          };

          setSnapshot({
            ...newSession,
            session: {
              ...newSession.session,
              lastUserMessage: content,
              updatedAt: messageTimestamp,
            },
            messages: [...newSession.messages, optimisticMessage],
          });

          await apiClient.sendMessage(newSession.session.id, { content });

          void apiClient
            .generateSessionTitle(newSession.session.id, content)
            .then(async ({ session }) => {
              setSnapshot((current) =>
                current && current.session.id === session.id
                  ? {
                      ...current,
                      session: {
                        ...current.session,
                        title: session.title,
                        updatedAt: session.updatedAt,
                      },
                    }
                  : current,
              );
              await refreshSessions();
            })
            .catch(() => {
              // Title generation failure should not block the session flow.
            });
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
    copyWorkspaceEntry,
    moveWorkspaceEntry,
    deleteWorkspaceEntry,
    setCreateOptions,
    createSession,
    startNewSessionDraft,
    draftSessionRequested,
    sendMessage,
    stopSession,
  };
}
