import { useCallback, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ThreadRoutePathArgs } from "@/lib/route-paths";
import type { NewThreadRequest } from "@bb/plugin-sdk";
import { PluginNewThreadComposer } from "@/components/plugin/PluginNewThreadComposer";
import { callPluginRpc } from "@/lib/plugin-sdk-hooks";
import { refetchSidebarNavigationAfterWorkspaceAgentStart } from "@/hooks/cache-owners/mutation-cache-effects";
import { ThreadDetailView } from "@/views/thread-detail/ThreadDetailView";
import {
  PaneContext,
  type PaneContextValue,
} from "@/views/thread-detail/PaneContext";
import { ProjectWorkspacePaneFrame } from "./ProjectWorkspacePaneFrame";
import { ProjectWorkspaceEnvironmentRibbon } from "./ProjectWorkspaceEnvironmentRibbon";

export type ProjectWorkspaceAgentRole = "builder" | "reviewer";

interface WorkspaceAgentStartResult {
  taskId: string;
  taskKey: string;
  threadId: string;
  environmentId: string | null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** Strictly narrows the Tasks plugin result at the app/plugin boundary. */
export function parseWorkspaceAgentStartResult(
  value: unknown,
): WorkspaceAgentStartResult | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Record<string, unknown>;
  if (
    !isNonEmptyString(candidate.taskId) ||
    !isNonEmptyString(candidate.taskKey) ||
    !isNonEmptyString(candidate.threadId) ||
    !(candidate.environmentId === null || isNonEmptyString(candidate.environmentId))
  ) {
    return null;
  }
  return {
    taskId: candidate.taskId,
    taskKey: candidate.taskKey,
    threadId: candidate.threadId,
    environmentId: candidate.environmentId,
  };
}

interface ProjectWorkspaceAgentPaneProps {
  isExpanded?: boolean;
  isFocused: boolean;
  isTopRow: boolean;
  label: "Build" | "Review";
  onActivate: () => void;
  onNavigate: (thread: ThreadRoutePathArgs) => void;
  onToggleFocus?: () => void;
  projectId: string;
  projectName: string;
  role: ProjectWorkspaceAgentRole;
  taskKey: string | null;
  environmentId: string | null;
  threadId: string | null;
  workspaceTabId: string;
  onAgentStarted: (result: WorkspaceAgentStartResult) => void;
}

export function ProjectWorkspaceAgentPane({
  isExpanded = false,
  isFocused,
  isTopRow,
  label,
  onActivate,
  onNavigate,
  onToggleFocus,
  projectId,
  projectName,
  role,
  taskKey,
  environmentId,
  threadId,
  workspaceTabId,
  onAgentStarted,
}: ProjectWorkspaceAgentPaneProps) {
  const queryClient = useQueryClient();
  const [startError, setStartError] = useState<string | null>(null);
  const navigateInPane = useCallback(
    (thread: ThreadRoutePathArgs) => onNavigate(thread),
    [onNavigate],
  );
  const paneContext = useMemo<PaneContextValue>(
    () => ({
      paneId: role === "builder" ? "workspace-primary" : "workspace-review",
      isFocused,
      isSplitPane: true,
      secondaryPanelHost: null,
      reservesWindowPanelToggle: false,
      onRequestClose: null,
      isMaximized: isExpanded,
      onToggleMaximize: onToggleFocus ?? null,
      isBoundedPane: true,
      isTopRow,
      ownsWindowTopLeft: role === "builder",
      navigateInPane,
    }),
    [isExpanded, isFocused, isTopRow, navigateInPane, onToggleFocus, role],
  );
  const startAgent = useCallback(
    async (request: NewThreadRequest) => {
      setStartError(null);
      if (request.projectId !== projectId) {
        setStartError("This workspace is fixed to its project. Choose the project shown above.");
        throw new Error("Workspace project mismatch");
      }
      let rpcResult: unknown;
      try {
        rpcResult = await callPluginRpc(fetch, "tasks", "workspaceAgentStart", {
          workspaceKey: `${workspaceTabId}:${role}`,
          bbProjectId: projectId,
          projectName,
          role,
          request,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to start this agent";
        setStartError(`${message}. Retry to keep this draft.`);
        throw error;
      }
      const result = parseWorkspaceAgentStartResult(rpcResult);
      if (result === null) {
        setStartError("Tasks returned an invalid agent start result. Retry to keep this draft.");
        throw new Error("Invalid workspace agent start result");
      }
      // The grid resolves saved IDs against the sidebar projection to discard
      // stale deleted threads. Refresh that projection before publishing a new
      // ID so the grid never clears a thread that was just created.
      try {
        await refetchSidebarNavigationAfterWorkspaceAgentStart({ queryClient });
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Unable to refresh the new agent";
        setStartError(`${message}. Retry to attach the existing task and keep this draft.`);
        throw error;
      }
      onAgentStarted(result);
    },
    [onAgentStarted, projectId, projectName, queryClient, role, workspaceTabId],
  );

  return (
    <ProjectWorkspacePaneFrame
      title={label}
      icon="AiContentGenerator01"
      actionLabel={
        isExpanded
          ? "Restore four quadrants"
          : `Focus ${label.toLowerCase()} chat`
      }
      onActivate={onActivate}
      onHeaderDoubleClick={onToggleFocus}
      onToggleFocus={onToggleFocus}
    >
      {threadId ? (
        <PaneContext.Provider value={paneContext}>
          <div className="flex min-h-0 flex-1 flex-col">
            <ProjectWorkspaceEnvironmentRibbon
              projectName={projectName}
              environmentId={environmentId}
              role={role}
              taskKey={taskKey}
              threadId={threadId}
            />
            <ThreadDetailView
              surface="pane"
              projectId={projectId}
              threadId={threadId}
            />
          </div>
        </PaneContext.Provider>
      ) : (
        <div
          className="flex min-h-0 flex-1 flex-col p-2"
          data-workspace-agent-ready={role}
        >
          {startError ? (
            <p role="alert" className="mb-1 px-1 text-xs text-destructive">
              {startError}
            </p>
          ) : null}
          <PluginNewThreadComposer
            defaultProjectId={projectId}
            draftKey={`project-workspace:${workspaceTabId}:${role}`}
            placeholder={
              role === "builder"
                ? "What should we build?"
                : "What should we review?"
            }
            layout="contained"
            workspaceEnvironmentChoices
            onSubmit={startAgent}
          />
        </div>
      )}
    </ProjectWorkspacePaneFrame>
  );
}
