import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { BrowserFixedPanelTab } from "@/lib/fixed-panel-tabs-state";

export type ProjectWorkspaceFocusMode = "grid" | "primary" | "browser";
export type ProjectWorkspaceToolsView = "tasks" | "source-control";
export type ProjectWorkspaceInspectorView = "browser" | "files" | "diff";

export const DEFAULT_PROJECT_WORKSPACE_ROW_SPLIT_PERCENT = 64;
export const DEFAULT_PROJECT_WORKSPACE_COLUMN_SPLIT_PERCENT = 50;

export interface ProjectWorkspaceTab {
  id: string;
  projectId: string;
  projectName: string;
  primaryThreadId: string | null;
  reviewThreadId: string | null;
  focusMode: ProjectWorkspaceFocusMode;
  toolsView: ProjectWorkspaceToolsView;
  inspectorView: ProjectWorkspaceInspectorView;
  inspectorEnvironmentId: string | null;
  inspectorEnvironmentPinned: boolean;
  inspectorFilePath: string | null;
  rowSplitPercent: number;
  topColumnSplitPercent: number;
  bottomColumnSplitPercent: number;
  primaryTaskKey: string | null;
  reviewTaskKey: string | null;
  browserTab: BrowserFixedPanelTab | null;
}

export interface CreateProjectWorkspaceTabInput {
  projectId: string;
  projectName: string;
  primaryThreadId?: string | null;
  reviewThreadId?: string | null;
  focusMode?: ProjectWorkspaceFocusMode;
  toolsView?: ProjectWorkspaceToolsView;
  inspectorView?: ProjectWorkspaceInspectorView;
  inspectorEnvironmentId?: string | null;
  inspectorEnvironmentPinned?: boolean;
  inspectorFilePath?: string | null;
  rowSplitPercent?: number;
  topColumnSplitPercent?: number;
  bottomColumnSplitPercent?: number;
  browserTab?: BrowserFixedPanelTab | null;
}

export type ProjectWorkspaceTabUpdate = Partial<
  Omit<ProjectWorkspaceTab, "id" | "projectId">
>;

interface ProjectWorkspaceTabsContextValue {
  tabs: readonly ProjectWorkspaceTab[];
  activeTabId: string | null;
  createTab: (input: CreateProjectWorkspaceTabInput) => ProjectWorkspaceTab;
  openTab: (input: CreateProjectWorkspaceTabInput) => ProjectWorkspaceTab;
  selectTab: (tabId: string) => void;
  reorderTab: (activeTabId: string, overTabId: string) => void;
  closeTab: (tabId: string) => void;
  updateTab: (tabId: string, update: ProjectWorkspaceTabUpdate) => void;
}

export const PROJECT_WORKSPACE_TABS_STORAGE_KEY =
  "bb.project-workspace-tabs.v1";
export const ACTIVE_PROJECT_WORKSPACE_TAB_STORAGE_KEY =
  "bb.active-project-workspace-tab.v1";
export const RECENTLY_CLOSED_PROJECT_WORKSPACE_TABS_STORAGE_KEY =
  "bb.recently-closed-project-workspace-tabs.v1";

interface RecentlyClosedProjectWorkspaceTabs {
  version: 1;
  tabs: ProjectWorkspaceTab[];
}

const RECENTLY_CLOSED_TAB_LIMIT = 20;

const ProjectWorkspaceTabsContext =
  createContext<ProjectWorkspaceTabsContextValue | null>(null);

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function parseSplitPercent(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(80, Math.max(20, value))
    : fallback;
}

function isBrowserTab(value: unknown): value is BrowserFixedPanelTab {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.kind === "browser" &&
    typeof candidate.id === "string" &&
    candidate.id.length > 0 &&
    isNullableString(candidate.environmentId) &&
    typeof candidate.url === "string" &&
    isNullableString(candidate.title)
  );
}

