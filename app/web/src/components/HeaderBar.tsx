import type { CreateSessionInput, SessionSnapshot } from "@copilot-console/shared";
import type { Dispatch, SetStateAction } from "react";
import type { RuntimeInfo } from "../api/client";

interface HeaderBarProps {
  snapshot: SessionSnapshot | null;
  createOptions: Partial<CreateSessionInput>;
  modelOptions: string[];
  transportState: string;
  runtimeInfo: RuntimeInfo | null;
  onCreateOptionsChange: Dispatch<SetStateAction<Partial<CreateSessionInput>>>;
  onNewSession: () => void;
}

export function HeaderBar({
  snapshot,
  createOptions,
  modelOptions,
  transportState,
  runtimeInfo,
  onCreateOptionsChange,
  onNewSession,
}: HeaderBarProps) {
  const profileOptions = runtimeInfo?.profiles || [];

  return (
    <header className="hero-panel">
      <div className="hero-copy">
        <span className="eyebrow">Codex Chat Console</span>
        <h1>单会话 Codex 控制台</h1>
        <p>
          发送消息后会在聊天区显示 Agent 回复、工具调用状态、文件读取/修改进度，以及可折叠执行日志。
        </p>
        <div className="runtime-form">
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
              list="models-codex"
              value={createOptions.model || ""}
              onChange={(event) =>
                onCreateOptionsChange((current) => ({
                  ...current,
                  model: event.target.value,
                }))
              }
              placeholder="default or custom model id"
            />
            <datalist id="models-codex">
              {modelOptions.map((model) => (
                <option key={model} value={model} />
              ))}
            </datalist>
          </label>
        </div>
        {runtimeInfo?.notes ? <p className="runtime-note">{runtimeInfo.notes}</p> : null}
      </div>
      <div className="hero-actions">
        <button className="secondary-button" onClick={onNewSession} disabled={snapshot?.session.status === "running"}>
          新建会话
        </button>
      </div>
    </header>
  );
}
