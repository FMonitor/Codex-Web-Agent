import { useMemo, useState } from "react";
import { apiClient } from "./api/client";
import { Composer } from "./components/Composer";
import { ConsoleTabPanel } from "./components/ConsoleTabPanel";
import { FileEditorPanel } from "./components/FileEditorPanel";
import { HeaderBar } from "./components/HeaderBar";
import { LeftSidebar } from "./components/LeftSidebar";
import { MessageList } from "./components/MessageList";
import { TabBar, type TabItem } from "./components/TabBar";
import { TodoStrip } from "./components/TodoStrip";
import { useConsoleSession } from "./hooks/useConsoleSession";

function tabFilePath(tab: TabItem | undefined): string | null {
  const value = tab?.data?.path;
  return typeof value === "string" ? value : null;
}

function tabConsoleId(tab: TabItem | undefined): string | null {
  const value = tab?.data?.consoleTabId;
  return typeof value === "string" ? value : null;
}

function fileNameFromPath(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] || path;
}

export function App() {
  const {
    bootstrap,
    snapshot,
    error,
    createOptions,
    modelOptions,
    setCreateOptions,
    startNewSessionDraft,
    sendMessage,
    stopSession,
    runtimeInfo,
    sessions,
    activeSessionId,
    sidebarTab,
    setSidebarTab,
    workspaceTree,
    workspaceTreeLoading,
    selectSession,
    archiveSession,
    exportSession,
    deleteSession,
    openedFile,
    openWorkspaceFile,
    closeWorkspaceFile,
    saveWorkspaceFile,
    copyWorkspaceEntry,
    moveWorkspaceEntry,
    deleteWorkspaceEntry,
    refreshWorkspaceTree,
  } = useConsoleSession();

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [tabError, setTabError] = useState("");
  const [tabs, setTabs] = useState<TabItem[]>([
    { id: "agent", type: "agent", label: "Agent", closable: false },
  ]);
  const [activeTabId, setActiveTabId] = useState("agent");

  const activeTab = useMemo(
    () => tabs.find((item) => item.id === activeTabId) || tabs[0],
    [tabs, activeTabId],
  );

  const handleSelectTab = (tabId: string) => {
    setActiveTabId(tabId);
    const tab = tabs.find((item) => item.id === tabId);
    const filePath = tabFilePath(tab);
    if (filePath) {
      void openWorkspaceFile(filePath);
    }
  };

  const handleOpenFileTab = (path: string) => {
    const tabId = `file:${path}`;
    setTabError("");

    setTabs((prev) => {
      if (prev.some((item) => item.id === tabId)) {
        return prev;
      }
      return [
        ...prev,
        {
          id: tabId,
          type: "file",
          label: fileNameFromPath(path),
          closable: true,
          data: { path },
        },
      ];
    });

    setActiveTabId(tabId);
    void openWorkspaceFile(path);
  };

  const handleCloseTab = (tabId: string) => {
    const closingTab = tabs.find((item) => item.id === tabId);
    if (!closingTab || !closingTab.closable) {
      return;
    }

    if (closingTab.type === "file") {
      const closingPath = tabFilePath(closingTab);
      if (closingPath && openedFile?.path === closingPath) {
        closeWorkspaceFile();
      }
    }

    if (closingTab.type === "console") {
      const consoleId = tabConsoleId(closingTab);
      if (consoleId) {
        void apiClient.deleteConsoleTab(consoleId).catch(() => {
          // Ignore close errors so the UI tab can still close.
        });
      }
    }

    const closingIndex = tabs.findIndex((item) => item.id === tabId);
    const nextTabs = tabs.filter((item) => item.id !== tabId);
    setTabs(nextTabs);

    if (activeTabId === tabId) {
      const fallback = nextTabs[Math.max(0, closingIndex - 1)]?.id || nextTabs[0]?.id || "agent";
      setActiveTabId(fallback);
    }
  };

  const handleNewConsoleTab = async () => {
    if (!bootstrap) {
      return;
    }

    setTabError("");

    try {
      const created = await apiClient.createConsoleTab(
        snapshot?.session.workspacePath || bootstrap.defaultWorkspacePath,
      );
      const tabId = `console:${created.id}`;

      setTabs((prev) => {
        const consoleCount = prev.filter((item) => item.type === "console").length;
        return [
          ...prev,
          {
            id: tabId,
            type: "console",
            label: `Console ${consoleCount + 1}`,
            closable: true,
            data: { consoleTabId: created.id },
          },
        ];
      });
      setActiveTabId(tabId);
    } catch (cause) {
      setTabError(cause instanceof Error ? cause.message : "Failed to create console tab");
    }
  };

  const selectedModel = (createOptions.model || snapshot?.session.model || "").trim();
  const isComposerDisabled = !selectedModel;
  const composerPlaceholder = isComposerDisabled
    ? "请先选择模型"
    : "输入任务，例如：请分析 auth 模块，并修复登录逻辑，再运行相关测试";
  const activeFilePath = tabFilePath(activeTab);
  const activeConsoleId = tabConsoleId(activeTab);
  const currentModelLabel = selectedModel || "Agent";

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
          onNewSession={startNewSessionDraft}
        />

        <main className={`layout-shell ${sidebarOpen ? "sidebar-open" : "sidebar-closed"}`}>
          <button
            type="button"
            className={`sidebar-scrim ${sidebarOpen ? "open" : "closed"}`}
            aria-label="关闭侧栏"
            onClick={() => setSidebarOpen(false)}
          />

          <div className="sidebar-slot">
            <LeftSidebar
              tab={sidebarTab}
              sessions={sessions}
              activeSessionId={activeSessionId}
              workspaceTree={workspaceTree}
              workspaceTreeLoading={workspaceTreeLoading}
              onChangeTab={setSidebarTab}
              onSelectSession={selectSession}
              onSelectFile={handleOpenFileTab}
              onArchiveSession={archiveSession}
              onExportSession={exportSession}
              onDeleteSession={deleteSession}
              onCopyEntry={copyWorkspaceEntry}
              onMoveEntry={moveWorkspaceEntry}
              onDeleteEntry={deleteWorkspaceEntry}
            />
          </div>

          <section className="chat-card">
            <TabBar
              activeTabId={activeTabId}
              tabs={tabs}
              onSelectTab={handleSelectTab}
              onCloseTab={handleCloseTab}
              onNewConsoleTab={() => void handleNewConsoleTab()}
              canCreateConsole={Boolean(bootstrap)}
              sidebarOpen={sidebarOpen}
              onToggleSidebar={() => setSidebarOpen((current) => !current)}
            />

            {tabError ? <div className="error-banner">{tabError}</div> : null}

            <div className="tab-panel-viewport" key={activeTab?.id || "agent"}>
              {activeTab?.type === "agent" ? (
                <section className="agent-tab-panel">
                  <div className="section-head">
                    <div className="section-title-row">
                      <h2>{currentModelLabel}</h2>
                      {snapshot?.session.status === "running" ? (
                        <div className="spinner-inline" title="Processing..." aria-label="Processing" />
                      ) : null}
                    </div>
                  </div>

                  {error ? <div className="error-banner">{error}</div> : null}
                  <MessageList snapshot={snapshot} />
                  <TodoStrip snapshot={snapshot} />
                  <Composer
                    onSend={sendMessage}
                    onStop={stopSession}
                    isRunning={snapshot?.session.status === "running"}
                    disabled={isComposerDisabled}
                    placeholder={composerPlaceholder}
                  />
                </section>
              ) : null}

              {activeTab?.type === "file" && activeFilePath ? (
                <FileEditorPanel
                  filePath={openedFile?.path || activeFilePath}
                  loading={!openedFile || openedFile.path !== activeFilePath || openedFile.loading}
                  supported={openedFile?.path === activeFilePath ? openedFile.supported : true}
                  reason={openedFile?.path === activeFilePath ? openedFile.reason : null}
                  language={openedFile?.path === activeFilePath ? openedFile.language : "plaintext"}
                  content={openedFile?.path === activeFilePath ? openedFile.content : ""}
                  onClose={() => handleCloseTab(activeTab.id)}
                  onSave={saveWorkspaceFile}
                />
              ) : null}

              {activeTab?.type === "console" && activeConsoleId ? (
                <ConsoleTabPanel
                  consoleTabId={activeConsoleId}
                  onCommandComplete={() => void refreshWorkspaceTree({ silent: true })}
                />
              ) : null}

              {activeTab?.type === "file" && !activeFilePath ? (
                <div className="empty-state">文件标签缺少路径信息</div>
              ) : null}

              {activeTab?.type === "console" && !activeConsoleId ? (
                <div className="empty-state">Console 标签缺少实例标识</div>
              ) : null}

              {activeTab?.type === "file" && activeFilePath && openedFile?.path !== activeFilePath ? (
                <div className="empty-state">
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => void openWorkspaceFile(activeFilePath)}
                  >
                    重新加载文件
                  </button>
                </div>
              ) : null}
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
