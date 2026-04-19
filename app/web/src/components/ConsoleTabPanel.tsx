import { useEffect, useMemo, useRef, useState } from "react";
import { apiClient, type ConsoleTabEvent, type ConsoleTabSnapshot } from "../api/client";

interface ConsoleTabPanelProps {
  consoleTabId: string;
}

export function ConsoleTabPanel({ consoleTabId }: ConsoleTabPanelProps) {
  const [snapshot, setSnapshot] = useState<ConsoleTabSnapshot | null>(null);
  const [command, setCommand] = useState("");
  const [error, setError] = useState("");
  const [runningAction, setRunningAction] = useState<"idle" | "exec" | "stop">("idle");
  const outputRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const historyDraftRef = useRef("");
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  useEffect(() => {
    let cancelled = false;
    setSnapshot(null);
    setError("");

    apiClient
      .getConsoleTab(consoleTabId)
      .then((data) => {
        if (!cancelled) {
          setSnapshot(data);
        }
      })
      .catch((cause) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "Failed to load console tab");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [consoleTabId]);

  useEffect(() => {
    const source = new EventSource(`/api/console/tabs/${encodeURIComponent(consoleTabId)}/events`);

    source.onmessage = (event) => {
      const payload = JSON.parse(event.data) as ConsoleTabEvent;
      if (payload.type === "snapshot") {
        setSnapshot(payload.snapshot);
        return;
      }

      if (payload.type === "entry") {
        setSnapshot((current) => {
          if (!current) {
            return current;
          }
          return {
            ...current,
            updatedAt: payload.entry.timestamp,
            entries: [...current.entries, payload.entry],
          };
        });
        return;
      }

      setSnapshot((current) => {
        if (!current) {
          return current;
        }
        return {
          ...current,
          status: payload.status,
          updatedAt: payload.updatedAt,
          cwd: payload.cwd || current.cwd,
        };
      });
    };

    source.onerror = () => {
      setError((current) => current || "Console stream disconnected.");
    };

    return () => {
      source.close();
    };
  }, [consoleTabId]);

  useEffect(() => {
    if (!outputRef.current) {
      return;
    }
    outputRef.current.scrollTop = outputRef.current.scrollHeight;
  }, [snapshot?.entries.length]);

  const isRunning = snapshot?.status === "running";

  const restoreInputFocus = () => {
    if (!textareaRef.current) {
      return;
    }
    textareaRef.current.focus();
    const caret = textareaRef.current.value.length;
    textareaRef.current.setSelectionRange(caret, caret);
  };

  const navigateHistory = (direction: "up" | "down"): boolean => {
    if (commandHistory.length === 0) {
      return false;
    }

    if (direction === "up") {
      if (historyIndex === -1) {
        historyDraftRef.current = command;
        const nextIndex = commandHistory.length - 1;
        setHistoryIndex(nextIndex);
        setCommand(commandHistory[nextIndex] || "");
        return true;
      }

      if (historyIndex > 0) {
        const nextIndex = historyIndex - 1;
        setHistoryIndex(nextIndex);
        setCommand(commandHistory[nextIndex] || "");
        return true;
      }

      return true;
    }

    if (historyIndex === -1) {
      return false;
    }

    if (historyIndex < commandHistory.length - 1) {
      const nextIndex = historyIndex + 1;
      setHistoryIndex(nextIndex);
      setCommand(commandHistory[nextIndex] || "");
      return true;
    }

    setHistoryIndex(-1);
    setCommand(historyDraftRef.current);
    return true;
  };

  const handleExec = async () => {
    const normalized = command.trim();
    if (!normalized || !snapshot || isRunning) {
      return;
    }

    setRunningAction("exec");
    setError("");
    try {
      await apiClient.execConsoleTab(consoleTabId, normalized);
      setCommandHistory((current) => {
        if (current[current.length - 1] === normalized) {
          return current;
        }
        const next = [...current, normalized];
        if (next.length > 200) {
          return next.slice(next.length - 200);
        }
        return next;
      });
      setHistoryIndex(-1);
      historyDraftRef.current = "";
      setCommand("");
      requestAnimationFrame(() => restoreInputFocus());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to execute command");
    } finally {
      setRunningAction("idle");
    }
  };

  const handleStop = async () => {
    if (!snapshot || !isRunning) {
      return;
    }

    setRunningAction("stop");
    setError("");
    try {
      await apiClient.stopConsoleTab(consoleTabId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to stop command");
    } finally {
      setRunningAction("idle");
    }
  };

  const runButtonLabel = useMemo(() => {
    if (runningAction === "exec") {
      return "执行中...";
    }
    return "执行";
  }, [runningAction]);

  return (
    <section className="console-tab-panel">
      <div className="console-tab-head">
        <div>
          <h2>Console</h2>
          <p>{snapshot?.cwd || "加载中..."}</p>
        </div>
        <span className={`pill ${isRunning ? "pill-running" : "pill-idle"}`}>
          {isRunning ? "running" : "idle"}
        </span>
      </div>

      {error ? <div className="error-banner">{error}</div> : null}

      <div className="console-output" ref={outputRef}>
        {(snapshot?.entries || []).map((entry) => (
          <div key={entry.id} className={`console-line console-line-${entry.source}`}>
            <span className="console-line-time">{new Date(entry.timestamp).toLocaleTimeString("zh-CN")}</span>
            <span className="console-line-content">{entry.content}</span>
          </div>
        ))}
        {snapshot && snapshot.entries.length === 0 ? (
          <p className="muted">暂无输出，输入命令并执行。</p>
        ) : null}
      </div>

      <form
        className="console-composer"
        onSubmit={(event) => {
          event.preventDefault();
          void handleExec();
        }}
      >
        <div className="console-input-row">
          <textarea
            ref={textareaRef}
            value={command}
            onChange={(event) => {
              const next = event.target.value;
              setCommand(next);
              if (historyIndex !== -1) {
                setHistoryIndex(-1);
              }
              historyDraftRef.current = next;
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void handleExec();
                return;
              }

              if (
                (event.key === "ArrowUp" || event.key === "ArrowDown") &&
                !event.shiftKey &&
                !event.altKey &&
                !event.metaKey &&
                !event.ctrlKey
              ) {
                const hasMultipleLines = event.currentTarget.value.includes("\n");
                if (!hasMultipleLines) {
                  const moved = navigateHistory(event.key === "ArrowUp" ? "up" : "down");
                  if (moved) {
                    event.preventDefault();
                  }
                }
              }
            }}
            placeholder="输入命令，例如: ls -la && pwd"
            rows={3}
            disabled={!snapshot || isRunning || runningAction !== "idle"}
          />
          <div className="console-actions">
            <button
              type="button"
              className={`danger-button ${isRunning ? "active" : ""}`}
              onClick={() => void handleStop()}
              disabled={!isRunning || runningAction === "stop"}
            >
              {runningAction === "stop" ? "停止中..." : "停止"}
            </button>
            <button
              type="submit"
              className="primary-button"
              disabled={!snapshot || isRunning || runningAction !== "idle" || !command.trim()}
            >
              {runButtonLabel}
            </button>
          </div>
        </div>
      </form>
    </section>
  );
}
