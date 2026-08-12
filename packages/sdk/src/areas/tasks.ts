import {
  workspaceAgentStartInputSchema,
  workspaceAgentStartOutputSchema,
  type WorkspaceAgentStartInput,
  type WorkspaceAgentStartOutput,
} from "@bb/server-contract";
import type { PluginsArea } from "./plugins.js";

export type WorkspaceAgentStartArgs = WorkspaceAgentStartInput;
export type WorkspaceAgentStartResult = WorkspaceAgentStartOutput;

export interface TasksArea {
  /**
   * Create or resume the Tasks record and agent thread owned by a project
   * workspace pane. The Tasks plugin must be installed and enabled.
   */
  startAgent(args: WorkspaceAgentStartArgs): Promise<WorkspaceAgentStartResult>;
}

export function createTasksArea(plugins: PluginsArea): TasksArea {
  return {
    async startAgent(args) {
      return plugins.callRpc({
        pluginId: "tasks",
        method: "workspaceAgentStart",
        input: workspaceAgentStartInputSchema.parse(args),
        outputSchema: workspaceAgentStartOutputSchema,
      });
    },
  };
}
