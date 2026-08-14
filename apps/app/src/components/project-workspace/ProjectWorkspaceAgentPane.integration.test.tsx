// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectWorkspaceAgentPane } from "./ProjectWorkspaceAgentPane";

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ refetchQueries: vi.fn() }),
}));
vi.mock("@/lib/plugin-sdk-hooks", () => ({ callPluginRpc: vi.fn() }));
vi.mock("@/views/thread-detail/ThreadDetailView", () => ({
  ThreadDetailView: () => <div data-testid="thread-detail" />,
}));
vi.mock("@/components/plugin/PluginNewThreadComposer", () => ({
  PluginNewThreadComposer: () => <div data-testid="composer" />,
}));
vi.mock("@/components/dialogs/WorkingCopyManagerDialog", () => ({
  WorkingCopyManagerDialog: () => null,
}));
vi.mock("@/hooks/queries/environment-queries", () => ({
  useEnvironments: () => ({ data: [] }),
  useEnvironment: () => ({
    data: {
      name: "build-worktree",
      path: "/worktrees/build-worktree",
      isGitRepo: true,
      isWorktree: true,
      branchName: "codex/build-worktree",
      baseBranch: "main",
      mergeBaseBranch: "main",
    },
  }),
  useEnvironmentWorkStatus: () => ({ data: undefined }),
}));

afterEach(cleanup);

describe("ProjectWorkspaceAgentPane header integration", () => {
  it("keeps workspace-detail double clicks from toggling pane focus", () => {
    const onToggleFocus = vi.fn();
    render(
      <ProjectWorkspaceAgentPane
        label="Build"
        role="builder"
        projectId="proj_one"
        projectName="One"
        taskKey="ONE-1"
        environmentId="env_one"
        threadId="thread_one"
        workspaceTabId="workspace_one"
        isFocused
        isTopRow
        onActivate={() => undefined}
        onNavigate={() => undefined}
        onAgentStarted={() => undefined}
        onToggleFocus={onToggleFocus}
      />,
    );

    fireEvent.doubleClick(
      screen.getByRole("button", { name: "Build workspace details" }),
    );
    expect(onToggleFocus).not.toHaveBeenCalled();

    fireEvent.doubleClick(screen.getByRole("heading", { name: "Build" }));
    expect(onToggleFocus).toHaveBeenCalledTimes(1);
  });
});
