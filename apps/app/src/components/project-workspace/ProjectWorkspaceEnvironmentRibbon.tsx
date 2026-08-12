import { useEnvironment, useEnvironmentWorkStatus } from "@/hooks/queries/environment-queries";

interface ProjectWorkspaceEnvironmentRibbonProps {
  environmentId: string | null;
  projectName: string;
  role: "builder" | "reviewer";
  taskKey: string | null;
  threadId: string;
}

function valueOrUnavailable(value: string | null | undefined): string {
  return value && value.length > 0 ? value : "Unavailable";
}

/** Compact, deliberately literal checkout metadata for one agent environment. */
export function ProjectWorkspaceEnvironmentRibbon({
  environmentId,
  projectName,
  role,
  taskKey,
  threadId,
}: ProjectWorkspaceEnvironmentRibbonProps) {
  const environment = useEnvironment(environmentId, {
    enabled: environmentId !== null,
  });
  const status = useEnvironmentWorkStatus(environmentId, undefined, {
    enabled: environmentId !== null,
  });
  const workspace = status.data?.outcome === "available" ? status.data.workspace : null;
  const dirty = workspace
    ? workspace.workingTree.hasUncommittedChanges
      ? "Dirty"
      : "Clean"
    : "Unavailable";
  const aheadBehind = workspace?.mergeBase
    ? `${workspace.mergeBase.aheadCount} ahead / ${workspace.mergeBase.behindCount} behind`
    : "Unavailable";
  const record = environment.data;

  return (
    <div className="flex shrink-0 flex-wrap gap-x-3 gap-y-0.5 border-b border-border/60 bg-sidebar/60 px-2.5 py-1 text-2xs text-muted-foreground">
      <span title="Project">{projectName}</span>
      <span title="Owning workspace agent">Agent: {role === "builder" ? "Builder" : "Reviewer"}</span>
      <span title="Task key">Task {valueOrUnavailable(taskKey)}</span>
      <span title="Thread">Thread {threadId}</span>
      <span title="Environment name">Environment: {valueOrUnavailable(record?.name)}</span>
      <span title="Repository or worktree path">Path: {valueOrUnavailable(record?.path)}</span>
      <span title="Branch">{valueOrUnavailable(workspace?.branch.currentBranch ?? record?.branchName)}</span>
      <span title="Base branch">{valueOrUnavailable(workspace?.mergeBase?.mergeBaseBranch ?? record?.mergeBaseBranch ?? record?.baseBranch)}</span>
      <span title="Working tree">{dirty}</span>
      <span title="Ahead / behind">{aheadBehind}</span>
      <span title="Safe close behavior">Safe to close tab: yes; worktree retained</span>
    </div>
  );
}
