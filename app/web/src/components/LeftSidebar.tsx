import type { SessionSummary } from "@copilot-console/shared";
import type { WorkspaceTreeNode } from "../api/client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

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
  onSelectFile: (path: string) => void;
  onArchiveSession: (sessionId: string) => void;
  onExportSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
}

function TreeNode({ node, onSelectFile }: { node: WorkspaceTreeNode; onSelectFile: (path: string) => void }) {
  if (node.type === "file") {
    return (
      <li className="tree-item tree-file" title={node.path}>
        <button type="button" className="tree-file-button" onClick={() => onSelectFile(node.path)}>
          {node.name}
        </button>
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
              <TreeNode key={`${node.path}/${child.path}`} node={child} onSelectFile={onSelectFile} />
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
  onSelectFile,
  onArchiveSession,
  onExportSession,
  onDeleteSession,
}: LeftSidebarProps) {
  const sessionListRef = useRef<HTMLDivElement | null>(null);
  const [actionMenu, setActionMenu] = useState<{
    sessionId: string;
    top: number;
    left: number;
  } | null>(null);

  useEffect(() => {
    const close = () => setActionMenu(null);

    const onDocumentClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) {
        return;
      }

      if (target.closest(".session-menu-popup") || target.closest(".session-menu-btn")) {
        return;
      }
      close();
    };

    const onWindowUpdate = () => close();

    document.addEventListener("mousedown", onDocumentClick);
    window.addEventListener("resize", onWindowUpdate);
    window.addEventListener("scroll", onWindowUpdate, true);

    return () => {
      document.removeEventListener("mousedown", onDocumentClick);
      window.removeEventListener("resize", onWindowUpdate);
      window.removeEventListener("scroll", onWindowUpdate, true);
    };
  }, []);

  const activeMenuSession = actionMenu
    ? sessions.find((session) => session.id === actionMenu.sessionId) || null
    : null;

  useEffect(() => {
    if (tab !== "sessions") {
      return;
    }

    const listElement = sessionListRef.current;
    if (!listElement) {
      return;
    }

    const activeElement = listElement.querySelector(".session-item.active") as HTMLElement | null;
    if (!activeElement) {
      return;
    }

    activeElement.scrollIntoView({ block: "center", inline: "nearest" });
  }, [tab, activeSessionId, sessions.length]);

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
        <div className="side-panel-viewport" key={tab}>
          {tab === "sessions" ? (
            <>
              <div className="side-panel-head">
                <strong>Session 列表</strong>
              </div>
              <div ref={sessionListRef} className="session-list">
                {sessions.length === 0 ? <p className="muted">暂无 Session</p> : null}
                {sessions.map((session) => (
                  <div key={session.id} className={`session-item ${activeSessionId === session.id ? "active" : ""}`}>
                    <div className="row session-item-head">
                      <button
                        type="button"
                        className="session-main"
                        onClick={() => onSelectSession(session.id)}
                        title={session.title || session.model || "新会话"}
                      >
                        <strong className="session-model">{session.title || session.model || "新会话"}</strong>
                      </button>
                      <button
                        type="button"
                        className="session-menu-btn"
                        onClick={(event) => {
                          const rect = event.currentTarget.getBoundingClientRect();
                          setActionMenu((current) =>
                            current?.sessionId === session.id
                              ? null
                              : {
                                  sessionId: session.id,
                                  top: rect.bottom + 6,
                                  left: rect.left,
                                }
                          );
                        }}
                        title="Options"
                      >
                        ⋮
                      </button>
                    </div>
                    <div className="session-meta">
                      <span className="muted">{new Date(session.updatedAt).toLocaleTimeString("zh-CN")}</span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="side-panel-head">
                <strong>工作区文件树</strong>
              </div>
              <p className="muted">根路径: {workspaceRootLabel}</p>
              {workspaceTreeLoading ? <p className="muted">加载中...</p> : null}
              {workspaceTree ? (
                <ul className="tree-list">
                  <TreeNode node={workspaceTree} onSelectFile={onSelectFile} />
                </ul>
              ) : null}
            </>
          )}
        </div>
      </div>

      {activeMenuSession && actionMenu && typeof document !== "undefined"
        ? createPortal(
        <div
          className="session-menu-popup"
          style={{
            position: "fixed",
            top: `${actionMenu.top}px`,
            left: `${actionMenu.left}px`,
          }}
        >
          <button
            type="button"
            className="menu-item"
            onClick={() => {
              onArchiveSession(activeMenuSession.id);
              setActionMenu(null);
            }}
          >
            归档
          </button>
          <button
            type="button"
            className="menu-item"
            onClick={() => {
              onExportSession(activeMenuSession.id);
              setActionMenu(null);
            }}
          >
            导出
          </button>
          <button
            type="button"
            className="menu-item menu-item-danger"
            onClick={() => {
              onDeleteSession(activeMenuSession.id);
              setActionMenu(null);
            }}
          >
            删除
          </button>
        </div>
          ,
          document.body,
        )
        : null}
    </aside>
  );
}
