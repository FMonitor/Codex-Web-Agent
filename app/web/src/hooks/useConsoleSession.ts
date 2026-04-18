import type {
  ChatMessage,
  ConsoleEvent,
  CreateSessionInput,
  SessionSummary,
  SessionSnapshot,
} from "@copilot-console/shared";
import { useEffect, useMemo, useRef, useState } from "react";
import { apiClient, type BootstrapResponse, type WorkspaceTreeNode } from "../api/client";

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
    runtimeProfile: "",
    model: "",
    sandboxMode: "workspace-write",
  });
  const [transportState, setTransportState] = useState<"idle" | "connecting" | "open" | "closed">(
    "idle",
  );
  const [modelOptions, setModelOptions] = useState<string[]>([]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [sidebarTab, setSidebarTab] = useState<"sessions" | "files">("sessions");
  const [workspaceTree, setWorkspaceTree] = useState<WorkspaceTreeNode | null>(null);
  const [workspaceRootLabel, setWorkspaceRootLabel] = useState("");
  const [workspaceTreeLoading, setWorkspaceTreeLoading] = useState(false);
  const [error, setError] = useState<string>("");
  const eventSourceRef = useRef<EventSource | null>(null);

  const refreshSessions = async () => {
    const response = await apiClient.listSessions();
    setSessions(response.sessions);
  };

  const refreshWorkspaceTree = async () => {
    setWorkspaceTreeLoading(true);
    try {
      const response = await apiClient.workspaceTree("Multi-Copilot", 3);
      setWorkspaceRootLabel(`${response.rootPath}/${response.requestedPath}`.replace(/\/$/, ""));
      setWorkspaceTree(response.tree);
    } finally {
      setWorkspaceTreeLoading(false);
    }
  };

  useEffect(() => {
    apiClient
      .bootstrap()
      .then(async (data) => {
        setBootstrap(data);
        setCreateOptions((current) => ({
          ...current,
          runtimeProfile: data.currentSession?.session.runtimeProfile || current.runtimeProfile || "",
          model: data.currentSession?.session.model || current.model || "",
          sandboxMode: data.currentSession?.session.sandboxMode || current.sandboxMode || "workspace-write",
        }));
        if (data.currentSession) {
          setSnapshot(data.currentSession);
          await refreshSessions();
          await refreshWorkspaceTree();
          return;
        }
        const created = await apiClient.createSession({
          title: "Quick Console",
          workspacePath: data.defaultWorkspacePath,
          runtime: "codex-cli",
          sandboxMode: "workspace-write",
          agentId: "default",
          agentRole: "general",
        });
        setSnapshot(created);
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
    const profile = createOptions.runtimeProfile || undefined;
    let cancelled = false;

    apiClient
      .listRuntimeModels(runtime, profile)
      .then((response) => {
        if (!cancelled) {
          setModelOptions(response.models);
        }
      })
      .catch(() => {
        if (!cancelled) {
          const fallbackRuntime = bootstrap.runtimes.find((item) => item.runtime === runtime);
          setModelOptions(fallbackRuntime?.models || []);
        }
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

  const currentPhaseLabel = useMemo(() => snapshot?.session.currentPhase || "idle", [snapshot]);

  const createSession = async () => {
    if (!bootstrap) {
      return;
    }
    setError("");
    const created = await apiClient.createSession({
      title: `Console ${new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`,
      workspacePath: bootstrap.defaultWorkspacePath,
      runtime: "codex-cli",
      runtimeProfile: createOptions.runtimeProfile || undefined,
      model: createOptions.model || undefined,
      sandboxMode: createOptions.sandboxMode,
      agentId: "default",
      agentRole: "general",
    });
    setSnapshot(created);
    await refreshSessions();
  };

  const selectSession = async (sessionId: string) => {
    setError("");
    const next = await apiClient.getSession(sessionId);
    setSnapshot(next);
  };

  const sendMessage = async (content: string) => {
    if (!snapshot) {
      return;
    }
    setError("");
    const optimisticMessage: ChatMessage = {
      id: `local_${Date.now()}`,
      sessionId: snapshot.session.id,
      role: "user",
      content,
      createdAt: new Date().toISOString(),
      agentId: snapshot.session.agentId,
      agentRole: snapshot.session.agentRole,
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
    await apiClient.sendMessage(snapshot.session.id, { content });
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

  const activeSessionId = snapshot?.session.id || null;

  return {
    bootstrap,
    snapshot,
    transportState,
    error,
    currentPhaseLabel,
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
    setCreateOptions,
    createSession,
    sendMessage,
    stopSession,
  };
}
