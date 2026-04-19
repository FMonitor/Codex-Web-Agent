export type TabType = "agent" | "file" | "console";

export interface TabItem {
  id: string;
  type: TabType;
  label: string;
  closable: boolean;
  data?: Record<string, unknown>;
}

interface TabBarProps {
  activeTabId: string;
  tabs: TabItem[];
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onNewConsoleTab: () => void;
  canCreateConsole: boolean;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
}

export function TabBar({
  activeTabId,
  tabs,
  onSelectTab,
  onCloseTab,
  onNewConsoleTab,
  canCreateConsole,
  sidebarOpen,
  onToggleSidebar,
}: TabBarProps) {
  const agentTab = tabs.find((t) => t.type === "agent");
  const fileTabs = tabs.filter((t) => t.type === "file");
  const consoleTabs = tabs.filter((t) => t.type === "console");

  return (
    <div className="tab-bar">
      <button
        className={`tab-sidebar-toggle ${sidebarOpen ? "open" : "closed"}`}
        onClick={onToggleSidebar}
        type="button"
        title={sidebarOpen ? "隐藏侧栏" : "显示侧栏"}
        aria-label={sidebarOpen ? "隐藏侧栏" : "显示侧栏"}
      >
        <span aria-hidden="true">☰</span>
      </button>

      {/* Agent tab (always present, not closable) */}
      {agentTab && (
        <button
          className={`tab-item ${activeTabId === agentTab.id ? "active" : ""}`}
          onClick={() => onSelectTab(agentTab.id)}
          type="button"
        >
          <span className="tab-label">Agent</span>
        </button>
      )}

      {/* File tabs */}
      {fileTabs.map((tab) => (
        <div
          key={tab.id}
          className={`tab-item ${activeTabId === tab.id ? "active" : ""} ${tab.closable ? "closable" : ""}`}
        >
          <button
            className="tab-label-button"
            onClick={() => onSelectTab(tab.id)}
            type="button"
            title={tab.label}
          >
            <span className="tab-label">{tab.label}</span>
          </button>
          {tab.closable && (
            <button
              className="tab-close"
              onClick={() => onCloseTab(tab.id)}
              type="button"
              title="Close"
              aria-label="Close tab"
            >
              ✕
            </button>
          )}
        </div>
      ))}

      {/* Console tabs */}
      {consoleTabs.map((tab) => (
        <div
          key={tab.id}
          className={`tab-item ${activeTabId === tab.id ? "active" : ""} console-tab`}
        >
          <button
            className="tab-label-button"
            onClick={() => onSelectTab(tab.id)}
            type="button"
            title={tab.label}
          >
            <span className="tab-label">{tab.label}</span>
          </button>
          <button
            className="tab-close"
            onClick={() => onCloseTab(tab.id)}
            type="button"
            title="Close"
            aria-label="Close tab"
          >
            ✕
          </button>
        </div>
      ))}

      {/* New console button */}
      <button
        className="new-console-btn"
        onClick={onNewConsoleTab}
        type="button"
        title="New Console"
        disabled={!canCreateConsole}
      >
        +
      </button>
    </div>
  );
}