function parseProjectWorkspaceTab(value: unknown): ProjectWorkspaceTab | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.id !== "string" ||
    candidate.id.length === 0 ||
    typeof candidate.projectId !== "string" ||
    candidate.projectId.length === 0 ||
    typeof candidate.projectName !== "string" ||
    candidate.projectName.length === 0 ||
    !isNullableString(candidate.primaryThreadId) ||
    !isNullableString(candidate.reviewThreadId) ||
    (candidate.focusMode !== "grid" &&
      candidate.focusMode !== "primary" &&
      candidate.focusMode !== "browser") ||
    (candidate.toolsView !== "tasks" &&
      candidate.toolsView !== "source-control")
  ) {
    return null;
  }

  // `browserTab` was added after the initial workspace-tab prototype. Treat an
  // omitted value as null so early local builds migrate without losing tabs.
  const browserTab = candidate.browserTab;
  if (
    browserTab !== undefined &&
    browserTab !== null &&
    !isBrowserTab(browserTab)
  ) {
    return null;
  }

  return {
    id: candidate.id,
    projectId: candidate.projectId,
    projectName: candidate.projectName,
    primaryThreadId: candidate.primaryThreadId,
    reviewThreadId: candidate.reviewThreadId,
    focusMode: candidate.focusMode,
    toolsView: candidate.toolsView,
    inspectorView:
      candidate.inspectorView === "files" || candidate.inspectorView === "diff"
        ? candidate.inspectorView
        : "browser",
    inspectorEnvironmentId: isNullableString(candidate.inspectorEnvironmentId)
      ? candidate.inspectorEnvironmentId
      : null,
    inspectorEnvironmentPinned: candidate.inspectorEnvironmentPinned === true,
    inspectorFilePath: isNullableString(candidate.inspectorFilePath)
      ? candidate.inspectorFilePath
      : null,
    rowSplitPercent: parseSplitPercent(
      candidate.rowSplitPercent,
      DEFAULT_PROJECT_WORKSPACE_ROW_SPLIT_PERCENT,
    ),
    topColumnSplitPercent: parseSplitPercent(
      candidate.topColumnSplitPercent,
      DEFAULT_PROJECT_WORKSPACE_COLUMN_SPLIT_PERCENT,
    ),
    bottomColumnSplitPercent: parseSplitPercent(
      candidate.bottomColumnSplitPercent,
      DEFAULT_PROJECT_WORKSPACE_COLUMN_SPLIT_PERCENT,
    ),
    primaryTaskKey: isNullableString(candidate.primaryTaskKey)
      ? candidate.primaryTaskKey
      : null,
    reviewTaskKey: isNullableString(candidate.reviewTaskKey)
      ? candidate.reviewTaskKey
      : null,
    browserTab: browserTab ?? null,
  };
}

export function parseProjectWorkspaceTabs(
  serialized: string | null,
): ProjectWorkspaceTab[] {
  if (serialized === null) return [];
  try {
    const parsed: unknown = JSON.parse(serialized);
    if (!Array.isArray(parsed)) return [];
    const seenIds = new Set<string>();
    return parsed.flatMap((value) => {
      const tab = parseProjectWorkspaceTab(value);
      if (tab === null || seenIds.has(tab.id)) return [];
      seenIds.add(tab.id);
      return [tab];
    });
  } catch {
    return [];
  }
}

export function parseRecentlyClosedProjectWorkspaceTabs(
  serialized: string | null,
): RecentlyClosedProjectWorkspaceTabs {
  if (serialized === null) return { version: 1, tabs: [] };
  try {
    const parsed: unknown = JSON.parse(serialized);
    if (typeof parsed !== "object" || parsed === null) {
      return { version: 1, tabs: [] };
    }
    const candidate = parsed as Record<string, unknown>;
    if (candidate.version !== 1 || !Array.isArray(candidate.tabs)) {
      return { version: 1, tabs: [] };
    }
    const seenIds = new Set<string>();
    const tabs = candidate.tabs.flatMap((value) => {
      const tab = parseProjectWorkspaceTab(value);
      if (tab === null || seenIds.has(tab.id)) return [];
      seenIds.add(tab.id);
      return [tab];
    });
    return { version: 1, tabs };
  } catch {
    return { version: 1, tabs: [] };
  }
}

function readTabs(): ProjectWorkspaceTab[] {
  if (typeof window === "undefined") return [];
  return parseProjectWorkspaceTabs(
    window.localStorage.getItem(PROJECT_WORKSPACE_TABS_STORAGE_KEY),
  );
}

function readActiveTabId(): string | null {
  if (typeof window === "undefined") return null;
  return window.sessionStorage.getItem(
    ACTIVE_PROJECT_WORKSPACE_TAB_STORAGE_KEY,
  );
}

function writeTabs(tabs: readonly ProjectWorkspaceTab[]): void {
  window.localStorage.setItem(
    PROJECT_WORKSPACE_TABS_STORAGE_KEY,
    JSON.stringify(tabs),
  );
}

