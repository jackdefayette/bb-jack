import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useNavigate } from "react-router-dom";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type Modifier,
} from "@dnd-kit/core";
import {
  horizontalListSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { useDragClickSuppression } from "@/components/ui/use-drag-click-suppression";
import { isEditableKeyboardTarget } from "@/lib/app-keybindings";
import { useSidebarNavigation } from "@/hooks/queries/sidebar-navigation-query";
import {
  getProjectWorkspaceRoutePath,
  getRootComposeRoutePath,
} from "@/lib/route-paths";
import {
  CHROME_ROW_HEIGHT_CLASS,
  getBbDesktopInfo,
  MACOS_WINDOW_DRAG_CLASS,
  MACOS_WINDOW_NO_DRAG_CLASS,
  shouldUseMacosDesktopChrome,
} from "@/lib/bb-desktop";
import {
  useProjectWorkspaceTabs,
  type ProjectWorkspaceTab,
} from "./ProjectWorkspaceTabsProvider";

export interface ProjectWorkspaceTabBarProps {
  activeTabId: string;
}

const restrictTabDragToHorizontalAxis: Modifier = ({ transform }) => ({
  ...transform,
  y: 0,
});

const TAB_DRAG_MODIFIERS = [restrictTabDragToHorizontalAxis];

interface SortableProjectWorkspaceTabProps {
  activateTab: (tabId: string, projectId: string) => void;
  handleClose: (tabId: string) => void;
  isActive: boolean;
  isStale: boolean;
  onKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>) => void;
  projectOrdinal: number | null;
  tab: ProjectWorkspaceTab;
}

function SortableProjectWorkspaceTab({
  activateTab,
  handleClose,
  isActive,
  isStale,
  onKeyDown,
  projectOrdinal,
  tab,
}: SortableProjectWorkspaceTabProps) {
  const {
    attributes,
    isDragging,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id: tab.id });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 30 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-workspace-tab-id={tab.id}
      className={cn(
        MACOS_WINDOW_NO_DRAG_CLASS,
        "group relative flex h-9 max-w-56 shrink-0 items-center rounded-t-lg border border-b-0 transition-colors",
        isActive
          ? "border-border bg-canvas text-foreground shadow-[0_-1px_0_color-mix(in_oklch,var(--ink)_5%,transparent)]"
          : "border-transparent bg-transparent text-muted-foreground hover:border-border/70 hover:bg-muted/45 hover:text-foreground",
        isStale && "border-dashed text-muted-foreground",
        isDragging && "opacity-70 shadow-lg",
      )}
    >
      <button
        {...attributes}
        {...listeners}
        type="button"
        role="tab"
        aria-selected={isActive}
        aria-label={
          isStale ? `${tab.projectName}, project unavailable` : tab.projectName
        }
        aria-keyshortcuts="Control+Tab Control+Shift+Tab Shift+Tab"
        data-project-workspace-tab={tab.id}
        tabIndex={isActive ? 0 : -1}
        className="flex min-w-0 flex-1 touch-none items-center gap-1.5 py-1 pl-2.5 pr-1 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        onClick={() => activateTab(tab.id, tab.projectId)}
        onKeyDown={(event) => {
          listeners?.onKeyDown?.(event);
          if (!event.defaultPrevented) onKeyDown(event);
        }}
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
              : `${tab.projectName} — drag to reorder`
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
          className="absolute -bottom-px left-0 right-0 h-px bg-canvas"
        />
      ) : null}
    </div>
  );
}

