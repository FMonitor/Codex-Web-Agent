import { useState } from "react";

interface ComposerProps {
  disabled?: boolean;
  onSend: (content: string) => Promise<void>;
}

export function Composer({ disabled, onSend }: ComposerProps) {
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
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

  return (
    <form className="composer" onSubmit={handleSubmit}>
      <textarea
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="输入任务，例如：请分析 auth 模块，并修复登录逻辑，再运行相关测试"
        rows={3}
        disabled={disabled || submitting}
      />
      <div className="composer-actions">
        <button type="button" className="ghost-button" onClick={() => setValue("")} disabled={disabled || submitting}>
          清空输入
        </button>
        <button type="submit" className="primary-button" disabled={disabled || submitting || !value.trim()}>
          {submitting ? "发送中..." : "发送"}
        </button>
      </div>
    </form>
  );
}

