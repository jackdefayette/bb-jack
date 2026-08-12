import { Icon } from "@bb/shared-ui/icon";
import {
  getEnvironmentPullRequestFromResponse,
  useEnvironment,
  useEnvironmentPullRequest,
  useEnvironmentWorkStatus,
} from "@/hooks/queries/environment-queries";
import { useProjectWorkStatus } from "@/hooks/queries/project-queries";

function ProjectSourceSummary({ projectId }: { projectId: string }) {
  const status = useProjectWorkStatus({
    projectId,
    environmentId: null,
    hostId: null,
  });
  const workspace =
    status.data?.outcome === "available" ? status.data.workspace : null;

  return (
    <article className="rounded-md border border-border/70 bg-canvas">
      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
        <Icon name="GitBranch" className="size-3.5 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium">
          Project checkout
        </span>
        <span className="truncate text-xs text-muted-foreground">
          {workspace?.branch.currentBranch ?? "branch unavailable"}
        </span>
      </div>
      {status.data?.resolvedSource ? (
        <div className="border-b border-border/60 px-3 py-2 text-xs text-muted-foreground">
          <p className="truncate" title={status.data.resolvedSource.path}>
            {status.data.resolvedSource.path}
          </p>
          <p className="truncate">Host: {status.data.resolvedSource.hostId}</p>
        </div>
      ) : null}
      <section className="min-w-0 p-3" aria-label="Project changes">
        {status.isLoading ? (
          <p className="text-xs text-muted-foreground">Inspecting checkout…</p>
        ) : status.isError || status.data?.outcome === "unavailable" ? (
          <p className="text-xs text-destructive">Status unavailable</p>
        ) : status.data?.outcome === "not_applicable" ? (
          <p className="text-xs text-muted-foreground">Not a Git repository</p>
        ) : workspace?.workingTree.files.length ? (
          <ul className="space-y-1">
            {workspace.workingTree.files.slice(0, 8).map((file) => (
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
    </article>
  );
}

function EnvironmentSourceSummary({ environmentId, label }: { environmentId: string; label: string }) {
  const environment = useEnvironment(environmentId);
  const status = useEnvironmentWorkStatus(environmentId, undefined, {
    enabled: true,
  });
  const pullRequestResponse = useEnvironmentPullRequest(environmentId, {
    enabled: true,
  });
  const workspace =
    status.data?.outcome === "available" ? status.data.workspace : null;
  const pullRequest = getEnvironmentPullRequestFromResponse(
    pullRequestResponse.data,
  );
  return (
    <article className="rounded-md border border-border/70 bg-canvas">
      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
        <Icon name="GitBranch" className="size-3.5 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium">
          {label}
        </span>
        <span className="truncate text-xs text-muted-foreground">
          {workspace?.branch.currentBranch ??
            environment.data?.branchName ??
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
            <p className="text-xs text-muted-foreground">Not a Git repository</p>
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

export function ProjectSourceControlPane({
  projectId,
  environments,
}: {
  projectId: string;
  environments: readonly { id: string; label: string }[];
}) {
  return (
    <div className="min-h-0 flex-1 overflow-auto p-2">
      {environments.length === 0 ? (
        <ProjectSourceSummary projectId={projectId} />
      ) : (
        <div className="space-y-2">
          {environments.map((environment) => (
            <EnvironmentSourceSummary
              key={environment.id}
              environmentId={environment.id}
              label={environment.label}
            />
          ))}
        </div>
      )}
    </div>
  );
}
