import { useEffect, useMemo, useState } from "react";
import { Button } from "@bb/shared-ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@bb/shared-ui/dialog";
import { cn } from "@bb/shared-ui/lib/utils";
import { useCleanupEnvironment } from "@/hooks/mutations/environment-mutations";
import {
  useEnvironmentCleanupPreflight,
  useEnvironments,
} from "@/hooks/queries/environment-queries";

interface WorkingCopyManagerDialogProps {
  currentThreadId?: string | null;
  initialEnvironmentId?: string | null;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  projectId: string;
}

export function WorkingCopyManagerDialog({
  currentThreadId = null,
  initialEnvironmentId = null,
  onOpenChange,
  open,
  projectId,
}: WorkingCopyManagerDialogProps) {
  const environments = useEnvironments(projectId, { enabled: open });
  const workingCopies = useMemo(
    () =>
      (environments.data ?? [])
        .filter(
          (environment) =>
            environment.workspaceProvisionType === "managed-worktree" &&
            environment.status !== "destroyed",
        )
        .sort((left, right) => right.updatedAt - left.updatedAt),
    [environments.data],
  );
  const [selectedId, setSelectedId] = useState<string | null>(
    initialEnvironmentId,
  );
  const [confirmation, setConfirmation] = useState("");
  useEffect(() => {
    if (!open) return;
    setSelectedId((current) =>
      workingCopies.some((copy) => copy.id === current)
        ? current
        : (initialEnvironmentId ?? workingCopies[0]?.id ?? null),
    );
  }, [initialEnvironmentId, open, workingCopies]);
  useEffect(() => setConfirmation(""), [selectedId]);
  const preflight = useEnvironmentCleanupPreflight(selectedId, {
    enabled: open && selectedId !== null,
  });
  const cleanup = useCleanupEnvironment();
  const details = preflight.data;
  const run = (
    action: "detach_thread" | "safe_delete" | "keep_branch" | "discard",
  ) => {
    if (!selectedId) return;
    cleanup.mutate(
      {
        id: selectedId,
        action,
        ...(currentThreadId ? { threadId: currentThreadId } : {}),
        ...(action === "discard" ? { confirmation } : {}),
      },
      {
        onSuccess: () => {
          if (action === "detach_thread") onOpenChange(false);
          else void preflight.refetch();
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Manage working copies</DialogTitle>
          <DialogDescription>
            Task conversations are archived separately. Removing a shared folder
            affects every task attached to it.
          </DialogDescription>
        </DialogHeader>
        <div className="grid min-h-72 grid-cols-[minmax(10rem,0.8fr)_minmax(0,1.4fr)] gap-3">
          <div className="space-y-1 overflow-auto border-r border-border pr-3">
            {workingCopies.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No managed working copies.
              </p>
            ) : (
              workingCopies.map((copy) => (
                <button
                  key={copy.id}
                  type="button"
                  onClick={() => setSelectedId(copy.id)}
                  className={cn(
                    "w-full rounded px-2 py-2 text-left text-xs hover:bg-muted",
                    selectedId === copy.id && "bg-muted",
                  )}
                >
                  <span className="block truncate font-medium">
                    {copy.name ?? copy.branchName ?? "Working copy"}
                  </span>
                  <span className="block truncate text-muted-foreground">
                    {copy.status} · last used{" "}
                    {new Date(copy.updatedAt).toLocaleDateString()}
                  </span>
                </button>
              ))
            )}
          </div>
          <div className="space-y-3">
            {preflight.isLoading ? (
              <p className="text-sm text-muted-foreground">
                Running Git safety preflight…
              </p>
            ) : details ? (
              <>
                <div>
                  <p className="text-sm font-medium">
                    {details.environment.name ??
                      details.environment.branchName ??
                      details.environment.id}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {details.summary}
                  </p>
                </div>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                  <dt className="text-muted-foreground">Branch</dt>
                  <dd>{details.environment.branchName ?? "Detached"}</dd>
                  <dt className="text-muted-foreground">Tasks attached</dt>
                  <dd>{details.liveThreads.length}</dd>
                  <dt className="text-muted-foreground">Working tree</dt>
                  <dd>
                    {details.workspace?.workingTree.state ?? "Unavailable"}
                  </dd>
                  <dt className="text-muted-foreground">Committed work</dt>
                  <dd>
                    {details.workspace?.mergeBase?.hasCommittedUnmergedChanges
                      ? "Unmerged"
                      : "Merged or none"}
                  </dd>
                </dl>
                <div className="space-y-2 border-t border-border pt-3">
                  {currentThreadId &&
                  details.allowedActions.includes("detach_thread") ? (
                    <Button
                      variant="outline"
                      onClick={() => run("detach_thread")}
                      disabled={cleanup.isPending}
                    >
                      Detach this task — keep shared folder
                    </Button>
                  ) : null}
                  {details.allowedActions.includes("safe_delete") ? (
                    <Button
                      onClick={() => run("safe_delete")}
                      disabled={cleanup.isPending}
                    >
                      Finish and remove safe working copy
                    </Button>
                  ) : null}
                  {details.allowedActions.includes("keep_branch") ? (
                    <Button
                      onClick={() => run("keep_branch")}
                      disabled={cleanup.isPending}
                    >
                      Remove folder, keep branch
                    </Button>
                  ) : null}
                  {details.allowedActions.includes("discard") ? (
                    <div className="space-y-2 rounded border border-destructive/50 p-3">
                      <p className="text-xs text-destructive">
                        Destructive: tracked or untracked files and any deleted
                        branch commits may be lost. Type{" "}
                        {details.environment.id} to confirm.
                      </p>
                      <input
                        aria-label="Destructive cleanup confirmation"
                        value={confirmation}
                        onChange={(event) =>
                          setConfirmation(event.target.value)
                        }
                        className="h-8 w-full rounded border border-input bg-background px-2 text-xs"
                      />
                      <Button
                        variant="destructive"
                        onClick={() => run("discard")}
                        disabled={
                          cleanup.isPending ||
                          confirmation !== details.environment.id
                        }
                      >
                        Abandon and discard working copy
                      </Button>
                    </div>
                  ) : null}
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                Choose a working copy.
              </p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
