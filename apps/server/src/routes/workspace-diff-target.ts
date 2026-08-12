import type {
  EnvironmentDiffFileQuery,
  EnvironmentDiffQuery,
} from "@bb/server-contract";

export function toWorkspaceDiffTarget(query: EnvironmentDiffQuery) {
  switch (query.target) {
    case "uncommitted":
      return { type: "uncommitted" as const };
    case "branch_committed":
      return {
        type: "branch_committed" as const,
        mergeBaseBranch: query.mergeBaseBranch,
      };
    case "all":
      return { type: "all" as const, mergeBaseBranch: query.mergeBaseBranch };
    case "commit":
      return { type: "commit" as const, sha: query.sha };
  }
}

export function resolveDiffFileRef(
  query: EnvironmentDiffFileQuery,
): string | undefined {
  switch (query.target) {
    case "uncommitted":
      return query.side === "old" ? "HEAD" : undefined;
    case "branch_committed":
      return query.side === "old" ? query.mergeBaseRef : "HEAD";
    case "all":
      return query.side === "old" ? query.mergeBaseRef : undefined;
    case "commit":
      return query.side === "old" ? `${query.sha}^` : query.sha;
  }
}
