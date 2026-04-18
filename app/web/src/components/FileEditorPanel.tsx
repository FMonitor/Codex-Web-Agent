import Editor from "@monaco-editor/react";

interface FileEditorPanelProps {
  filePath: string;
  loading: boolean;
  supported: boolean;
  reason: string | null;
  language: string;
  content: string;
  onClose: () => void;
}

export function FileEditorPanel({
  filePath,
  loading,
  supported,
  reason,
  language,
  content,
  onClose,
}: FileEditorPanelProps) {
  return (
    <section className="file-editor-panel">
      <div className="file-editor-head">
        <strong>{filePath}</strong>
        <button type="button" className="ghost-button small-button" onClick={onClose}>
          关闭
        </button>
      </div>

      {loading ? <div className="muted">文件加载中...</div> : null}

      {!loading && !supported ? (
        <div className="unsupported-file">Unsupported file{reason ? `: ${reason}` : ""}</div>
      ) : null}

      {!loading && supported ? (
        <div className="editor-shell">
          <Editor
            height="280px"
            language={language}
            value={content}
            theme="vs-dark"
            options={{
              readOnly: true,
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
