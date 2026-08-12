// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectSourceControlPane } from "./ProjectSourceControlPane";

const mocks = vi.hoisted(() => ({
  sidebar: {} as Record<string, unknown>,
  branches: {} as Record<string, unknown>,
  status: {} as Record<string, unknown>,
  pullRequest: {} as Record<string, unknown>,
}));

vi.mock("@/hooks/queries/sidebar-navigation-query", () => ({
  useSidebarNavigation: () => mocks.sidebar,
}));
vi.mock("@/hooks/queries/project-queries", () => ({
  useProjectSourceBranches: () => mocks.branches,
}));
vi.mock("@/hooks/queries/thread-queries", () => ({
  useThreads: () => ({ data: [], isLoading: false, isError: false }),
}));
vi.mock("@/hooks/queries/environment-queries", () => ({
  useEnvironmentWorkStatus: () => mocks.status,
  useEnvironmentPullRequest: () => mocks.pullRequest,
  getEnvironmentPullRequestFromResponse: (response: {
    outcome: string;
    pullRequest?: unknown;
  }) => (response?.outcome === "available" ? response.pullRequest : null),
}));

const thread = {
  id: "thr_1",
  projectId: "proj_demo",
  environmentId: "env_1",
  environmentHostId: "host_1",
  environmentName: "Feature workspace",
  environmentBranchName: "codex/feature",
  title: "Build feature",
  titleFallback: null,
  updatedAt: 2,
};

beforeEach(() => {
  mocks.sidebar = {
    isLoading: false,
    isError: false,
    data: {
      projects: [
        {
          id: "proj_demo",
          sources: [
            {
              id: "src_1",
              hostId: "host_1",
              isDefault: true,
              type: "local_path",
              path: "/repo",
            },
          ],
          threads: [thread],
        },
      ],
      personalProject: { id: "proj_personal", sources: [], threads: [] },
    },
  };
  mocks.branches = {
    isLoading: false,
    isError: false,
    data: { branches: ["main", "codex/feature"] },
  };
  mocks.status = {
    isLoading: false,
    isError: false,
    data: {
      outcome: "available",
      workspace: {
        branch: { currentBranch: "codex/feature", defaultBranch: "main" },
        workingTree: {
          files: [{ path: "src/feature.ts", status: "M" }],
        },
        mergeBase: {
          commits: [
            { sha: "abc123", shortSha: "abc123", subject: "Build feature" },
          ],
        },
      },
    },
  };
  mocks.pullRequest = {
    isLoading: false,
    data: {
      outcome: "available",
      pullRequest: {
        number: 42,
        title: "Build project workspace",
        state: "open",
        url: "https://github.com/example/repo/pull/42",
      },
    },
  };
});

describe("ProjectSourceControlPane", () => {
  it("shows truthful changes, branches, pull requests, and history", () => {
    render(<ProjectSourceControlPane projectId="proj_demo" />);
    expect(screen.getByText("Branches")).toBeTruthy();
    expect(screen.getAllByText("codex/feature").length).toBeGreaterThan(0);
    expect(screen.getByText("Changes")).toBeTruthy();
    expect(screen.getByText("src/feature.ts")).toBeTruthy();
    expect(screen.getByText("PRs")).toBeTruthy();
    expect(screen.getByText("Build project workspace")).toBeTruthy();
    expect(screen.getByText("History")).toBeTruthy();
    expect(screen.getByText("Build feature")).toBeTruthy();
  });

  it("reports an offline branch source without inventing branch state", () => {
    mocks.branches = { isLoading: false, isError: true, data: undefined };
    render(<ProjectSourceControlPane projectId="proj_demo" />);
    expect(
      screen.getByText("Branches are unavailable while the host is offline."),
    ).toBeTruthy();
  });
});
