import { Composer } from "./components/Composer";
import { HeaderBar } from "./components/HeaderBar";
import { LeftSidebar } from "./components/LeftSidebar";
import { MessageList } from "./components/MessageList";
import { useConsoleSession } from "./hooks/useConsoleSession";

export function App() {
  const {
    bootstrap,
    snapshot,
    transportState,
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
  } = useConsoleSession();

  return (
    <div className="shell">
      <div className="backdrop backdrop-one" />
      <div className="backdrop backdrop-two" />

      <div className="app-frame">
        <HeaderBar
          snapshot={snapshot}
          createOptions={createOptions}
          modelOptions={modelOptions}
          transportState={transportState}
          runtimeInfo={runtimeInfo}
          onCreateOptionsChange={setCreateOptions}
          onNewSession={createSession}
        />

        <main className="layout-shell">
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
          />

          <section className="chat-card">
            <div className="section-head">
              <div>
                <h2>聊天与执行状态</h2>
                <p>{snapshot?.session.workspacePath || bootstrap?.defaultWorkspacePath || "loading..."}</p>
              </div>
              <span className="runtime-command">codex-cli</span>
            </div>

            {error ? <div className="error-banner">{error}</div> : null}
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
