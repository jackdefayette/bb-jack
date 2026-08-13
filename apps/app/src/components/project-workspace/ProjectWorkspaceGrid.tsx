import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { ThreadListEntry } from "@bb/domain";
import { useSidebarNavigation } from "@/hooks/queries/sidebar-navigation-query";
import { cn } from "@bb/shared-ui/lib/utils";
import { dispatchBrowserViewBoundsSync } from "@/lib/browser-view-bounds-sync";
import { IframeDragGuardOverlay } from "@/lib/iframe-drag-guard";
import { applyResizeCursor, clearResizeCursor } from "@/lib/resizeCursor";
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
import type { ProjectWorkspaceAgentRole } from "./ProjectWorkspaceAgentPane";

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
const MIN_WORKSPACE_PANE_PERCENT = 20;
const MAX_WORKSPACE_PANE_PERCENT = 80;
const KEYBOARD_RESIZE_STEP_PERCENT = 3;

interface ProjectWorkspaceLayout {
  rowSplitPercent: number;
  topColumnSplitPercent: number;
  bottomColumnSplitPercent: number;
}

type WorkspaceResizeHandleId = "row" | "top-column" | "bottom-column";

interface WorkspaceResizeSession {
  handle: WorkspaceResizeHandleId;
  initialLayout: ProjectWorkspaceLayout;
  rect: DOMRect;
}

function clampWorkspacePanePercent(value: number): number {
  return Math.min(
    MAX_WORKSPACE_PANE_PERCENT,
    Math.max(MIN_WORKSPACE_PANE_PERCENT, value),
  );
}

function layoutFromTab(tab: ProjectWorkspaceTab): ProjectWorkspaceLayout {
  return {
    rowSplitPercent: tab.rowSplitPercent,
    topColumnSplitPercent: tab.topColumnSplitPercent,
    bottomColumnSplitPercent: tab.bottomColumnSplitPercent,
  };
}

function layoutUpdate(
  layout: ProjectWorkspaceLayout,
): ProjectWorkspaceTabUpdate {
  return {
    rowSplitPercent: layout.rowSplitPercent,
    topColumnSplitPercent: layout.topColumnSplitPercent,
    bottomColumnSplitPercent: layout.bottomColumnSplitPercent,
  };
}

function workspacePaneStyles(
  layout: ProjectWorkspaceLayout,
  focusMode: ProjectWorkspaceFocusMode,
): Record<"primary" | "review" | "browser" | "tools", CSSProperties> {
  const topHeight = `calc(${layout.rowSplitPercent}% - 0.5px)`;
  const bottomTop = `calc(${layout.rowSplitPercent}% + 0.5px)`;
  const topLeftWidth = `calc(${layout.topColumnSplitPercent}% - 0.5px)`;
  const topRightLeft = `calc(${layout.topColumnSplitPercent}% + 0.5px)`;
  const bottomLeftWidth = `calc(${layout.bottomColumnSplitPercent}% - 0.5px)`;
  const bottomRightLeft = `calc(${layout.bottomColumnSplitPercent}% + 0.5px)`;
  const rightColumnLeft =
    focusMode === "browser" ? bottomRightLeft : topRightLeft;

  return {
    primary: {
      left: 0,
      top: 0,
      width: topLeftWidth,
      height: focusMode === "primary" ? "100%" : topHeight,
    },
    review: {
      left: rightColumnLeft,
      right: 0,
      top: 0,
      height: topHeight,
    },
    browser: {
      left: 0,
      top: focusMode === "browser" ? 0 : bottomTop,
      bottom: 0,
      width: bottomLeftWidth,
    },
    tools: {
      left: rightColumnLeft,
      right: 0,
      top: bottomTop,
      bottom: 0,
    },
  };
}

interface WorkspaceResizeHandleProps {
  active: boolean;
  label: string;
  onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  orientation: "horizontal" | "vertical";
  style: CSSProperties;
  value: number;
}

