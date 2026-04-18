import type { ConsoleEvent, FileChange, LogEntry, ToolExecution } from "@copilot-console/shared";

interface SidebarPanelsProps {
  phase: string;
  tools: ToolExecution[];
  logs: LogEntry[];
  fileChanges: FileChange[];
  timeline: ConsoleEvent[];
}

function copyLogs(logs: LogEntry[]) {
  const text = logs.map((item) => `[${item.source}] ${item.content}`).join("\n");
  navigator.clipboard.writeText(text);
}

export function SidebarPanels({ phase, tools, logs, fileChanges, timeline }: SidebarPanelsProps) {
  const statusEvents = timeline
    .filter((item) => item.type !== "log.stdout" && item.type !== "log.stderr")
    .slice(-8)
    .reverse();

  return (
    <div className="sidebar">
      <details className="card" open>
        <summary>执行状态</summary>
        <div className="phase-chip">{phase}</div>
        <div className="timeline">
          {statusEvents.map((event) => (
            <div key={event.id} className="timeline-item">
              <strong>{event.type}</strong>
              <span>{event.message || event.title || event.phase || "event"}</span>
            </div>
          ))}
        </div>
      </details>

      <details className="card" open>
        <summary>工具调用</summary>
        <div className="stack-list">
          {tools.length === 0 ? <p className="muted">暂无工具调用</p> : null}
          {tools.map((tool) => (
            <article key={tool.id} className="stack-item">
              <div className="row">
                <strong>{tool.name}</strong>
                <span className={`pill pill-${tool.status}`}>{tool.status}</span>
              </div>
              <p>{tool.summary}</p>
              {tool.inputSummary ? <code>{tool.inputSummary}</code> : null}
              {tool.outputSummary ? <span className="muted">{tool.outputSummary}</span> : null}
              {tool.errorMessage ? <span className="error-text">{tool.errorMessage}</span> : null}
            </article>
          ))}
        </div>
      </details>

      <details className="card" open>
        <summary>文件变更</summary>
        <div className="stack-list">
          {fileChanges.length === 0 ? <p className="muted">暂无文件变更</p> : null}
          {fileChanges.map((change) => (
            <article key={change.id} className="stack-item">
              <div className="row">
                <strong>{change.path}</strong>
                <span className={`pill pill-${change.changeType}`}>{change.changeType}</span>
              </div>
              <p>{change.summary}</p>
              {change.patch ? <pre>{change.patch}</pre> : null}
            </article>
          ))}
        </div>
      </details>

      <details className="card" open>
        <summary>日志输出</summary>
        <div className="row card-toolbar">
          <span className="muted">{logs.length} entries</span>
          <button className="ghost-button small-button" onClick={() => copyLogs(logs)} disabled={logs.length === 0}>
            复制日志
          </button>
        </div>
        <div className="log-panel">
          {logs.length === 0 ? <p className="muted">暂无日志输出</p> : null}
          {logs.map((log) => (
            <div key={log.id} className={`log-line log-${log.source}`}>
              <span>[{log.source}]</span> {log.content}
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}

