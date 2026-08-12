import { useCallback, useMemo } from "react";
import type { ThreadRoutePathArgs } from "@/lib/route-paths";
import { ThreadDetailView } from "@/views/thread-detail/ThreadDetailView";
import {
  PaneContext,
  type PaneContextValue,
} from "@/views/thread-detail/PaneContext";
import { ProjectWorkspacePaneFrame } from "./ProjectWorkspacePaneFrame";

interface ProjectWorkspaceAgentPaneProps {
  isExpanded?: boolean;
  isFocused: boolean;
  isTopRow: boolean;
  label: "Primary Agent" | "Review Agent";
  onActivate: () => void;
  onNavigate: (thread: ThreadRoutePathArgs) => void;
  onToggleFocus?: () => void;
  projectId: string;
  threadId: string | null;
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
  threadId,
}: ProjectWorkspaceAgentPaneProps) {
  const navigateInPane = useCallback(
    (thread: ThreadRoutePathArgs) => onNavigate(thread),
    [onNavigate],
  );
  const paneContext = useMemo<PaneContextValue>(
    () => ({
      paneId: label === "Primary Agent" ? "workspace-primary" : "workspace-review",
      isFocused,
      isSplitPane: true,
      secondaryPanelHost: null,
      reservesWindowPanelToggle: false,
      onRequestClose: null,
      isMaximized: isExpanded,
      onToggleMaximize: onToggleFocus ?? null,
      isBoundedPane: true,
      isTopRow,
      ownsWindowTopLeft: label === "Primary Agent",
      navigateInPane,
    }),
    [isExpanded, isFocused, isTopRow, label, navigateInPane, onToggleFocus],
  );

  return (
    <ProjectWorkspacePaneFrame
      title={label}
      icon="AiContentGenerator01"
      actionLabel={
        isExpanded
          ? "Restore four quadrants"
          : `Focus ${label.toLowerCase()}`
      }
      onActivate={onActivate}
      onHeaderDoubleClick={onToggleFocus}
      onToggleFocus={onToggleFocus}
    >
      {threadId ? (
        <PaneContext.Provider value={paneContext}>
          <ThreadDetailView
            surface="pane"
            projectId={projectId}
            threadId={threadId}
          />
        </PaneContext.Provider>
      ) : (
        <div className="grid min-h-0 flex-1 place-items-center px-6 text-center">
          <div>
            <p className="text-sm font-medium text-foreground">No agent assigned</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Create a task in this project to start an agent here.
            </p>
          </div>
        </div>
      )}
    </ProjectWorkspacePaneFrame>
  );
}
