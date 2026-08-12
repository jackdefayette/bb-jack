import { useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { useSidebarNavigation } from "@/hooks/queries/sidebar-navigation-query";
import {
  getProjectWorkspaceRoutePath,
  getRootComposeRoutePath,
} from "@/lib/route-paths";
import { useProjectWorkspaceTabs } from "./ProjectWorkspaceTabsProvider";

export interface ProjectWorkspaceTabBarProps {
  activeTabId: string;
}

export function ProjectWorkspaceTabBar({
  activeTabId,
}: ProjectWorkspaceTabBarProps) {
  const navigate = useNavigate();
  const { data } = useSidebarNavigation();
  const { tabs, selectTab, closeTab } = useProjectWorkspaceTabs();
  const activeTabRef = useRef<HTMLButtonElement | null>(null);
  const knownProjectIds = useMemo(
    () => new Set(data?.projects.map((project) => project.id) ?? []),
    [data?.projects],
  );
  const projectTabCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const tab of tabs) {
      counts.set(tab.projectId, (counts.get(tab.projectId) ?? 0) + 1);
    }
    return counts;
  }, [tabs]);

  useEffect(() => {
    selectTab(activeTabId);
  }, [activeTabId, selectTab]);

  useEffect(() => {
    activeTabRef.current?.scrollIntoView?.({
      behavior: "smooth",
      block: "nearest",
      inline: "nearest",
    });
  }, [activeTabId]);

  const activateTab = (tabId: string, projectId: string) => {
    selectTab(tabId);
    void navigate(
      getProjectWorkspaceRoutePath({ projectId, workspaceTabId: tabId }),
    );
  };

  const handleClose = (tabId: string) => {
    const closedIndex = tabs.findIndex((tab) => tab.id === tabId);
    if (closedIndex === -1) return;
    const remainingTabs = tabs.filter((tab) => tab.id !== tabId);
    const nextTab =
      remainingTabs[closedIndex] ?? remainingTabs[closedIndex - 1] ?? null;
    closeTab(tabId);
    if (tabId !== activeTabId) return;
    if (nextTab === null) {
      void navigate(getRootComposeRoutePath());
      return;
    }
    void navigate(
      getProjectWorkspaceRoutePath({
        projectId: nextTab.projectId,
        workspaceTabId: nextTab.id,
      }),
    );
  };

  return (
    <div className="relative z-20 shrink-0 border-b border-border bg-canvas px-2 pt-1.5">
      <div
        role="tablist"
        aria-label="Project workspaces"
        className="no-scrollbar flex min-w-0 items-end gap-1 overflow-x-auto"
      >
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          const isStale =
            data !== undefined && !knownProjectIds.has(tab.projectId);
          const duplicateCount = projectTabCounts.get(tab.projectId) ?? 1;
          const projectOrdinal =
            duplicateCount > 1
              ? tabs
                  .filter((candidate) => candidate.projectId === tab.projectId)
                  .findIndex((candidate) => candidate.id === tab.id) + 1
              : null;
          return (
            <div
              key={tab.id}
              className={cn(
                "group relative flex h-8 max-w-56 shrink-0 items-center rounded-t-lg border border-b-0 transition-colors",
                isActive
                  ? "border-border bg-background text-foreground shadow-[0_-1px_0_color-mix(in_oklch,var(--ink)_5%,transparent)]"
                  : "border-transparent bg-canvas text-muted-foreground hover:border-border/70 hover:bg-muted/45 hover:text-foreground",
                isStale && "border-dashed text-muted-foreground",
              )}
            >
              <button
                ref={isActive ? activeTabRef : undefined}
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-label={
                  isStale
                    ? `${tab.projectName}, project unavailable`
                    : tab.projectName
                }
                className="flex min-w-0 flex-1 items-center gap-1.5 py-1 pl-2.5 pr-1 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                onClick={() => activateTab(tab.id, tab.projectId)}
              >
                <Icon
                  name={isStale ? "FolderMinus" : "Folder"}
                  className="size-3.5 shrink-0"
                  aria-hidden="true"
                />
                <span
                  className="min-w-0 truncate"
                  title={
                    isStale
                      ? `${tab.projectName} — project is no longer available`
                      : tab.projectName
                  }
                >
                  {tab.projectName}
                </span>
                {projectOrdinal !== null ? (
                  <span className="shrink-0 font-mono text-xs text-subtle-foreground">
                    {projectOrdinal}
                  </span>
                ) : null}
              </button>
              <button
                type="button"
                aria-label={`Close ${tab.projectName} workspace`}
                className="mr-1 inline-flex size-5 shrink-0 items-center justify-center rounded text-subtle-foreground opacity-60 outline-none transition hover:bg-muted hover:text-foreground hover:opacity-100 focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100"
                onClick={(event) => {
                  event.stopPropagation();
                  handleClose(tab.id);
                }}
              >
                <Icon name="X" className="size-3" aria-hidden="true" />
              </button>
              {isActive ? (
                <span
                  aria-hidden="true"
                  className="absolute -bottom-px left-0 right-0 h-px bg-background"
                />
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
