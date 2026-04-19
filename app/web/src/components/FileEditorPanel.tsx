import { useEffect, useState } from "react";
import Editor from "@monaco-editor/react";

interface FileEditorPanelProps {
  filePath: string;
  loading: boolean;
  supported: boolean;
  reason: string | null;
  language: string;
  content: string;
  onClose: () => void;
  onSave?: (filePath: string, content: string) => Promise<void>;
}

export function FileEditorPanel({
  filePath,
  loading,
  supported,
  reason,
  language,
  content,
  onClose,
  onSave,
}: FileEditorPanelProps) {
  const [editedContent, setEditedContent] = useState(content);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    setEditedContent(content);
    setSaveError(null);
  }, [filePath, content]);

  const handleSave = async () => {
    if (!onSave) {
      return;
    }
    setIsSaving(true);
    setSaveError(null);
    try {
      await onSave(filePath, editedContent);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Failed to save file");
    } finally {
      setIsSaving(false);
    }
  };

  const isDirty = editedContent !== content;

  return (
    <section className="file-editor-panel">
      <div className="file-editor-head">
        <div className="file-editor-title">
          <strong>{filePath}</strong>
          {isDirty && <span className="unsaved-indicator">●</span>}
        </div>
        <div className="file-editor-actions">
          {onSave && (
            <button
              type="button"
              className="primary-button small"
              onClick={() => void handleSave()}
              disabled={!isDirty || isSaving}
              title={isDirty ? "Save changes" : "No changes"}
            >
              {isSaving ? "保存中..." : "保存"}
            </button>
          )}
          <button type="button" className="ghost-button small-button" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>

      {saveError && <div className="error-banner">{saveError}</div>}

      {loading ? <div className="muted">文件加载中...</div> : null}

      {!loading && !supported ? (
        <div className="unsupported-file">Unsupported file{reason ? `: ${reason}` : ""}</div>
      ) : null}

      {!loading && supported ? (
        <div className="editor-shell">
          <Editor
            height="100%"
            language={language}
            value={editedContent}
            onChange={(value) => setEditedContent(value || "")}
            theme="vs-dark"
            options={{
              readOnly: false,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              wordWrap: "on",
              fontSize: 13,
            }}
          />
        </div>
      ) : null}
    </section>
  );
}
