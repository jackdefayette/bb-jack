import { useState } from "react";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { PluginSlotMount } from "@/components/plugin/PluginSlotMount";
import { usePluginSlots } from "@/lib/plugin-slots";
import { ProjectSourceControlPane } from "./ProjectSourceControlPane";

export type ProjectWorkspaceToolsView = "tasks" | "source-control";

export interface ProjectWorkspaceToolsPaneProps {
  projectId: string;
  toolsView: ProjectWorkspaceToolsView;
  onToolsViewChange: (view: ProjectWorkspaceToolsView) => void;
}

function TasksProjectSurface({
  projectId,
  createToken,
}: {
  projectId: string;
  createToken: number;
}) {
  const { navPanels } = usePluginSlots();
  const panel =
    navPanels.find(
      (candidate) =>
        candidate.pluginId === "tasks" && candidate.path === "tasks",
    ) ?? null;

  if (panel === null) {
    return (
      <div className="grid min-h-0 flex-1 place-items-center p-5 text-center">
        <div>
          <p className="text-xs font-medium">Tasks is not available</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Enable the Tasks plugin to link project work and history.
          </p>
        </div>
      </div>
    );
  }

  const subPath = `bb-project/${encodeURIComponent(projectId)}${
    createToken > 0 ? `?create=${createToken}` : ""
  }`;
  return (
    <PluginSlotMount
      key={`${panel.pluginId}/${panel.id}/${panel.generation}`}
      pluginId={panel.pluginId}
      slotKind="navPanel"
      slotId={panel.id}
      instanceId={`project-workspace-${projectId}`}
    >
      <div className="flex h-full min-h-0 flex-1 flex-col">
        <panel.component subPath={subPath} />
      </div>
    </PluginSlotMount>
  );
}

export function ProjectWorkspaceToolsPane({
  projectId,
  toolsView,
  onToolsViewChange,
}: ProjectWorkspaceToolsPaneProps) {
  const [createToken, setCreateToken] = useState(0);
  const createTask = () => {
    onToolsViewChange("tasks");
    setCreateToken((token) => token + 1);
  };

  return (
    <section
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-canvas"
      data-project-workspace-pane="Project tools"
    >
      <header className="flex h-9 shrink-0 items-center gap-1 border-b border-border/70 bg-sidebar px-2">
        <button
          type="button"
          className={cn(
            "h-7 rounded-md px-2.5 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            toolsView === "tasks"
              ? "bg-accent text-foreground"
              : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
          )}
          aria-pressed={toolsView === "tasks"}
          onClick={() => onToolsViewChange("tasks")}
        >
          Tasks
        </button>
        <button
          type="button"
          className={cn(
            "h-7 rounded-md px-2.5 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            toolsView === "source-control"
              ? "bg-accent text-foreground"
              : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
          )}
          aria-pressed={toolsView === "source-control"}
          onClick={() => onToolsViewChange("source-control")}
        >
          Source Control
        </button>
        <div className="flex-1" />
        <button
          type="button"
          className="inline-flex h-7 items-center gap-1.5 rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={createTask}
        >
          <Icon name="Plus" className="size-3.5" aria-hidden />
          New task
        </button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col">
        {toolsView === "tasks" ? (
          <TasksProjectSurface
            projectId={projectId}
            createToken={createToken}
          />
        ) : (
          <ProjectSourceControlPane projectId={projectId} />
        )}
      </div>
    </section>
  );
}
