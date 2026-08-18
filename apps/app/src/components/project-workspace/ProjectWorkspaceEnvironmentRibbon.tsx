import { useState } from "react";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { Popover, PopoverContent, PopoverTrigger } from "@bb/shared-ui/popover";
import {
  useEnvironment,
  useEnvironmentWorkStatus,
} from "@/hooks/queries/environment-queries";
import { WorkingCopyManagerDialog } from "@/components/dialogs/WorkingCopyManagerDialog";

interface ProjectWorkspaceEnvironmentRibbonProps {
  environmentId: string | null;
  projectName: string;
  projectId: string;
  role: "builder" | "reviewer";
  taskKey: string | null;
  threadId: string;
}

function valueOrUnavailable(value: string | null | undefined): string {
  return value && value.length > 0 ? value : "Unavailable";
}

function closeTabStatus(
  environmentId: string | null,
  isWorktree: boolean | undefined,
): string {
  if (environmentId === null) {
    return "Safe — no environment attached; no cleanup performed";
  }
  if (isWorktree === true) {
    return "Safe — worktree retained; no cleanup performed";
  }
  if (isWorktree === false) {
    return "Safe — checkout/environment remains; no cleanup performed";
  }
  return "Safe — environment remains; no cleanup performed";
}

function MetadataRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[6.25rem_minmax(0,1fr)] gap-3 py-1.5 text-xs">
      <dt className="text-workspace-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-workspace-foreground">{value}</dd>
    </div>
  );
}

/** Header-sized environment control; detailed checkout facts stay one click away. */
export function ProjectWorkspaceEnvironmentRibbon({
  environmentId,
  projectName,
  projectId,
  role,
  taskKey,
  threadId,
}: ProjectWorkspaceEnvironmentRibbonProps) {
  const [managerOpen, setManagerOpen] = useState(false);
  const environment = useEnvironment(environmentId, {
    enabled: environmentId !== null,
  });
  const status = useEnvironmentWorkStatus(environmentId, undefined, {
    enabled: environmentId !== null,
  });
  const workspace =
    status.data?.outcome === "available" ? status.data.workspace : null;
  const record = environment.data;
  const agentLabel = role === "builder" ? "Build" : "Agent 2";
  const environmentLabel =
    environmentId === null
      ? "No environment"
      : (taskKey ??
        record?.name ??
        (record?.isWorktree === false ? "Project folder" : "Working copy"));
  const branch = valueOrUnavailable(
    workspace?.branch.currentBranch ?? record?.branchName,
  );
  const baseBranch = valueOrUnavailable(
    workspace?.mergeBase?.mergeBaseBranch ??
      record?.mergeBaseBranch ??
      record?.baseBranch,
  );
  const dirty = workspace
    ? workspace.workingTree.hasUncommittedChanges
      ? "Dirty"
      : "Clean"
    : "Unavailable";
  const aheadBehind = workspace?.mergeBase
    ? `${workspace.mergeBase.aheadCount} ahead / ${workspace.mergeBase.behindCount} behind`
    : "Unavailable";
  const gitState =
    record === undefined
      ? "Unavailable"
      : record.isGitRepo
        ? "Git repository"
        : "Not a Git repository";

  return (
    <>
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={`${agentLabel} workspace details`}
            onDoubleClick={(event) => event.stopPropagation()}
            className="inline-flex h-6 max-w-48 items-center gap-1.5 rounded-md border border-workspace-border bg-workspace-raised px-2 text-2xs text-workspace-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Icon name="GitBranch" className="size-3 shrink-0" aria-hidden />
            <span className="truncate">{environmentLabel}</span>
            <span
              className={
                dirty === "Dirty"
                  ? "size-1.5 shrink-0 rounded-full bg-warning"
                  : "size-1.5 shrink-0 rounded-full bg-workspace-muted-foreground"
              }
              aria-hidden
            />
            <Icon
              name="ChevronDown"
              className="size-3 shrink-0 text-workspace-muted-foreground"
              aria-hidden
            />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          side="bottom"
          sideOffset={6}
          aria-label={`${agentLabel} workspace details`}
          mobileTitle={`${agentLabel} workspace details`}
          className="w-[min(28rem,calc(100vw-2rem))] border-workspace-border bg-workspace-raised p-3 text-workspace-foreground"
        >
          <div className="mb-2 flex items-center gap-2 border-b border-workspace-border pb-2">
            <Icon
              name="GitBranch"
              className="size-4 text-workspace-muted-foreground"
              aria-hidden
            />
            <div className="min-w-0">
              <p className="truncate text-xs font-medium">{environmentLabel}</p>
              <p className="truncate text-2xs text-workspace-muted-foreground">
                {environmentId === null ? "Not attached" : environmentId}
              </p>
            </div>
          </div>
          <dl className="divide-y divide-workspace-border">
            <MetadataRow label="Repository" value={projectName} />
            <MetadataRow label="Git state" value={gitState} />
            <MetadataRow
              label="Exact path"
              value={valueOrUnavailable(record?.path)}
            />
            <MetadataRow label="Branch" value={branch} />
            <MetadataRow label="Base branch" value={baseBranch} />
            <MetadataRow label="Agent" value={agentLabel} />
            <MetadataRow label="Task" value={valueOrUnavailable(taskKey)} />
            <MetadataRow label="Thread" value={threadId} />
            <MetadataRow label="Working tree" value={dirty} />
            <MetadataRow label="Ahead / behind" value={aheadBehind} />
            <MetadataRow
              label="Close tab"
              value={closeTabStatus(environmentId, record?.isWorktree)}
            />
          </dl>
          {record?.workspaceProvisionType === "managed-worktree" ? (
            <Button
              type="button"
              variant="outline"
              className="mt-3 w-full"
              onClick={() => setManagerOpen(true)}
            >
              Finish or abandon task…
            </Button>
          ) : null}
        </PopoverContent>
      </Popover>
      <WorkingCopyManagerDialog
        open={managerOpen}
        onOpenChange={setManagerOpen}
        projectId={projectId}
        initialEnvironmentId={environmentId}
        currentThreadId={threadId}
      />
    </>
  );
}
