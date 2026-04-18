import type { CreateSessionInput, RuntimeName, SessionSnapshot } from "@copilot-console/shared";
import type { Dispatch, SetStateAction } from "react";
import type { RuntimeInfo } from "../api/client";

interface HeaderBarProps {
  snapshot: SessionSnapshot | null;
  runtimes: RuntimeInfo[];
  createOptions: Partial<CreateSessionInput>;
  modelOptions: string[];
  transportState: string;
  defaultRuntime: RuntimeName;
  onCreateOptionsChange: Dispatch<SetStateAction<Partial<CreateSessionInput>>>;
  onNewSession: () => void;
  onStop: () => void;
}

export function HeaderBar({
  snapshot,
  runtimes,
  createOptions,
  modelOptions,
  transportState,
  defaultRuntime,
  onCreateOptionsChange,
  onNewSession,
  onStop,
}: HeaderBarProps) {
  const activeRuntime = snapshot?.session.runtime || createOptions.runtime || defaultRuntime;
  const activeRuntimeInfo = runtimes.find((item) => item.runtime === activeRuntime);
  const profileOptions = activeRuntimeInfo?.profiles || [];

  return (
    <header className="hero-panel">
      <div className="hero-copy">
        <span className="eyebrow">Copilot CLI Web Console</span>
        <h1>单会话、流式、面向手机的 Coding Agent 控制台</h1>
        <p>
          统一展示 Codex CLI / Copilot CLI 的回复流、执行阶段、工具调用、日志输出和文件变更，并预留
          <code>agentId</code> / <code>agentRole</code> 扩展位。
        </p>
        <div className="hero-meta">
          <span className={`pill pill-${snapshot?.session.status || "idle"}`}>
            {snapshot?.session.status || "idle"}
          </span>
          <span className="pill pill-muted">phase: {snapshot?.session.currentPhase || "idle"}</span>
          <span className="pill pill-muted">runtime: {activeRuntime}</span>
          <span className="pill pill-muted">mode: {activeRuntimeInfo?.mode || "configured"}</span>
          <span className="pill pill-muted">stream: {transportState}</span>
          <span className="pill pill-muted">
            {snapshot?.session.agentId || "default"} / {snapshot?.session.agentRole || "general"}
          </span>
        </div>
        <div className="runtime-form">
          <label>
            <span>运行时</span>
            <select
              value={createOptions.runtime || defaultRuntime}
              onChange={(event) =>
                onCreateOptionsChange((current) => ({
                  ...current,
                  runtime: event.target.value as RuntimeName,
                }))
              }
            >
              {runtimes.map((runtime) => (
                <option key={runtime.runtime} value={runtime.runtime} disabled={!runtime.available}>
                  {runtime.runtime} {runtime.available ? "" : "(unavailable)"}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Profile</span>
            <select
              value={createOptions.runtimeProfile || ""}
              onChange={(event) =>
                onCreateOptionsChange((current) => ({
                  ...current,
                  runtimeProfile: event.target.value,
                }))
              }
            >
              <option value="">default</option>
              {profileOptions.map((profile) => (
                <option key={profile} value={profile}>
                  {profile}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Model</span>
            <input
              list={`models-${activeRuntime}`}
              value={createOptions.model || ""}
              onChange={(event) =>
                onCreateOptionsChange((current) => ({
                  ...current,
                  model: event.target.value,
                }))
              }
              placeholder="default or custom model id"
            />
            <datalist id={`models-${activeRuntime}`}>
              {modelOptions.map((model) => (
                <option key={model} value={model} />
              ))}
            </datalist>
          </label>
        </div>
        {activeRuntimeInfo?.notes ? <p className="runtime-note">{activeRuntimeInfo.notes}</p> : null}
      </div>
      <div className="hero-actions">
        <button className="secondary-button" onClick={onNewSession} disabled={snapshot?.session.status === "running"}>
          新建会话
        </button>
        <button className="danger-button" onClick={onStop} disabled={snapshot?.session.status !== "running"}>
          停止执行
        </button>
      </div>
    </header>
  );
}
