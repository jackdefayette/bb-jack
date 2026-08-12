import { useParams } from "react-router-dom";
import { ProjectWorkspaceGrid } from "@/components/project-workspace/ProjectWorkspaceGrid";
import { ProjectWorkspaceTabBar } from "@/components/project-workspace/ProjectWorkspaceTabBar";
import { useProjectWorkspaceTabs } from "@/components/project-workspace/ProjectWorkspaceTabsProvider";

/** Route surface for one persistent, project-scoped four-quadrant workspace. */
export function ProjectWorkspaceView() {
  const { projectId, workspaceTabId } = useParams<{
    projectId: string;
    workspaceTabId: string;
  }>();
  const { activeTabId, tabs, updateTab } = useProjectWorkspaceTabs();
  const tab = tabs.find(
    (candidate) =>
      candidate.id === workspaceTabId && candidate.projectId === projectId,
  );

  if (!workspaceTabId || !tab) {
    return (
      <div className="grid min-h-0 flex-1 place-items-center px-8 text-center">
        <div>
          <p className="text-sm font-medium text-foreground">
            Workspace tab unavailable
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Open a project from the Projects menu to create a new workspace tab.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-canvas">
      <ProjectWorkspaceTabBar activeTabId={workspaceTabId} />
      <ProjectWorkspaceGrid
        key={tab.id}
        tab={tab}
        isActive={activeTabId === tab.id}
        updateTab={updateTab}
      />
    </div>
  );
}

export default ProjectWorkspaceView;
