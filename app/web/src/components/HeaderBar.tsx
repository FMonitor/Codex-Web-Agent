import type { CreateSessionInput, SessionSnapshot } from "@copilot-console/shared";
import type { Dispatch, SetStateAction } from "react";
import type { RuntimeInfo } from "../api/client";

interface HeaderBarProps {
  snapshot: SessionSnapshot | null;
  createOptions: Partial<CreateSessionInput>;
  modelOptions: string[];
  runtimeInfo: RuntimeInfo | null;
  onCreateOptionsChange: Dispatch<SetStateAction<Partial<CreateSessionInput>>>;
  onNewSession: () => void;
}

export function HeaderBar({
  snapshot,
  createOptions,
  modelOptions,
  runtimeInfo,
  onCreateOptionsChange,
  onNewSession,
}: HeaderBarProps) {
  const profileOptions = (runtimeInfo?.profiles || []).filter(
    (item) => item === "openai-login" || item === "custom-api",
  );
  const uniqueProfiles = [...new Set(["custom-api", "openai-login", ...profileOptions])];
  const modelOptionsWithCurrent = createOptions.model && !modelOptions.includes(createOptions.model)
    ? [createOptions.model, ...modelOptions]
    : modelOptions;

  return (
    <header className="top-header">
      <div className="header-title">
        <h1>Codex Web Agent</h1>
      </div>

      <div className="header-controls">
        <div className="control-group">
          <select
            className="profile-select"
            value={createOptions.runtimeProfile || "custom-api"}
            onChange={(event) =>
              onCreateOptionsChange((current) => ({
                ...current,
                runtimeProfile: event.target.value,
              }))
            }
            title="Profile"
          >
            {uniqueProfiles.map((profile) => (
              <option key={profile} value={profile}>
                {profile === "openai-login" ? "OpenAI" : profile}
              </option>
            ))}
          </select>

          <select
            className="model-select"
            value={createOptions.model || ""}
            onChange={(event) =>
              onCreateOptionsChange((current) => ({
                ...current,
                model: event.target.value,
              }))
            }
            title="Model"
          >
            <option value="">选择模型</option>
            {modelOptionsWithCurrent.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>
        </div>

        <button
          className="new-session-button"
          onClick={onNewSession}
          disabled={snapshot?.session.status === "running"}
          title="新建会话"
          aria-label="新建会话"
        >
          <span className="sr-only">新建会话</span>
          <span aria-hidden="true">+</span>
        </button>
      </div>
    </header>
  );
}
