import { useCallback, useEffect, useMemo, useState } from "react";
import type { ThreadListEntry } from "@bb/domain";
import { useSidebarNavigation } from "@/hooks/queries/sidebar-navigation-query";
import { cn } from "@bb/shared-ui/lib/utils";
import type { ThreadRoutePathArgs } from "@/lib/route-paths";
import type {
  ProjectWorkspaceFocusMode,
  ProjectWorkspaceTab,
  ProjectWorkspaceTabUpdate,
  ProjectWorkspaceToolsView,
} from "./ProjectWorkspaceTabsProvider";
import { ProjectWorkspaceAgentPane } from "./ProjectWorkspaceAgentPane";
import { ProjectWorkspaceBrowserPane } from "./ProjectWorkspaceBrowserPane";
import { ProjectWorkspaceToolsPane } from "./ProjectWorkspaceToolsPane";

interface ProjectWorkspaceGridProps {
  isActive: boolean;
  tab: ProjectWorkspaceTab;
  updateTab: (id: string, patch: ProjectWorkspaceTabUpdate) => void;
}

interface ResolvedAgentThreads {
  primary: ThreadListEntry | null;
  review: ThreadListEntry | null;
}

const EMPTY_PROJECT_THREADS: readonly ThreadListEntry[] = [];

function resolveAgentThreads(
  threads: readonly ThreadListEntry[],
  tab: ProjectWorkspaceTab,
): ResolvedAgentThreads {
  const byId = new Map(threads.map((thread) => [thread.id, thread]));
  const primary =
    (tab.primaryThreadId ? byId.get(tab.primaryThreadId) : undefined) ??
    threads[0] ??
    null;
  const review =
    (tab.reviewThreadId && tab.reviewThreadId !== primary?.id
      ? byId.get(tab.reviewThreadId)
      : undefined) ??
    threads.find((thread) => thread.id !== primary?.id) ??
    null;
  return { primary, review };
}

function hiddenPaneProps(hidden: boolean) {
  return {
    "aria-hidden": hidden || undefined,
    inert: hidden ? true : undefined,
    style: hidden ? { contentVisibility: "hidden" as const } : undefined,
  };
}