function WorkspaceResizeHandle({
  active,
  label,
  onKeyDown,
  onPointerDown,
  orientation,
  style,
  value,
}: WorkspaceResizeHandleProps) {
  const isVertical = orientation === "vertical";
  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation={orientation}
      aria-valuemin={MIN_WORKSPACE_PANE_PERCENT}
      aria-valuemax={MAX_WORKSPACE_PANE_PERCENT}
      aria-valuenow={Math.round(value)}
      className={cn(
        "group absolute z-30 outline-none",
        isVertical ? "w-2 cursor-col-resize" : "h-2 cursor-row-resize",
      )}
      style={style}
      data-workspace-resize-handle={label}
      data-resizing={active || undefined}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
    >
      <span
        aria-hidden
        className={cn(
          "absolute bg-workspace-border transition-colors group-hover:bg-ring group-focus-visible:bg-ring group-data-[resizing]:bg-ring",
          isVertical
            ? "inset-y-0 left-1/2 w-px -translate-x-1/2"
            : "inset-x-0 top-1/2 h-px -translate-y-1/2",
        )}
      />
    </div>
  );
}

export function buildWorkspaceEnvironments(
  builderEnvironmentId: string | null,
  reviewerEnvironmentId: string | null,
): readonly { id: string; label: string }[] {
  if (
    builderEnvironmentId !== null &&
    builderEnvironmentId === reviewerEnvironmentId
  ) {
    return [{ id: builderEnvironmentId, label: "Build & Agent 2 environment" }];
  }
  return [
    ...(builderEnvironmentId
      ? [{ id: builderEnvironmentId, label: "Build environment" }]
      : []),
    ...(reviewerEnvironmentId
      ? [{ id: reviewerEnvironmentId, label: "Agent 2 environment" }]
      : []),
  ];
}

function resolveAgentThreads(
  threads: readonly ThreadListEntry[],
  tab: ProjectWorkspaceTab,
): ResolvedAgentThreads {
  const byId = new Map(threads.map((thread) => [thread.id, thread]));
  const primary = tab.primaryThreadId
    ? (byId.get(tab.primaryThreadId) ?? null)
    : null;
  const review =
    tab.reviewThreadId && tab.reviewThreadId !== primary?.id
      ? (byId.get(tab.reviewThreadId) ?? null)
      : null;
  return { primary, review };
}

