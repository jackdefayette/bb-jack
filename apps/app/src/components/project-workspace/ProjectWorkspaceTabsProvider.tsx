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

export interface ProjectWorkspaceTab {
  id: string;
  projectId: string;
  projectName: string;
  primaryThreadId: string | null;
  reviewThreadId: string | null;
  focusMode: ProjectWorkspaceFocusMode;
  toolsView: ProjectWorkspaceToolsView;
  browserTab: BrowserFixedPanelTab | null;
}

export interface CreateProjectWorkspaceTabInput {
  projectId: string;
  projectName: string;
  primaryThreadId?: string | null;
  reviewThreadId?: string | null;
  focusMode?: ProjectWorkspaceFocusMode;
  toolsView?: ProjectWorkspaceToolsView;
  browserTab?: BrowserFixedPanelTab | null;
}

export type ProjectWorkspaceTabUpdate = Partial<
  Omit<ProjectWorkspaceTab, "id" | "projectId">
>;

interface ProjectWorkspaceTabsContextValue {
  tabs: readonly ProjectWorkspaceTab[];
  activeTabId: string | null;
  createTab: (input: CreateProjectWorkspaceTabInput) => ProjectWorkspaceTab;
  selectTab: (tabId: string) => void;
  closeTab: (tabId: string) => void;
  updateTab: (tabId: string, update: ProjectWorkspaceTabUpdate) => void;
}

export const PROJECT_WORKSPACE_TABS_STORAGE_KEY =
  "bb.project-workspace-tabs.v1";
export const ACTIVE_PROJECT_WORKSPACE_TAB_STORAGE_KEY =
  "bb.active-project-workspace-tab.v1";

const ProjectWorkspaceTabsContext =
  createContext<ProjectWorkspaceTabsContextValue | null>(null);

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
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

export function ProjectWorkspaceTabsProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [tabs, setTabs] = useState<ProjectWorkspaceTab[]>(readTabs);
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

  const closeTab = useCallback((tabId: string) => {
    setTabs((currentTabs) => {
      const closedIndex = currentTabs.findIndex((tab) => tab.id === tabId);
      if (closedIndex === -1) return currentTabs;
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
      if (event.key !== PROJECT_WORKSPACE_TABS_STORAGE_KEY) return;
      setTabs(parseProjectWorkspaceTabs(event.newValue));
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  useEffect(() => {
    writeActiveTabId(activeTabId);
  }, [activeTabId]);

  const value = useMemo<ProjectWorkspaceTabsContextValue>(
    () => ({ tabs, activeTabId, createTab, selectTab, closeTab, updateTab }),
    [activeTabId, closeTab, createTab, selectTab, tabs, updateTab],
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