/** Fixed two-by-two project cockpit. Left focus never unmounts any quadrant. */
export function ProjectWorkspaceGrid({
  isActive,
  tab,
  updateTab,
}: ProjectWorkspaceGridProps) {
  const sidebarNavigation = useSidebarNavigation();
  const project = sidebarNavigation.data?.projects.find(
    (candidate) => candidate.id === tab.projectId,
  );
  const threads = project?.threads ?? EMPTY_PROJECT_THREADS;
  const resolved = useMemo(
    () => resolveAgentThreads(threads, tab),
    [tab, threads],
  );
  const [activeAgent, setActiveAgent] = useState<"primary" | "review">(
    "primary",
  );

  useEffect(() => {
    const primaryThreadId = resolved.primary?.id ?? null;
    const reviewThreadId = resolved.review?.id ?? null;
    if (
      tab.primaryThreadId === primaryThreadId &&
      tab.reviewThreadId === reviewThreadId
    ) {
      return;
    }
    updateTab(tab.id, { primaryThreadId, reviewThreadId });
  }, [resolved.primary?.id, resolved.review?.id, tab, updateTab]);

  const setFocusMode = useCallback(
    (focusMode: ProjectWorkspaceFocusMode) => {
      updateTab(tab.id, { focusMode });
    },
    [tab.id, updateTab],
  );
  const togglePrimaryFocus = useCallback(
    () => setFocusMode(tab.focusMode === "primary" ? "grid" : "primary"),
    [setFocusMode, tab.focusMode],
  );
  const toggleBrowserFocus = useCallback(
    () => setFocusMode(tab.focusMode === "browser" ? "grid" : "browser"),
    [setFocusMode, tab.focusMode],
  );
  const handlePrimaryNavigate = useCallback(
    (thread: ThreadRoutePathArgs) => {
      if (thread.projectId !== tab.projectId) return;
      updateTab(tab.id, { primaryThreadId: thread.threadId });
    },
    [tab.id, tab.projectId, updateTab],
  );
  const handleReviewNavigate = useCallback(
    (thread: ThreadRoutePathArgs) => {
      if (thread.projectId !== tab.projectId) return;
      updateTab(tab.id, { reviewThreadId: thread.threadId });
    },
    [tab.id, tab.projectId, updateTab],
  );
  const handleToolsViewChange = useCallback(
    (toolsView: ProjectWorkspaceToolsView) => {
      updateTab(tab.id, { toolsView });
    },
    [tab.id, updateTab],
  );

  const primaryHidden = tab.focusMode === "browser";
  const browserHidden = tab.focusMode === "primary";
  const environmentId =
    resolved.primary?.environmentId ?? resolved.review?.environmentId ?? null;
  const backgroundAgentState = resolved.primary?.hasPendingInteraction
    ? "attention"
    : resolved.primary?.status === "active" ||
        resolved.primary?.status === "starting"
      ? "running"
      : null;

  if (sidebarNavigation.isLoading) {
    return (
      <div className="grid min-h-0 flex-1 place-items-center text-sm text-muted-foreground">
        Loading project workspace…
      </div>
    );
  }

  if (!project) {
    return (
      <div className="grid min-h-0 flex-1 place-items-center px-8 text-center">
        <div>
          <p className="text-sm font-medium text-foreground">Project unavailable</p>
          <p className="mt-1 text-xs text-muted-foreground">
            This workspace tab will stay open in case the project reconnects.
          </p>
        </div>
      </div>
    );
  }

  return (
    <main
      className="grid min-h-0 flex-1 grid-cols-2 grid-rows-2 overflow-hidden bg-border/70 gap-px"
      aria-label={`${tab.projectName} project workspace`}
      data-focus-mode={tab.focusMode}
    >
      <div
        className={cn(
          "col-start-1 row-start-1 min-h-0 min-w-0",
          tab.focusMode === "primary" && "row-span-2",
        )}
        {...hiddenPaneProps(primaryHidden)}
      >
        <ProjectWorkspaceAgentPane
          label="Primary Agent"
          projectId={tab.projectId}
          threadId={resolved.primary?.id ?? null}
          isFocused={isActive && activeAgent === "primary" && !primaryHidden}
          isExpanded={tab.focusMode === "primary"}
          isTopRow
          onActivate={() => setActiveAgent("primary")}
          onNavigate={handlePrimaryNavigate}
          onToggleFocus={togglePrimaryFocus}
        />
      </div>

      <div className="col-start-2 row-start-1 min-h-0 min-w-0">
        <ProjectWorkspaceAgentPane
          label="Review Agent"
          projectId={tab.projectId}
          threadId={resolved.review?.id ?? null}
          isFocused={isActive && activeAgent === "review"}
          isTopRow
          onActivate={() => setActiveAgent("review")}
          onNavigate={handleReviewNavigate}
        />
      </div>

      <div
        className={cn(
          "col-start-1 row-start-2 min-h-0 min-w-0",
          tab.focusMode === "browser" && "row-start-1 row-span-2",
        )}
        {...hiddenPaneProps(browserHidden)}
      >
        <ProjectWorkspaceBrowserPane
          backgroundAgentState={backgroundAgentState}
          tab={tab}
          environmentId={environmentId}
          isFocused={tab.focusMode === "browser"}
          canShowNativeBrowserView={
            isActive && !browserHidden && document.visibilityState !== "hidden"
          }
          onToggleFocus={toggleBrowserFocus}
          updateTab={updateTab}
        />
      </div>

      <div className="col-start-2 row-start-2 min-h-0 min-w-0">
        <ProjectWorkspaceToolsPane
          projectId={tab.projectId}
          toolsView={tab.toolsView}
          onToolsViewChange={handleToolsViewChange}
        />
      </div>
    </main>
  );
}
