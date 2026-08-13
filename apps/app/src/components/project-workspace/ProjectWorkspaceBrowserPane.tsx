import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import type { BrowserFixedPanelTab } from "@/lib/fixed-panel-tabs-state";
import { createBrowserFixedPanelTab } from "@/lib/fixed-panel-tabs-state";
import { BrowserTabDeck } from "@/components/secondary-panel/BrowserTabDeck";
import type { UpdateBrowserTabArgs } from "@/components/secondary-panel/useThreadFileTabs";
import { dispatchBrowserViewBoundsSync } from "@/lib/browser-view-bounds-sync";
import { useEnvironment } from "@/hooks/queries/environment-queries";
import {
  useProjectPathSuggestions,
  useProjectWorkStatus,
} from "@/hooks/queries/project-queries";
import {
  ProjectFilePreviewTabContent,
  GitDiffTabContent,
} from "@/components/secondary-panel/ThreadSecondaryPanelTabContent";
import { buildGitDiffTarget } from "@/components/secondary-panel/git-diff/gitDiffPanelHelpers";
import type { ProjectWorkspaceTab } from "./ProjectWorkspaceTabsProvider";
import type { ProjectWorkspaceTabUpdate } from "./ProjectWorkspaceTabsProvider";
import { ProjectWorkspacePaneFrame } from "./ProjectWorkspacePaneFrame";

interface ProjectWorkspaceBrowserPaneProps {
  backgroundAgentState: "attention" | "running" | null;
  canShowNativeBrowserView: boolean;
  environmentId: string | null;
  environmentOptions: readonly { id: string; label: string }[];
  projectId: string;
  isFocused: boolean;
  onToggleFocus: () => void;
  tab: ProjectWorkspaceTab;
  updateTab: (id: string, patch: ProjectWorkspaceTabUpdate) => void;
}

const INSPECTOR_FOLLOW_ACTIVE_VALUE = "__follow_active__";
const INSPECTOR_PROJECT_CHECKOUT_VALUE = "__project_checkout__";

function readBrowserTab(tab: ProjectWorkspaceTab): BrowserFixedPanelTab | null {
  return tab.browserTab;
}

/**
 * A dedicated browser surface whose native WebContentsView remains attached
 * while the workspace changes focus. Visibility is gated separately so a
 * hidden native overlay can never cover the focused agent.
 */
export function ProjectWorkspaceBrowserPane({
  backgroundAgentState,
  canShowNativeBrowserView,
  environmentId,
  environmentOptions,
  projectId,
  isFocused,
  onToggleFocus,
  tab,
  updateTab,
}: ProjectWorkspaceBrowserPaneProps) {
  const persistedBrowserTab = readBrowserTab(tab);
  const browserTab = useMemo(
    () =>
      persistedBrowserTab ??
      createBrowserFixedPanelTab({ environmentId, url: "" }),
    [environmentId, persistedBrowserTab],
  );

  useEffect(() => {
    if (persistedBrowserTab !== null) return;
    updateTab(tab.id, { browserTab });
  }, [browserTab, persistedBrowserTab, tab.id, updateTab]);

  useEffect(() => {
    if (browserTab.environmentId === environmentId) return;
    updateTab(tab.id, {
      browserTab: { ...browserTab, environmentId },
    });
  }, [browserTab, environmentId, tab.id, updateTab]);

  const handleUpdate = useCallback(
    (args: UpdateBrowserTabArgs) => {
      if (args.tabId !== browserTab.id) return;
      updateTab(tab.id, {
        browserTab: {
          ...browserTab,
          title: args.title,
          url: args.url,
        },
      });
    },
    [browserTab, tab.id, updateTab],
  );

  useLayoutEffect(() => {
    if (!canShowNativeBrowserView) return;
    dispatchBrowserViewBoundsSync();
    const frame = window.requestAnimationFrame(dispatchBrowserViewBoundsSync);
    return () => window.cancelAnimationFrame(frame);
  }, [canShowNativeBrowserView, isFocused]);

  const focusLabel =
    tab.inspectorView === "browser"
      ? "Focus browser"
      : tab.inspectorView === "files"
        ? "Focus files"
        : "Focus changes";

  return (
    <ProjectWorkspacePaneFrame
      title="Inspector"
      icon="Globe"
      actionLabel={isFocused ? "Restore four quadrants" : focusLabel}
      headerAccessory={
        backgroundAgentState ? (
          <span
            className={
              backgroundAgentState === "attention"
                ? "rounded-full bg-warning/15 px-2 py-0.5 text-2xs font-medium text-warning-foreground"
                : "rounded-full bg-accent px-2 py-0.5 text-2xs font-medium text-muted-foreground"
            }
            role="status"
          >
            {backgroundAgentState === "attention"
              ? "Agent needs attention"
              : "Agent running"}
          </span>
        ) : null
      }
      onHeaderDoubleClick={onToggleFocus}
      onToggleFocus={onToggleFocus}
    >
      <InspectorTabs
        projectId={projectId}
        tab={tab}
        environmentId={environmentId}
        environmentOptions={environmentOptions}
        browserTab={browserTab}
        canShowNativeBrowserView={
          canShowNativeBrowserView && tab.inspectorView === "browser"
        }
        onBrowserUpdate={handleUpdate}
        updateTab={updateTab}
      />
    </ProjectWorkspacePaneFrame>
  );
}