export function ProjectWorkspaceTabBar({
  activeTabId,
}: ProjectWorkspaceTabBarProps) {
  const navigate = useNavigate();
  const [desktopInfo] = useState(getBbDesktopInfo);
  const usesDesktopChrome = shouldUseMacosDesktopChrome(desktopInfo);
  const { data } = useSidebarNavigation();
  const { tabs, selectTab, reorderTab, closeTab } = useProjectWorkspaceTabs();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const { beginDragClickSuppression, clearDragClickSuppressionSoon } =
    useDragClickSuppression();
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
    const activeTab = Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        "[data-project-workspace-tab]",
      ),
    ).find((button) => button.dataset.projectWorkspaceTab === activeTabId);
    activeTab?.scrollIntoView?.({
      behavior: "smooth",
      block: "nearest",
      inline: "nearest",
    });
  }, [activeTabId]);

  const activateTab = useCallback(
    (tabId: string, projectId: string) => {
      selectTab(tabId);
      void navigate(
        getProjectWorkspaceRoutePath({ projectId, workspaceTabId: tabId }),
      );
    },
    [navigate, selectTab],
  );

  const cycleTab = useCallback(
    (direction: -1 | 1, focusTab: boolean) => {
      if (tabs.length < 2) return;
      const activeIndex = Math.max(
        0,
        tabs.findIndex((tab) => tab.id === activeTabId),
      );
      const nextTab =
        tabs[(activeIndex + direction + tabs.length) % tabs.length];
      if (nextTab === undefined) return;
      activateTab(nextTab.id, nextTab.projectId);
      if (!focusTab) return;
      window.requestAnimationFrame(() => {
        const nextButton = Array.from(
          document.querySelectorAll<HTMLButtonElement>(
            "[data-project-workspace-tab]",
          ),
        ).find((button) => button.dataset.projectWorkspaceTab === nextTab.id);
        nextButton?.focus();
      });
    },
    [activateTab, activeTabId, tabs],
  );

  const handleTabKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLButtonElement>) => {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        cycleTab(-1, true);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        cycleTab(1, true);
      } else if (event.key === "Home") {
        event.preventDefault();
        const firstTab = tabs[0];
        if (firstTab) activateTab(firstTab.id, firstTab.projectId);
      } else if (event.key === "End") {
        event.preventDefault();
        const lastTab = tabs.at(-1);
        if (lastTab) activateTab(lastTab.id, lastTab.projectId);
      }
    },
    [activateTab, cycleTab, tabs],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || event.altKey || event.metaKey) return;
      const target = event.target;
      const targetIsWorkspaceTab =
        target instanceof HTMLElement &&
        target.closest("[data-project-workspace-tab]") !== null;
      const bodyHasFocus =
        document.activeElement === document.body ||
        document.activeElement === document.documentElement;
      const controlTab = event.ctrlKey;
      const requestedShiftTab =
        event.shiftKey &&
        !event.ctrlKey &&
        !isEditableKeyboardTarget(target) &&
        (targetIsWorkspaceTab || bodyHasFocus || target instanceof HTMLElement);
      if (!controlTab && !requestedShiftTab) return;
      event.preventDefault();
      cycleTab(event.shiftKey ? -1 : 1, targetIsWorkspaceTab);
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [cycleTab]);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      clearDragClickSuppressionSoon();
      if (event.over === null) return;
      reorderTab(String(event.active.id), String(event.over.id));
    },
    [clearDragClickSuppressionSoon, reorderTab],
  );

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
    <header
      className={cn(
        CHROME_ROW_HEIGHT_CLASS,
        "relative z-20 shrink-0 border-b border-border bg-surface-scrim px-2",
        usesDesktopChrome && MACOS_WINDOW_DRAG_CLASS,
      )}
    >
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={TAB_DRAG_MODIFIERS}
        onDragStart={beginDragClickSuppression}
        onDragCancel={clearDragClickSuppressionSoon}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={tabs.map((tab) => tab.id)}
          strategy={horizontalListSortingStrategy}
        >
          <div
            role="tablist"
            aria-label="Project workspaces"
            className="no-scrollbar flex h-full min-w-0 items-end gap-1 overflow-x-auto pt-2"
          >
            {tabs.map((tab) => {
              const isActive = tab.id === activeTabId;
              const isStale =
                data !== undefined && !knownProjectIds.has(tab.projectId);
              const duplicateCount = projectTabCounts.get(tab.projectId) ?? 1;
              const projectOrdinal =
                duplicateCount > 1
                  ? tabs
                      .filter(
                        (candidate) => candidate.projectId === tab.projectId,
                      )
                      .findIndex((candidate) => candidate.id === tab.id) + 1
                  : null;
              return (
                <SortableProjectWorkspaceTab
                  key={tab.id}
                  tab={tab}
                  isActive={isActive}
                  isStale={isStale}
                  projectOrdinal={projectOrdinal}
                  activateTab={activateTab}
                  handleClose={handleClose}
                  onKeyDown={handleTabKeyDown}
                />
              );
            })}
          </div>
        </SortableContext>
      </DndContext>
    </header>
  );
}
