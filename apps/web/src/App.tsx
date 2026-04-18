import { Composer } from "./components/Composer";
import { HeaderBar } from "./components/HeaderBar";
import { MessageList } from "./components/MessageList";
import { SidebarPanels } from "./components/SidebarPanels";
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
  } = useConsoleSession();

  return (
    <div className="shell">
      <div className="backdrop backdrop-one" />
      <div className="backdrop backdrop-two" />

      <div className="app-frame">
        <HeaderBar
          snapshot={snapshot}
          runtimes={bootstrap?.runtimes || []}
          createOptions={createOptions}
          modelOptions={modelOptions}
          transportState={transportState}
          defaultRuntime={bootstrap?.defaultRuntime || "codex-cli"}
          onCreateOptionsChange={setCreateOptions}
          onNewSession={createSession}
          onStop={stopSession}
        />

        <main className="layout">
          <section className="chat-card">
            <div className="section-head">
              <div>
                <h2>聊天与流式回复</h2>
                <p>{snapshot?.session.workspacePath || bootstrap?.defaultWorkspacePath || "loading..."}</p>
              </div>
              <span className="runtime-command">
                {snapshot?.session.runtime || createOptions.runtime || bootstrap?.defaultRuntime || "codex-cli"}
              </span>
            </div>

            {error ? <div className="error-banner">{error}</div> : null}
            <MessageList messages={snapshot?.messages || []} />
            <Composer onSend={sendMessage} disabled={!snapshot} />
          </section>

          <SidebarPanels
            phase={snapshot?.session.currentPhase || "idle"}
            tools={snapshot?.tools || []}
            logs={snapshot?.logs || []}
            fileChanges={snapshot?.fileChanges || []}
            timeline={snapshot?.timeline || []}
          />
        </main>
      </div>
    </div>
  );
}
