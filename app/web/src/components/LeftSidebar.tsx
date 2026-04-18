import type { SessionSummary } from "@copilot-console/shared";
import type { WorkspaceTreeNode } from "../api/client";

type SidebarTab = "sessions" | "files";

interface LeftSidebarProps {
  tab: SidebarTab;
  sessions: SessionSummary[];
  activeSessionId: string | null;
  workspaceTree: WorkspaceTreeNode | null;
  workspaceRootLabel: string;
  workspaceTreeLoading: boolean;
  onChangeTab: (tab: SidebarTab) => void;
  onSelectSession: (sessionId: string) => void;
  onRefreshSessions: () => void;
  onRefreshTree: () => void;
}

function TreeNode({ node }: { node: WorkspaceTreeNode }) {
  if (node.type === "file") {
    return (
      <li className="tree-item tree-file" title={node.path}>
        {node.name}
      </li>
    );
  }

  return (
    <li className="tree-item tree-dir" title={node.path}>
      <details open>
        <summary>{node.name}</summary>
        {node.children && node.children.length > 0 ? (
          <ul className="tree-list">
            {node.children.map((child) => (
              <TreeNode key={`${node.path}/${child.path}`} node={child} />
            ))}
          </ul>
        ) : null}
        {node.truncated ? <div className="muted">目录内容已截断</div> : null}
      </details>
    </li>
  );
}

export function LeftSidebar({
  tab,
  sessions,
  activeSessionId,
  workspaceTree,
  workspaceRootLabel,
  workspaceTreeLoading,
  onChangeTab,
  onSelectSession,
  onRefreshSessions,
  onRefreshTree,
}: LeftSidebarProps) {
  return (
    <aside className="left-sidebar">
      <div className="side-tabs">
        <button
          type="button"
          className={`side-tab ${tab === "sessions" ? "active" : ""}`}
          onClick={() => onChangeTab("sessions")}
        >
          Session
        </button>
        <button
          type="button"
          className={`side-tab ${tab === "files" ? "active" : ""}`}
          onClick={() => onChangeTab("files")}
        >
          Files
        </button>
      </div>

      <div className="side-panel">
        {tab === "sessions" ? (
          <>
            <div className="side-panel-head">
              <strong>Session 列表</strong>
              <button type="button" className="ghost-button small-button" onClick={onRefreshSessions}>
                刷新
              </button>
            </div>
            <div className="session-list">
              {sessions.length === 0 ? <p className="muted">暂无 Session</p> : null}
              {sessions.map((session) => (
                <button
                  key={session.id}
                  type="button"
                  className={`session-item ${activeSessionId === session.id ? "active" : ""}`}
                  onClick={() => onSelectSession(session.id)}
                >
                  <div className="row">
                    <strong>{session.title}</strong>
                    <span className={`pill pill-${session.status}`}>{session.status}</span>
                  </div>
                  <div className="muted">{session.runtimeProfile || "default"} / {session.model || "default"}</div>
                  <div className="muted">{new Date(session.updatedAt).toLocaleString("zh-CN")}</div>
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="side-panel-head">
              <strong>工作区文件树</strong>
              <button type="button" className="ghost-button small-button" onClick={onRefreshTree}>
                刷新
              </button>
            </div>
            <p className="muted">根路径: {workspaceRootLabel}</p>
            {workspaceTreeLoading ? <p className="muted">加载中...</p> : null}
            {workspaceTree ? (
              <ul className="tree-list">
                <TreeNode node={workspaceTree} />
              </ul>
            ) : null}
          </>
        )}
      </div>
    </aside>
  );
}
