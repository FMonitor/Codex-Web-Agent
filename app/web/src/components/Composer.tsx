import { useState } from "react";

interface ComposerProps {
  disabled?: boolean;
  isRunning?: boolean;
  placeholder?: string;
  onSend: (content: string) => Promise<void>;
  onStop: () => Promise<void>;
}

export function Composer({ disabled, isRunning, placeholder, onSend, onStop }: ComposerProps) {
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submitCurrent = async () => {
    const content = value.trim();
    if (!content || disabled || submitting) {
      return;
    }
    setSubmitting(true);
    try {
      await onSend(content);
      setValue("");
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    await submitCurrent();
  };

  return (
    <form className="composer" onSubmit={handleSubmit}>
      <div className="composer-input-row">
        <textarea
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void submitCurrent();
            }
          }}
          placeholder={placeholder || "输入任务，例如：请分析 auth 模块，并修复登录逻辑，再运行相关测试"}
          rows={3}
          disabled={disabled || submitting}
        />
        <div className="composer-actions">
          <button
            type="button"
            className={`danger-button ${isRunning ? "active" : ""}`}
            onClick={() => void onStop()}
            disabled={!isRunning}
          >
            停止
          </button>
          <button type="submit" className="primary-button" disabled={disabled || submitting || !value.trim()}>
            {submitting ? "发送中..." : "发送"}
          </button>
        </div>
      </div>
    </form>
  );
}