function hiddenPaneProps(hidden: boolean) {
  return {
    "aria-hidden": hidden || undefined,
    inert: hidden ? true : undefined,
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
  const [activeAgent, setActiveAgent] =
    useState<ProjectWorkspaceAgentRole>("builder");
  const workspaceRef = useRef<HTMLElement | null>(null);
  const [layout, setLayout] = useState<ProjectWorkspaceLayout>(() =>
    layoutFromTab(tab),
  );
  const layoutRef = useRef(layout);
  const resizeSessionRef = useRef<WorkspaceResizeSession | null>(null);
  const [resizingHandle, setResizingHandle] =
    useState<WorkspaceResizeHandleId | null>(null);

  const applyLayout = useCallback((nextLayout: ProjectWorkspaceLayout) => {
    layoutRef.current = nextLayout;
    setLayout(nextLayout);
    dispatchBrowserViewBoundsSync();
  }, []);

  useEffect(() => {
    if (resizingHandle !== null) return;
    const nextLayout = {
      rowSplitPercent: tab.rowSplitPercent,
      topColumnSplitPercent: tab.topColumnSplitPercent,
      bottomColumnSplitPercent: tab.bottomColumnSplitPercent,
    };
    layoutRef.current = nextLayout;
    // Workspace tab state can change through another desktop window's storage
    // event. Mirror that external state without remounting the four live panes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLayout(nextLayout);
  }, [
    resizingHandle,
    tab.bottomColumnSplitPercent,
    tab.rowSplitPercent,
    tab.topColumnSplitPercent,
  ]);

  const beginResize = useCallback(
    (
      handle: WorkspaceResizeHandleId,
      event: ReactPointerEvent<HTMLDivElement>,
    ) => {
      if (event.button !== 0) return;
      const rect = workspaceRef.current?.getBoundingClientRect();
      if (rect === undefined || rect.width <= 0 || rect.height <= 0) return;
      event.preventDefault();
      resizeSessionRef.current = {
        handle,
        initialLayout: layoutRef.current,
        rect,
      };
      setResizingHandle(handle);
    },
    [],
  );

  useEffect(() => {
    if (resizingHandle === null) return;
    const session = resizeSessionRef.current;
    if (session === null) return;
    const cursorOrientation =
      session.handle === "row" ? "vertical" : "horizontal";
    applyResizeCursor(cursorOrientation);
    document.body.style.userSelect = "none";

    const handlePointerMove = (event: PointerEvent) => {
      const percent =
        session.handle === "row"
          ? ((event.clientY - session.rect.top) / session.rect.height) * 100
          : ((event.clientX - session.rect.left) / session.rect.width) * 100;
      const value = clampWorkspacePanePercent(percent);
      applyLayout({
        ...layoutRef.current,
        ...(session.handle === "row"
          ? { rowSplitPercent: value }
          : session.handle === "top-column"
            ? { topColumnSplitPercent: value }
            : { bottomColumnSplitPercent: value }),
      });
    };
    const finishResize = (commit: boolean) => {
      if (commit) {
        updateTab(tab.id, layoutUpdate(layoutRef.current));
      } else {
        applyLayout(session.initialLayout);
      }
      resizeSessionRef.current = null;
      setResizingHandle(null);
    };
    const handlePointerUp = () => finishResize(true);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") finishResize(false);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });
    window.addEventListener("blur", handlePointerUp, { once: true });
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("blur", handlePointerUp);
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.userSelect = "";
      clearResizeCursor();
    };
  }, [applyLayout, resizingHandle, tab.id, updateTab]);

  const resizeWithKeyboard = useCallback(
    (
      handle: WorkspaceResizeHandleId,
      event: ReactKeyboardEvent<HTMLDivElement>,
    ) => {
      const decrease = event.key === "ArrowLeft" || event.key === "ArrowUp";
      const increase = event.key === "ArrowRight" || event.key === "ArrowDown";
      if (!decrease && !increase) return;
      if (
        (handle === "row" &&
          event.key !== "ArrowUp" &&
          event.key !== "ArrowDown") ||
        (handle !== "row" &&
          event.key !== "ArrowLeft" &&
          event.key !== "ArrowRight")
      ) {
        return;
      }
      event.preventDefault();
      const delta =
        (increase ? 1 : -1) *
        (event.shiftKey
          ? KEYBOARD_RESIZE_STEP_PERCENT * 3
          : KEYBOARD_RESIZE_STEP_PERCENT);
      const current = layoutRef.current;
      const next = {
        ...current,
        ...(handle === "row"
          ? {
              rowSplitPercent: clampWorkspacePanePercent(
                current.rowSplitPercent + delta,
              ),
            }
          : handle === "top-column"
            ? {
                topColumnSplitPercent: clampWorkspacePanePercent(
                  current.topColumnSplitPercent + delta,
                ),
              }
            : {
                bottomColumnSplitPercent: clampWorkspacePanePercent(
                  current.bottomColumnSplitPercent + delta,
                ),
              }),
      };
      applyLayout(next);
      updateTab(tab.id, layoutUpdate(next));
    },
    [applyLayout, tab.id, updateTab],
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
  const activeEnvironmentId =
    activeAgent === "builder"
      ? (resolved.primary?.environmentId ?? null)
      : (resolved.review?.environmentId ?? null);
  useEffect(() => {
    if (
      tab.inspectorEnvironmentPinned ||
      tab.inspectorEnvironmentId === activeEnvironmentId
    )
      return;
    updateTab(tab.id, { inspectorEnvironmentId: activeEnvironmentId });
  }, [
    activeEnvironmentId,
    tab.id,
    tab.inspectorEnvironmentId,
    tab.inspectorEnvironmentPinned,
    updateTab,
  ]);
  const backgroundAgentState = resolved.primary?.hasPendingInteraction
    ? "attention"
    : resolved.primary?.status === "active" ||
        resolved.primary?.status === "starting"
      ? "running"
      : null;
  const workspaceEnvironments = useMemo(
    () =>
      buildWorkspaceEnvironments(
        resolved.primary?.environmentId ?? null,
        resolved.review?.environmentId ?? null,
      ),
    [resolved.primary?.environmentId, resolved.review?.environmentId],
  );
  const paneStyles = workspacePaneStyles(layout, tab.focusMode);
  const focusedColumnSplit =
    tab.focusMode === "browser"
      ? layout.bottomColumnSplitPercent
      : layout.topColumnSplitPercent;
  const rowHandleLeft =
    tab.focusMode === "grid" ? 0 : `calc(${focusedColumnSplit}% + 0.5px)`;

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
          <p className="text-sm font-medium text-foreground">
            Project unavailable
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            This workspace tab will stay open in case the project reconnects.
          </p>
        </div>
      </div>
    );
  }

  return (
    <main
      ref={workspaceRef}
      className="bb-project-workspace-surface relative min-h-0 flex-1 overflow-hidden bg-workspace-border text-workspace-foreground"
      aria-label={`${tab.projectName} project workspace`}
      data-focus-mode={tab.focusMode}
      data-row-split-percent={layout.rowSplitPercent}
      data-top-column-split-percent={layout.topColumnSplitPercent}
      data-bottom-column-split-percent={layout.bottomColumnSplitPercent}
    >
      <div
        data-workspace-quadrant="primary"
        className="absolute min-h-0 min-w-0"
        style={{
          ...paneStyles.primary,
          ...(primaryHidden ? { contentVisibility: "hidden" as const } : {}),
        }}
        {...hiddenPaneProps(primaryHidden)}
      >
        <ProjectWorkspaceAgentPane
          label="Build"
          projectId={tab.projectId}
          projectName={tab.projectName}
          role="builder"
          taskKey={tab.primaryTaskKey}
          environmentId={resolved.primary?.environmentId ?? null}
          threadId={resolved.primary?.id ?? null}
          workspaceTabId={tab.id}
          workspaceEnvironmentPeer={
            resolved.review?.environmentId
              ? {
                  environmentId: resolved.review.environmentId,
                  label: "Agent 2",
                  taskKey: tab.reviewTaskKey,
                }
              : null
          }
          onAgentStarted={(result) =>
            updateTab(tab.id, {
              primaryThreadId: result.threadId,
              primaryTaskKey: result.taskKey,
              inspectorEnvironmentId: tab.inspectorEnvironmentPinned
                ? tab.inspectorEnvironmentId
                : result.environmentId,
            })
          }
          isFocused={isActive && activeAgent === "builder" && !primaryHidden}
          isExpanded={tab.focusMode === "primary"}
          isTopRow
          onActivate={() => setActiveAgent("builder")}
          onNavigate={handlePrimaryNavigate}
          onToggleFocus={togglePrimaryFocus}
        />
      </div>

      <div
        data-workspace-quadrant="review"
        className="absolute min-h-0 min-w-0"
        style={paneStyles.review}
      >
        <ProjectWorkspaceAgentPane
          label="Agent 2"
          projectId={tab.projectId}
          projectName={tab.projectName}
          role="reviewer"
          taskKey={tab.reviewTaskKey}
          environmentId={resolved.review?.environmentId ?? null}
          threadId={resolved.review?.id ?? null}
          workspaceTabId={tab.id}
          workspaceEnvironmentPeer={
            resolved.primary?.environmentId
              ? {
                  environmentId: resolved.primary.environmentId,
                  label: "Build",
                  taskKey: tab.primaryTaskKey,
                }
              : null
          }
          onAgentStarted={(result) =>
            updateTab(tab.id, {
              reviewThreadId: result.threadId,
              reviewTaskKey: result.taskKey,
              inspectorEnvironmentId: tab.inspectorEnvironmentPinned
                ? tab.inspectorEnvironmentId
                : result.environmentId,
            })
          }
          isFocused={isActive && activeAgent === "reviewer"}
          isTopRow
          onActivate={() => setActiveAgent("reviewer")}
          onNavigate={handleReviewNavigate}
        />
      </div>

      <div
        data-workspace-quadrant="browser"
        className="absolute min-h-0 min-w-0"
        style={{
          ...paneStyles.browser,
          ...(browserHidden ? { contentVisibility: "hidden" as const } : {}),
        }}
        {...hiddenPaneProps(browserHidden)}
      >
        <ProjectWorkspaceBrowserPane
          backgroundAgentState={backgroundAgentState}
          tab={tab}
          environmentId={tab.inspectorEnvironmentId}
          environmentOptions={workspaceEnvironments}
          projectId={tab.projectId}
          isFocused={tab.focusMode === "browser"}
          canShowNativeBrowserView={
            isActive && !browserHidden && document.visibilityState !== "hidden"
          }
          onToggleFocus={toggleBrowserFocus}
          updateTab={updateTab}
        />
      </div>

      <div
        data-workspace-quadrant="tools"
        className="absolute min-h-0 min-w-0"
        style={paneStyles.tools}
      >
        <ProjectWorkspaceToolsPane
          projectId={tab.projectId}
          workspaceTabId={tab.id}
          environments={workspaceEnvironments}
          toolsView={tab.toolsView}
          onToolsViewChange={handleToolsViewChange}
        />
      </div>

      <WorkspaceResizeHandle
        active={resizingHandle === "row"}
        label="Resize chat and tools rows"
        orientation="horizontal"
        value={layout.rowSplitPercent}
        style={{
          left: rowHandleLeft,
          right: 0,
          top: `calc(${layout.rowSplitPercent}% - 4px)`,
        }}
        onPointerDown={(event) => beginResize("row", event)}
        onKeyDown={(event) => resizeWithKeyboard("row", event)}
      />
      {tab.focusMode === "grid" ? (
        <>
          <WorkspaceResizeHandle
            active={resizingHandle === "top-column"}
            label="Resize top chat panes"
            orientation="vertical"
            value={layout.topColumnSplitPercent}
            style={{
              left: `calc(${layout.topColumnSplitPercent}% - 4px)`,
              top: 0,
              height: `calc(${layout.rowSplitPercent}% - 0.5px)`,
            }}
            onPointerDown={(event) => beginResize("top-column", event)}
            onKeyDown={(event) => resizeWithKeyboard("top-column", event)}
          />
          <WorkspaceResizeHandle
            active={resizingHandle === "bottom-column"}
            label="Resize inspector and project tools"
            orientation="vertical"
            value={layout.bottomColumnSplitPercent}
            style={{
              bottom: 0,
              left: `calc(${layout.bottomColumnSplitPercent}% - 4px)`,
              top: `calc(${layout.rowSplitPercent}% + 0.5px)`,
            }}
            onPointerDown={(event) => beginResize("bottom-column", event)}
            onKeyDown={(event) => resizeWithKeyboard("bottom-column", event)}
          />
        </>
      ) : (
        <WorkspaceResizeHandle
          active={
            resizingHandle ===
            (tab.focusMode === "browser" ? "bottom-column" : "top-column")
          }
          label="Resize focused pane and project tools"
          orientation="vertical"
          value={focusedColumnSplit}
          style={{
            bottom: 0,
            left: `calc(${focusedColumnSplit}% - 4px)`,
            top: 0,
          }}
          onPointerDown={(event) =>
            beginResize(
              tab.focusMode === "browser" ? "bottom-column" : "top-column",
              event,
            )
          }
          onKeyDown={(event) =>
            resizeWithKeyboard(
              tab.focusMode === "browser" ? "bottom-column" : "top-column",
              event,
            )
          }
        />
      )}
      <IframeDragGuardOverlay active={resizingHandle !== null} />
    </main>
  );
}
