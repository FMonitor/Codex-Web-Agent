import type { SessionSummary } from "@copilot-console/shared";
import type { WorkspaceTreeNode } from "../api/client";
import { useEffect, useRef, useState, type DragEvent as ReactDragEvent, type MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";

type SidebarTab = "sessions" | "files";

interface LeftSidebarProps {
  tab: SidebarTab;
  sessions: SessionSummary[];
  activeSessionId: string | null;
  workspaceTree: WorkspaceTreeNode | null;
  workspaceTreeLoading: boolean;
  onChangeTab: (tab: SidebarTab) => void;
  onSelectSession: (sessionId: string) => void;
  onSelectFile: (path: string) => void;
  onArchiveSession: (sessionId: string) => void;
  onExportSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
  onCopyEntry: (sourcePath: string, targetPath: string) => Promise<unknown>;
  onMoveEntry: (sourcePath: string, targetPath: string) => Promise<unknown>;
  onDeleteEntry: (path: string) => Promise<unknown>;
}

interface TreeNodeProps {
  node: WorkspaceTreeNode;
  onSelectFile: (path: string) => void;
  onNodeContextMenu: (event: ReactMouseEvent<HTMLElement>, node: WorkspaceTreeNode) => void;
  onNodeMouseDown: (event: ReactMouseEvent<HTMLElement>, node: WorkspaceTreeNode) => void;
  onNodeMouseUp: (node: WorkspaceTreeNode) => void;
  onNodeDragStart: (event: ReactDragEvent<HTMLElement>, node: WorkspaceTreeNode) => void;
  onNodeDragEnd: () => void;
  onDirectoryDragOver: (event: ReactDragEvent<HTMLElement>, node: WorkspaceTreeNode) => void;
  onDirectoryDragLeave: (node: WorkspaceTreeNode) => void;
  onDirectoryDrop: (event: ReactDragEvent<HTMLElement>, node: WorkspaceTreeNode) => void;
  draggingPath: string | null;
  dropTargetPath: string | null;
}

function normalizeRelativePath(value: string): string {
  const normalized = value.trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "").replace(/\/+$/, "");
  return normalized || ".";
}

function splitPath(path: string): string[] {
  return normalizeRelativePath(path).split("/").filter(Boolean);
}

function basenameFromPath(path: string): string {
  const parts = splitPath(path);
  return parts[parts.length - 1] || path;
}

function buildCopySuggestion(path: string): string {
  const normalized = normalizeRelativePath(path);
  if (normalized === ".") {
    return "";
  }

  const parts = splitPath(normalized);
  const name = parts.pop() || "item";
  const extensionIndex = name.lastIndexOf(".");
  const copiedName = extensionIndex > 0
    ? `${name.slice(0, extensionIndex)}-copy${name.slice(extensionIndex)}`
    : `${name}-copy`;
  const parent = parts.join("/");
  return parent ? `${parent}/${copiedName}` : copiedName;
}

function joinPath(parentPath: string, childName: string): string {
  const parent = normalizeRelativePath(parentPath);
  if (parent === ".") {
    return childName;
  }
  return `${parent}/${childName}`;
}

function canDropIntoTarget(sourcePath: string, targetDirPath: string): boolean {
  const source = normalizeRelativePath(sourcePath);
  const target = normalizeRelativePath(targetDirPath);

  if (source === "." || target === "") {
    return false;
  }

  if (source === target) {
    return false;
  }

  return !target.startsWith(`${source}/`);
}