function InspectorTabs({
  projectId,
  tab,
  environmentId,
  environmentOptions,
  browserTab,
  canShowNativeBrowserView,
  onBrowserUpdate,
  updateTab,
}: {
  projectId: string;
  tab: ProjectWorkspaceTab;
  environmentId: string | null;
  environmentOptions: readonly { id: string; label: string }[];
  browserTab: BrowserFixedPanelTab;
  canShowNativeBrowserView: boolean;
  onBrowserUpdate: (args: UpdateBrowserTabArgs) => void;
  updateTab: (id: string, patch: ProjectWorkspaceTabUpdate) => void;
}) {
  const [fileQuery, setFileQuery] = useState("");
  const files = useProjectPathSuggestions({
    projectId,
    environmentId,
    hostId: null,
    query: fileQuery,
    limit: 100,
    includeFiles: true,
    includeDirectories: false,
    allowEmptyQuery: true,
  });
  const environment = useEnvironment(environmentId, {
    enabled: environmentId !== null,
  });
  const projectStatus = useProjectWorkStatus(
    { projectId, environmentId: null, hostId: null },
    { enabled: environmentId === null },
  );
  const isGitRepository = environment.data?.isGitRepo === true;
  const projectWorkspace =
    projectStatus.data?.outcome === "available"
      ? projectStatus.data.workspace
      : null;
  const diffTarget = buildGitDiffTarget(
    null,
    environment.data?.mergeBaseBranch ??
      environment.data?.baseBranch ??
      environment.data?.defaultBranch ??
      projectWorkspace?.branch.defaultBranch ??
      undefined,
  );
  const selectView = (inspectorView: ProjectWorkspaceTab["inspectorView"]) =>
    updateTab(tab.id, { inspectorView });
  const selectEnvironment = (value: string) => {
    if (value === INSPECTOR_FOLLOW_ACTIVE_VALUE) {
      updateTab(tab.id, { inspectorEnvironmentPinned: false });
      return;
    }
    updateTab(tab.id, {
      inspectorEnvironmentId:
        value === INSPECTOR_PROJECT_CHECKOUT_VALUE ? null : value,
      inspectorEnvironmentPinned: true,
    });
  };
  const selectedEnvironmentValue = tab.inspectorEnvironmentPinned
    ? (environmentId ?? INSPECTOR_PROJECT_CHECKOUT_VALUE)
    : INSPECTOR_FOLLOW_ACTIVE_VALUE;

  return (
    <div
      className="flex min-h-0 flex-1 flex-col bg-workspace-canvas text-workspace-foreground"
      data-project-workspace-inspector
    >
      <div className="flex shrink-0 items-center gap-1 border-b border-workspace-border bg-workspace-raised px-2 py-1">
        {(["browser", "files", "diff"] as const).map((view) => (
          <button
            key={view}
            type="button"
            className={cn(
              "rounded px-2 py-1 text-xs",
              tab.inspectorView === view
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:bg-accent/60",
            )}
            aria-pressed={tab.inspectorView === view}
            onClick={() => selectView(view)}
          >
            {view === "diff"
              ? "Changes"
              : view[0]?.toUpperCase() + view.slice(1)}
          </button>
        ))}
        <div className="min-w-0 flex-1" />
        <select
          aria-label="Inspector environment"
          className="max-w-40 truncate rounded bg-transparent px-2 py-1 text-xs text-muted-foreground outline-none hover:bg-accent"
          value={selectedEnvironmentValue}
          onChange={(event) => selectEnvironment(event.target.value)}
        >
          <option value={INSPECTOR_FOLLOW_ACTIVE_VALUE}>
            Follow active agent
          </option>
          <option value={INSPECTOR_PROJECT_CHECKOUT_VALUE}>
            Project checkout
          </option>
          {environmentOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      <div
        className={cn(
          "min-h-0 flex-1",
          tab.inspectorView !== "browser" && "hidden",
        )}
      >
        <BrowserTabDeck
          browserTabs={[browserTab]}
          activeBrowserTabId={browserTab.id}
          environmentId={environmentId}
          canShowNativeBrowserView={canShowNativeBrowserView}
          threadId={`project-workspace:${tab.id}`}
          onUpdate={onBrowserUpdate}
        />
      </div>
      <div
        className={cn(
          "min-h-0 flex-1 flex-col",
          tab.inspectorView === "files" && "flex",
          tab.inspectorView !== "files" && "hidden",
        )}
        data-project-workspace-files
      >
        <>
          <label className="flex shrink-0 items-center gap-1 border-b border-border/60 px-2 py-1">
            <Icon
              name="Search"
              className="size-3.5 text-muted-foreground"
              aria-hidden
            />
            <input
              value={fileQuery}
              onChange={(event) => setFileQuery(event.target.value)}
              className="min-w-0 flex-1 bg-transparent text-xs outline-none"
              placeholder="Search repository files"
            />
          </label>
          <div className="grid min-h-0 flex-1 grid-cols-[minmax(10rem,0.4fr)_minmax(0,1fr)]">
            <div className="persistent-scrollbar min-h-0 overflow-auto border-r border-border/60">
              {files.isLoading ? (
                <InspectorEmpty message="Loading files…" />
              ) : (files.data?.paths ?? []).length === 0 ? (
                <InspectorEmpty
                  message={
                    fileQuery.length === 0
                      ? "No project files found."
                      : "No matching files."
                  }
                />
              ) : (
                (files.data?.paths ?? []).map((entry) => (
                  <button
                    key={entry.path}
                    type="button"
                    className="block w-full truncate px-2 py-1 text-left text-xs hover:bg-accent"
                    onClick={() =>
                      updateTab(tab.id, { inspectorFilePath: entry.path })
                    }
                  >
                    {entry.path}
                  </button>
                ))
              )}
            </div>
            {tab.inspectorFilePath ? (
              <div
                className="persistent-scrollbar min-h-0 min-w-0 overflow-auto overscroll-contain"
                data-project-workspace-file-preview-scroll
              >
                <ProjectFilePreviewTabContent
                  activePath={tab.inspectorFilePath}
                  environmentId={environmentId}
                  hostId={null}
                  lineRange={null}
                  projectId={projectId}
                />
              </div>
            ) : (
              <InspectorEmpty message="Choose a file to preview." />
            )}
          </div>
        </>
      </div>
      <div
        className={cn(
          "min-h-0 flex-1",
          tab.inspectorView !== "diff" && "hidden",
        )}
      >
        {environmentId === null && projectStatus.isLoading ? (
          <InspectorEmpty message="Inspecting project checkout…" />
        ) : environmentId === null &&
          projectStatus.data?.outcome === "not_applicable" ? (
          <InspectorEmpty message="Not a Git repository." />
        ) : environmentId === null &&
          (projectStatus.isError ||
            projectStatus.data?.outcome === "unavailable") ? (
          <InspectorEmpty message="Project checkout status unavailable." />
        ) : environmentId === null && diffTarget === undefined ? (
          <InspectorEmpty message="Diff unavailable until the project checkout has a Git base branch." />
        ) : environment.data && !isGitRepository ? (
          <InspectorEmpty message="Not a Git repository." />
        ) : diffTarget === undefined ? (
          <InspectorEmpty message="Diff unavailable until a Git base branch is available." />
        ) : (
          <GitDiffTabContent
            environmentId={environmentId ?? undefined}
            projectId={environmentId === null ? projectId : undefined}
            target={diffTarget}
            isDiffPanelActive={tab.inspectorView === "diff"}
            gitDiffViewOptions={{}}
          />
        )}
      </div>
    </div>
  );
}

function InspectorEmpty({ message }: { message: string }) {
  return (
    <div className="grid min-h-0 flex-1 place-items-center px-4 text-center text-xs text-muted-foreground">
      {message}
    </div>
  );
}
