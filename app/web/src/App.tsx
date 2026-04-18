import { useState } from "react";
import { Composer } from "./components/Composer";
import { FileEditorPanel } from "./components/FileEditorPanel";
import { HeaderBar } from "./components/HeaderBar";
import { LeftSidebar } from "./components/LeftSidebar";
import { MessageList } from "./components/MessageList";
import { useConsoleSession } from "./hooks/useConsoleSession";

export function App() {
  const {
    bootstrap,
    snapshot,
    error,
    createOptions,
    modelOptions,
    setCreateOptions,
    createSession,
    sendMessage,
    stopSession,
    runtimeInfo,
    sessions,
    activeSessionId,
    sidebarTab,
    setSidebarTab,
    workspaceTree,
    workspaceRootLabel,
    workspaceTreeLoading,
    refreshSessions,
    refreshWorkspaceTree,
    selectSession,
    archiveSession,
    exportSession,
    deleteSession,
    openedFile,
    openWorkspaceFile,
    closeWorkspaceFile,
  } = useConsoleSession();
  const [sidebarOpen, setSidebarOpen] = useState(true);

  return (
    <div className="shell">
      <div className="backdrop backdrop-one" />
      <div className="backdrop backdrop-two" />

      <div className="app-frame">
        <HeaderBar
          snapshot={snapshot}
          createOptions={createOptions}
          modelOptions={modelOptions}
          runtimeInfo={runtimeInfo}
          onCreateOptionsChange={setCreateOptions}
          onNewSession={createSession}
        />

        <main className={`layout-shell ${sidebarOpen ? "sidebar-open" : "sidebar-closed"}`}>
          {sidebarOpen ? (
            <LeftSidebar
              tab={sidebarTab}
              sessions={sessions}
              activeSessionId={activeSessionId}
              workspaceTree={workspaceTree}
              workspaceRootLabel={workspaceRootLabel}
              workspaceTreeLoading={workspaceTreeLoading}
              onChangeTab={setSidebarTab}
              onSelectSession={selectSession}
              onRefreshSessions={refreshSessions}
              onRefreshTree={refreshWorkspaceTree}
              onSelectFile={openWorkspaceFile}
              onArchiveSession={archiveSession}
              onExportSession={exportSession}
              onDeleteSession={deleteSession}
            />
          ) : null}

          <section className="chat-card">
            <div className="section-head">
              <div>
                <h2>聊天与执行状态</h2>
                <p>{snapshot?.session.workspacePath || bootstrap?.defaultWorkspacePath || "loading..."}</p>
              </div>
              <div className="row">
                <button
                  type="button"
                  className="ghost-button small-button"
                  onClick={() => setSidebarOpen((current) => !current)}
                >
                  {sidebarOpen ? "隐藏侧栏" : "展开侧栏"}
                </button>
                <span className="runtime-command">codex-cli</span>
              </div>
            </div>

            {error ? <div className="error-banner">{error}</div> : null}
            {openedFile ? (
              <FileEditorPanel
                filePath={openedFile.path}
                loading={openedFile.loading}
                supported={openedFile.supported}
                reason={openedFile.reason}
                language={openedFile.language}
                content={openedFile.content}
                onClose={closeWorkspaceFile}
              />
            ) : null}
            <MessageList snapshot={snapshot} />
            <Composer
              onSend={sendMessage}
              onStop={stopSession}
              isRunning={snapshot?.session.status === "running"}
              disabled={!snapshot}
            />
          </section>
        </main>
      </div>
    </div>
  );
}