function TreeNode({
  node,
  onSelectFile,
  onNodeContextMenu,
  onNodeMouseDown,
  onNodeMouseUp,
  onNodeDragStart,
  onNodeDragEnd,
  onDirectoryDragOver,
  onDirectoryDragLeave,
  onDirectoryDrop,
  draggingPath,
  dropTargetPath,
}: TreeNodeProps) {
  const normalizedPath = normalizeRelativePath(node.path);
  const isDragSource = draggingPath === normalizedPath;
  const isDropTarget = dropTargetPath === normalizedPath;
  const isRoot = normalizedPath === ".";

  if (node.type === "file") {
    return (
      <li
        className={`tree-item tree-file ${isDragSource ? "drag-source" : ""}`}
        title={node.path}
        onContextMenu={(event) => onNodeContextMenu(event, node)}
      >
        <button
          type="button"
          className="tree-file-button"
          onClick={() => onSelectFile(node.path)}
          draggable
          onMouseDown={(event) => onNodeMouseDown(event, node)}
          onMouseUp={() => onNodeMouseUp(node)}
          onDragStart={(event) => onNodeDragStart(event, node)}
          onDragEnd={onNodeDragEnd}
        >
          {node.name}
        </button>
      </li>
    );
  }

  return (
    <li
      className={`tree-item tree-dir ${isDragSource ? "drag-source" : ""}`}
      title={node.path}
      onDragOver={(event) => onDirectoryDragOver(event, node)}
      onDragLeave={() => onDirectoryDragLeave(node)}
      onDrop={(event) => onDirectoryDrop(event, node)}
    >
      <details open>
        <summary
          className={`tree-dir-summary ${isDropTarget ? "drop-target" : ""}`}
          onContextMenu={(event) => onNodeContextMenu(event, node)}
          draggable={!isRoot}
          onMouseDown={(event) => onNodeMouseDown(event, node)}
          onMouseUp={() => onNodeMouseUp(node)}
          onDragStart={(event) => onNodeDragStart(event, node)}
          onDragEnd={onNodeDragEnd}
        >
          {node.name}
        </summary>
        {node.children && node.children.length > 0 ? (
          <ul className="tree-list">
            {node.children.map((child) => (
              <TreeNode
                key={child.path}
                node={child}
                onSelectFile={onSelectFile}
                onNodeContextMenu={onNodeContextMenu}
                onNodeMouseDown={onNodeMouseDown}
                onNodeMouseUp={onNodeMouseUp}
                onNodeDragStart={onNodeDragStart}
                onNodeDragEnd={onNodeDragEnd}
                onDirectoryDragOver={onDirectoryDragOver}
                onDirectoryDragLeave={onDirectoryDragLeave}
                onDirectoryDrop={onDirectoryDrop}
                draggingPath={draggingPath}
                dropTargetPath={dropTargetPath}
              />
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
  workspaceTreeLoading,
  onChangeTab,
  onSelectSession,
  onSelectFile,
  onArchiveSession,
  onExportSession,
  onDeleteSession,
  onCopyEntry,
  onMoveEntry,
  onDeleteEntry,
}: LeftSidebarProps) {
  const sessionListRef = useRef<HTMLDivElement | null>(null);
  const dragPressStartedAtRef = useRef<Record<string, number>>({});
  const [actionMenu, setActionMenu] = useState<{
    sessionId: string;
    top: number;
    left: number;
  } | null>(null);
  const [fileMenu, setFileMenu] = useState<{
    path: string;
    type: "file" | "directory";
    top: number;
    left: number;
  } | null>(null);
  const [fileActionBusy, setFileActionBusy] = useState(false);
  const [draggingPath, setDraggingPath] = useState<string | null>(null);
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null);

  useEffect(() => {
    const close = () => setActionMenu(null);

    const onDocumentClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) {
        return;
      }

      if (
        target.closest(".session-menu-popup") ||
        target.closest(".session-menu-btn") ||
        target.closest(".file-menu-popup")
      ) {
        return;
      }
      close();
      setFileMenu(null);
    };

    const onWindowUpdate = () => {
      close();
      setFileMenu(null);
    };

    document.addEventListener("mousedown", onDocumentClick);
    window.addEventListener("resize", onWindowUpdate);
    window.addEventListener("scroll", onWindowUpdate, true);

    return () => {
      document.removeEventListener("mousedown", onDocumentClick);
      window.removeEventListener("resize", onWindowUpdate);
      window.removeEventListener("scroll", onWindowUpdate, true);
    };
  }, []);

  const handleNodeContextMenu = (event: ReactMouseEvent<HTMLElement>, node: WorkspaceTreeNode) => {
    event.preventDefault();
    const normalizedPath = normalizeRelativePath(node.path);
    if (normalizedPath === ".") {
      return;
    }
    setActionMenu(null);
    setFileMenu({
      path: normalizedPath,
      type: node.type,
      top: event.clientY,
      left: event.clientX,
    });
  };

  const handleNodeMouseDown = (event: ReactMouseEvent<HTMLElement>, node: WorkspaceTreeNode) => {
    if (event.button !== 0) {
      return;
    }
    const path = normalizeRelativePath(node.path);
    dragPressStartedAtRef.current[path] = Date.now();
  };

  const handleNodeMouseUp = (node: WorkspaceTreeNode) => {
    const path = normalizeRelativePath(node.path);
    delete dragPressStartedAtRef.current[path];
  };

  const handleNodeDragStart = (event: ReactDragEvent<HTMLElement>, node: WorkspaceTreeNode) => {
    const path = normalizeRelativePath(node.path);
    if (path === ".") {
      event.preventDefault();
      return;
    }

    const startedAt = dragPressStartedAtRef.current[path] || 0;
    if (Date.now() - startedAt < 180) {
      event.preventDefault();
      return;
    }

    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", path);
    setDraggingPath(path);
    setDropTargetPath(null);
  };

  const handleNodeDragEnd = () => {
    setDraggingPath(null);
    setDropTargetPath(null);
  };

  const handleDirectoryDragOver = (event: ReactDragEvent<HTMLElement>, node: WorkspaceTreeNode) => {
    if (node.type !== "directory") {
      return;
    }
    const sourcePath = event.dataTransfer.getData("text/plain") || draggingPath;
    if (!sourcePath) {
      return;
    }

    const targetPath = normalizeRelativePath(node.path);
    if (!canDropIntoTarget(sourcePath, targetPath)) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (dropTargetPath !== targetPath) {
      setDropTargetPath(targetPath);
    }
  };

  const handleDirectoryDragLeave = (node: WorkspaceTreeNode) => {
    const targetPath = normalizeRelativePath(node.path);
    if (dropTargetPath === targetPath) {
      setDropTargetPath(null);
    }
  };

  const handleDirectoryDrop = (event: ReactDragEvent<HTMLElement>, node: WorkspaceTreeNode) => {
    if (node.type !== "directory") {
      return;
    }

    event.preventDefault();
    const sourcePath = normalizeRelativePath(event.dataTransfer.getData("text/plain") || draggingPath || "");
    const targetDirPath = normalizeRelativePath(node.path);
    setDropTargetPath(null);

    if (!sourcePath || !canDropIntoTarget(sourcePath, targetDirPath)) {
      setDraggingPath(null);
      return;
    }

    const destinationPath = joinPath(targetDirPath, basenameFromPath(sourcePath));
    if (destinationPath === sourcePath) {
      setDraggingPath(null);
      return;
    }

    setDraggingPath(null);
    void onMoveEntry(sourcePath, destinationPath).catch((error) => {
      const message = error instanceof Error ? error.message : "移动失败";
      if (typeof window !== "undefined") {
        window.alert(message);
      }
    });
  };

  const handleCopyEntry = async () => {
    if (!fileMenu || fileActionBusy) {
      return;
    }

    const sourcePath = normalizeRelativePath(fileMenu.path);
    const suggestion = buildCopySuggestion(sourcePath);
    const targetInput = typeof window !== "undefined"
      ? window.prompt("复制到（相对工作区路径）", suggestion)
      : suggestion;
    if (!targetInput || !targetInput.trim()) {
      return;
    }

    setFileActionBusy(true);
    try {
      await onCopyEntry(sourcePath, targetInput.trim());
      setFileMenu(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "复制失败";
      if (typeof window !== "undefined") {
        window.alert(message);
      }
    } finally {
      setFileActionBusy(false);
    }
  };

  const handleDeleteEntry = async () => {
    if (!fileMenu || fileActionBusy) {
      return;
    }

    const path = normalizeRelativePath(fileMenu.path);
    const confirmed =
      typeof window === "undefined"
        ? true
        : window.confirm(`确认删除 ${fileMenu.type === "directory" ? "目录" : "文件"} ${path} ?`);
    if (!confirmed) {
      return;
    }

    setFileActionBusy(true);
    try {
      await onDeleteEntry(path);
      setFileMenu(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "删除失败";
      if (typeof window !== "undefined") {
        window.alert(message);
      }
    } finally {
      setFileActionBusy(false);
    }
  };

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
              {workspaceTreeLoading ? <p className="muted">加载中...</p> : null}
              {workspaceTree ? (
                <ul className="tree-list">
                  <TreeNode
                    node={workspaceTree}
                    onSelectFile={onSelectFile}
                    onNodeContextMenu={handleNodeContextMenu}
                    onNodeMouseDown={handleNodeMouseDown}
                    onNodeMouseUp={handleNodeMouseUp}
                    onNodeDragStart={handleNodeDragStart}
                    onNodeDragEnd={handleNodeDragEnd}
                    onDirectoryDragOver={handleDirectoryDragOver}
                    onDirectoryDragLeave={handleDirectoryDragLeave}
                    onDirectoryDrop={handleDirectoryDrop}
                    draggingPath={draggingPath}
                    dropTargetPath={dropTargetPath}
                  />
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

      {fileMenu && typeof document !== "undefined"
        ? createPortal(
        <div
          className="session-menu-popup file-menu-popup"
          style={{
            position: "fixed",
            top: `${fileMenu.top}px`,
            left: `${fileMenu.left}px`,
          }}
        >
          <button
            type="button"
            className="menu-item"
            onClick={() => void handleCopyEntry()}
            disabled={fileActionBusy}
          >
            复制
          </button>
          <button
            type="button"
            className="menu-item menu-item-danger"
            onClick={() => void handleDeleteEntry()}
            disabled={fileActionBusy}
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
