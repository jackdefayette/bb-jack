import { useMemo, type ReactNode } from "react";
import type { ThreadListEntry } from "@bb/domain";
import { Icon } from "@bb/shared-ui/icon";
import {
  getEnvironmentPullRequestFromResponse,
  useEnvironmentPullRequest,
  useEnvironmentWorkStatus,
} from "@/hooks/queries/environment-queries";
import { useProjectSourceBranches } from "@/hooks/queries/project-queries";
import { useSidebarNavigation } from "@/hooks/queries/sidebar-navigation-query";
import { useThreads } from "@/hooks/queries/thread-queries";

const RECENT_ENVIRONMENT_LIMIT = 4;

function EmptyMessage({ children }: { children: ReactNode }) {
  return <p className="px-3 py-2 text-xs text-muted-foreground">{children}</p>;
}

function EnvironmentSourceSummary({ thread }: { thread: ThreadListEntry }) {
  const status = useEnvironmentWorkStatus(thread.environmentId, undefined, {
    enabled: thread.environmentId !== null,
  });
  const pullRequestResponse = useEnvironmentPullRequest(thread.environmentId, {
    enabled: thread.environmentId !== null,
  });
  const workspace =
    status.data?.outcome === "available" ? status.data.workspace : null;
  const pullRequest = getEnvironmentPullRequestFromResponse(
    pullRequestResponse.data,
  );
  const label =
    thread.environmentName ??
    thread.environmentBranchName ??
    thread.title ??
    thread.titleFallback ??
    "Project workspace";

  return (
    <article className="rounded-md border border-border/70 bg-canvas">
      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
        <Icon name="GitBranch" className="size-3.5 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium">
          {label}
        </span>
        <span className="truncate text-xs text-muted-foreground">
          {workspace?.branch.currentBranch ??
            thread.environmentBranchName ??
            "branch unavailable"}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-px bg-border/60">
        <section className="min-w-0 bg-canvas p-2" aria-label="Changes">
          <h4 className="mb-1 text-xs font-medium text-muted-foreground">
            Changes
          </h4>
          {status.isLoading ? (
            <p className="text-xs text-muted-foreground">Loading…</p>
          ) : status.isError || status.data?.outcome === "unavailable" ? (
            <p className="text-xs text-destructive">Status unavailable</p>
          ) : status.data?.outcome === "not_applicable" ? (
            <p className="text-xs text-muted-foreground">Not a Git workspace</p>
          ) : workspace?.workingTree.files.length ? (
            <ul className="space-y-1">
              {workspace.workingTree.files.slice(0, 4).map((file) => (
                <li key={file.path} className="flex min-w-0 gap-1.5 text-xs">
                  <span className="shrink-0 text-muted-foreground">
                    {file.status}
                  </span>
                  <span className="truncate" title={file.path}>
                    {file.path}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">Working tree clean</p>
          )}
        </section>

        <section className="min-w-0 bg-canvas p-2" aria-label="Pull requests">
          <h4 className="mb-1 text-xs font-medium text-muted-foreground">
            PRs
          </h4>
          {pullRequestResponse.isLoading ? (
            <p className="text-xs text-muted-foreground">Loading…</p>
          ) : pullRequestResponse.data?.outcome === "unavailable" ? (
            <p className="text-xs text-destructive">GitHub unavailable</p>
          ) : pullRequest ? (
            <a
              href={pullRequest.url}
              target="_blank"
              rel="noreferrer"
              className="block min-w-0 text-xs hover:underline"
            >
              <span className="font-medium">#{pullRequest.number}</span>{" "}
              <span className="truncate">{pullRequest.title}</span>
              <span className="ml-1 text-muted-foreground">
                {pullRequest.state}
              </span>
            </a>
          ) : (
            <p className="text-xs text-muted-foreground">No pull request</p>
          )}
        </section>

        <section
          className="col-span-2 min-w-0 bg-canvas p-2"
          aria-label="History"
        >
          <h4 className="mb-1 text-xs font-medium text-muted-foreground">
            History
          </h4>
          {workspace?.mergeBase?.commits.length ? (
            <ul className="space-y-1">
              {workspace.mergeBase.commits.slice(0, 3).map((commit) => (
                <li key={commit.sha} className="flex min-w-0 gap-2 text-xs">
                  <code className="shrink-0 text-muted-foreground">
                    {commit.shortSha}
                  </code>
                  <span className="truncate" title={commit.subject}>
                    {commit.subject}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">
              No unmerged commits in the available history
            </p>
          )}
        </section>
      </div>
    </article>
  );
}

export function ProjectSourceControlPane({ projectId }: { projectId: string }) {
  const sidebar = useSidebarNavigation();
  const archivedThreads = useThreads({
    archived: true,
    projectId,
  });
  const project =
    sidebar.data?.projects.find((candidate) => candidate.id === projectId) ??
    (sidebar.data?.personalProject.id === projectId
      ? sidebar.data.personalProject
      : null);
  const recentEnvironmentThreads = useMemo(() => {
    if (!project) return [];
    const seen = new Set<string>();
    return [...project.threads, ...(archivedThreads.data ?? [])]
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .filter((thread) => {
        if (thread.environmentId === null || seen.has(thread.environmentId))
          return false;
        seen.add(thread.environmentId);
        return true;
      })
      .slice(0, RECENT_ENVIRONMENT_LIMIT);
  }, [archivedThreads.data, project]);
  const hostId =
    recentEnvironmentThreads.find((thread) => thread.environmentHostId)
      ?.environmentHostId ??
    project?.sources.find((source) => source.isDefault)?.hostId ??
    project?.sources[0]?.hostId ??
    null;
  const branches = useProjectSourceBranches(projectId, hostId, {
    enabled: project !== null && hostId !== null,
  });

  if (sidebar.isLoading) {
    return <EmptyMessage>Loading source control…</EmptyMessage>;
  }
  if (sidebar.isError || !project) {
    return <EmptyMessage>Project source control is unavailable.</EmptyMessage>;
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto p-2">
      <section className="mb-2 rounded-md border border-border/70 bg-canvas">
        <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
          <Icon name="GitBranch" className="size-3.5 text-muted-foreground" />
          <h3 className="text-xs font-medium">Branches</h3>
        </div>
        {hostId === null ? (
          <EmptyMessage>No project source is connected.</EmptyMessage>
        ) : branches.isLoading ? (
          <EmptyMessage>Loading branches…</EmptyMessage>
        ) : branches.isError ? (
          <EmptyMessage>
            Branches are unavailable while the host is offline.
          </EmptyMessage>
        ) : (
          <div className="flex flex-wrap gap-1.5 p-2">
            {(branches.data?.branches ?? []).slice(0, 12).map((branch) => (
              <span
                key={branch}
                className="max-w-full truncate rounded-md bg-secondary px-2 py-1 text-xs"
                title={branch}
              >
                {branch}
              </span>
            ))}
            {(branches.data?.branches.length ?? 0) === 0 ? (
              <span className="text-xs text-muted-foreground">
                No local branches reported
              </span>
            ) : null}
          </div>
        )}
      </section>

      {recentEnvironmentThreads.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-4 text-center">
          <p className="text-xs font-medium">No task workspaces yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Changes, pull requests, and commit history appear after a project
            task creates an environment.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {recentEnvironmentThreads.map((thread) => (
            <EnvironmentSourceSummary
              key={thread.environmentId}
              thread={thread}
            />
          ))}
        </div>
      )}
    </div>
  );
}