function readRecentlyClosedTabs(): ProjectWorkspaceTab[] {
  if (typeof window === "undefined") return [];
  return parseRecentlyClosedProjectWorkspaceTabs(
    window.localStorage.getItem(
      RECENTLY_CLOSED_PROJECT_WORKSPACE_TABS_STORAGE_KEY,
    ),
  ).tabs;
}

function writeRecentlyClosedTabs(tabs: readonly ProjectWorkspaceTab[]): void {
  const value: RecentlyClosedProjectWorkspaceTabs = {
    version: 1,
    tabs: tabs.slice(-RECENTLY_CLOSED_TAB_LIMIT),
  };
  window.localStorage.setItem(
    RECENTLY_CLOSED_PROJECT_WORKSPACE_TABS_STORAGE_KEY,
    JSON.stringify(value),
  );
}

function writeActiveTabId(tabId: string | null): void {
  if (tabId === null) {
    window.sessionStorage.removeItem(ACTIVE_PROJECT_WORKSPACE_TAB_STORAGE_KEY);
  } else {
    window.sessionStorage.setItem(
      ACTIVE_PROJECT_WORKSPACE_TAB_STORAGE_KEY,
      tabId,
    );
  }
}

function createWorkspaceTabId(): string {
  const randomId = globalThis.crypto?.randomUUID?.();
  return randomId
    ? `workspace_${randomId}`
    : `workspace_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function findMostRecentlyClosedProjectTab(
  tabs: readonly ProjectWorkspaceTab[],
  projectId: string,
): ProjectWorkspaceTab | undefined {
  for (let index = tabs.length - 1; index >= 0; index -= 1) {
    const tab = tabs[index];
    if (tab?.projectId === projectId) return tab;
  }
  return undefined;
}

export function ProjectWorkspaceTabsProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [tabs, setTabs] = useState<ProjectWorkspaceTab[]>(readTabs);
  const [recentlyClosedTabs, setRecentlyClosedTabs] = useState<
    ProjectWorkspaceTab[]
  >(readRecentlyClosedTabs);
  const [storedActiveTabId, setStoredActiveTabId] = useState<string | null>(
    readActiveTabId,
  );
  const activeTabId = useMemo(
    () =>
      storedActiveTabId !== null &&
      tabs.some((tab) => tab.id === storedActiveTabId)
        ? storedActiveTabId
        : (tabs[0]?.id ?? null),
    [storedActiveTabId, tabs],
  );

  const selectTab = useCallback((tabId: string) => {
    setStoredActiveTabId(tabId);
    writeActiveTabId(tabId);
  }, []);

  const createTab = useCallback(
    (input: CreateProjectWorkspaceTabInput): ProjectWorkspaceTab => {
      const tab: ProjectWorkspaceTab = {
        id: createWorkspaceTabId(),
        projectId: input.projectId,
        projectName: input.projectName,
        primaryThreadId: input.primaryThreadId ?? null,
        reviewThreadId: input.reviewThreadId ?? null,
        focusMode: input.focusMode ?? "grid",
        toolsView: input.toolsView ?? "tasks",
        inspectorView: input.inspectorView ?? "browser",
        inspectorEnvironmentId: input.inspectorEnvironmentId ?? null,
        inspectorEnvironmentPinned: input.inspectorEnvironmentPinned ?? false,
        inspectorFilePath: input.inspectorFilePath ?? null,
        rowSplitPercent:
          input.rowSplitPercent ?? DEFAULT_PROJECT_WORKSPACE_ROW_SPLIT_PERCENT,
        topColumnSplitPercent:
          input.topColumnSplitPercent ??
          DEFAULT_PROJECT_WORKSPACE_COLUMN_SPLIT_PERCENT,
        bottomColumnSplitPercent:
          input.bottomColumnSplitPercent ??
          DEFAULT_PROJECT_WORKSPACE_COLUMN_SPLIT_PERCENT,
        primaryTaskKey: null,
        reviewTaskKey: null,
        browserTab: input.browserTab ?? null,
      };
      setTabs((currentTabs) => {
        const nextTabs = [...currentTabs, tab];
        writeTabs(nextTabs);
        return nextTabs;
      });
      selectTab(tab.id);
      return tab;
    },
    [selectTab],
  );

  const openTab = useCallback(
    (input: CreateProjectWorkspaceTabInput): ProjectWorkspaceTab => {
      const existingTab = tabs.find((tab) => tab.projectId === input.projectId);
      if (existingTab) {
        selectTab(existingTab.id);
        return existingTab;
      }
      const retainedTab = findMostRecentlyClosedProjectTab(
        recentlyClosedTabs,
        input.projectId,
      );
      if (retainedTab === undefined) return createTab(input);
      const restoredTab: ProjectWorkspaceTab = {
        ...retainedTab,
        projectName: input.projectName,
      };

      setTabs((current) => {
        const next = [...current, restoredTab];
        writeTabs(next);
        return next;
      });
      setRecentlyClosedTabs((current) => {
        const next = current.filter((tab) => tab.id !== retainedTab.id);
        writeRecentlyClosedTabs(next);
        return next;
      });
      selectTab(restoredTab.id);
      return restoredTab;
    },
    [createTab, recentlyClosedTabs, selectTab, tabs],
  );

  const closeTab = useCallback((tabId: string) => {
    setTabs((currentTabs) => {
      const closedIndex = currentTabs.findIndex((tab) => tab.id === tabId);
      if (closedIndex === -1) return currentTabs;
      const closedTab = currentTabs[closedIndex];
      if (closedTab === undefined) return currentTabs;
      setRecentlyClosedTabs((current) => {
        const next = [
          ...current.filter((tab) => tab.id !== closedTab.id),
          closedTab,
        ].slice(-RECENTLY_CLOSED_TAB_LIMIT);
        writeRecentlyClosedTabs(next);
        return next;
      });
      const nextTabs = currentTabs.filter((tab) => tab.id !== tabId);
      writeTabs(nextTabs);
      setStoredActiveTabId((currentActiveTabId) => {
        if (currentActiveTabId !== tabId) return currentActiveTabId;
        const nextActiveTabId =
          nextTabs[closedIndex]?.id ?? nextTabs[closedIndex - 1]?.id ?? null;
        writeActiveTabId(nextActiveTabId);
        return nextActiveTabId;
      });
      return nextTabs;
    });
  }, []);

  const reorderTab = useCallback((activeTabId: string, overTabId: string) => {
    if (activeTabId === overTabId) return;
    setTabs((currentTabs) => {
      const activeIndex = currentTabs.findIndex(
        (tab) => tab.id === activeTabId,
      );
      const overIndex = currentTabs.findIndex((tab) => tab.id === overTabId);
      if (activeIndex === -1 || overIndex === -1) return currentTabs;
      const nextTabs = [...currentTabs];
      const [activeTab] = nextTabs.splice(activeIndex, 1);
      if (activeTab === undefined) return currentTabs;
      nextTabs.splice(overIndex, 0, activeTab);
      writeTabs(nextTabs);
      return nextTabs;
    });
  }, []);

  const updateTab = useCallback(
    (tabId: string, update: ProjectWorkspaceTabUpdate) => {
      setTabs((currentTabs) => {
        let didUpdate = false;
        const nextTabs = currentTabs.map((tab) => {
          if (tab.id !== tabId) return tab;
          didUpdate = true;
          return { ...tab, ...update };
        });
        if (!didUpdate) return currentTabs;
        writeTabs(nextTabs);
        return nextTabs;
      });
    },
    [],
  );

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key === PROJECT_WORKSPACE_TABS_STORAGE_KEY) {
        setTabs(parseProjectWorkspaceTabs(event.newValue));
        return;
      }
      if (event.key === RECENTLY_CLOSED_PROJECT_WORKSPACE_TABS_STORAGE_KEY) {
        setRecentlyClosedTabs(
          parseRecentlyClosedProjectWorkspaceTabs(event.newValue).tabs,
        );
      }
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  useEffect(() => {
    writeActiveTabId(activeTabId);
  }, [activeTabId]);

  const value = useMemo<ProjectWorkspaceTabsContextValue>(
    () => ({
      tabs,
      activeTabId,
      createTab,
      openTab,
      selectTab,
      reorderTab,
      closeTab,
      updateTab,
    }),
    [
      activeTabId,
      closeTab,
      createTab,
      openTab,
      reorderTab,
      selectTab,
      tabs,
      updateTab,
    ],
  );

  return (
    <ProjectWorkspaceTabsContext.Provider value={value}>
      {children}
    </ProjectWorkspaceTabsContext.Provider>
  );
}

export function useProjectWorkspaceTabs(): ProjectWorkspaceTabsContextValue {
  const value = useContext(ProjectWorkspaceTabsContext);
  if (value === null) {
    throw new Error(
      "useProjectWorkspaceTabs must be used within ProjectWorkspaceTabsProvider",
    );
  }
  return value;
}
