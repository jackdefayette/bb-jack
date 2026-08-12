// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectWorkspaceEnvironmentRibbon } from "./ProjectWorkspaceEnvironmentRibbon";

const mocks = vi.hoisted(() => ({
  environment: vi.fn(),
  status: vi.fn(),
}));

vi.mock("@/hooks/queries/environment-queries", () => ({
  useEnvironment: (...args: unknown[]) => mocks.environment(...args),
  useEnvironmentWorkStatus: (...args: unknown[]) => mocks.status(...args),
}));

afterEach(() => {
  cleanup();
  mocks.environment.mockReset();
  mocks.status.mockReset();
});

describe("ProjectWorkspaceEnvironmentRibbon", () => {
  it("keeps exact environment and ownership facts in a compact header popover", () => {
    mocks.environment.mockReturnValue({
      data: {
        name: "build-safe-change",
        path: "/worktrees/build-safe-change",
        isGitRepo: true,
        isWorktree: true,
        branchName: "codex/build-safe-change",
        baseBranch: "main",
        mergeBaseBranch: "main",
      },
    });
    mocks.status.mockReturnValue({
      data: {
        outcome: "available",
        workspace: {
          branch: { currentBranch: "codex/build-safe-change" },
          workingTree: { hasUncommittedChanges: true },
          mergeBase: {
            mergeBaseBranch: "main",
            aheadCount: 2,
            behindCount: 1,
          },
        },
      },
    });

    render(
      <ProjectWorkspaceEnvironmentRibbon
        environmentId="env_build"
        projectName="Safe repository"
        role="builder"
        taskKey="SAFE-12"
        threadId="thread_build"
      />,
    );

    const trigger = screen.getByRole("button", {
      name: "Build workspace details",
    });
    expect(trigger.textContent).toContain("build-safe-change");
    fireEvent.click(trigger);

    expect(screen.getByText("Safe repository")).toBeTruthy();
    expect(screen.getByText("/worktrees/build-safe-change")).toBeTruthy();
    expect(
      screen.getAllByText("codex/build-safe-change").length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText("main").length).toBeGreaterThan(0);
    expect(screen.getByText("Build")).toBeTruthy();
    expect(screen.getByText("SAFE-12")).toBeTruthy();
    expect(screen.getByText("thread_build")).toBeTruthy();
    expect(screen.getByText("Dirty")).toBeTruthy();
    expect(screen.getByText("2 ahead / 1 behind")).toBeTruthy();
    expect(
      screen.getByText("Safe — worktree retained; no cleanup performed"),
    ).toBeTruthy();
  });

  it("renders a truthful no-environment state without inventing Git metadata", () => {
    mocks.environment.mockReturnValue({ data: undefined });
    mocks.status.mockReturnValue({ data: undefined });

    render(
      <ProjectWorkspaceEnvironmentRibbon
        environmentId={null}
        projectName="Project checkout"
        role="reviewer"
        taskKey={null}
        threadId="thread_review"
      />,
    );

    const trigger = screen.getByRole("button", {
      name: "Review workspace details",
    });
    expect(trigger.textContent).toContain("No environment");
    fireEvent.click(trigger);

    expect(screen.getByText("Not attached")).toBeTruthy();
    expect(screen.getByText("Review")).toBeTruthy();
    expect(screen.getAllByText("Unavailable").length).toBeGreaterThanOrEqual(6);
    expect(
      screen.getByText("Safe — no environment attached; no cleanup performed"),
    ).toBeTruthy();
    expect(mocks.environment).toHaveBeenCalledWith(null, { enabled: false });
  });

  it("describes a project checkout without calling it a worktree", () => {
    mocks.environment.mockReturnValue({
      data: {
        name: "Project checkout",
        path: "/projects/safe-repository",
        isGitRepo: true,
        isWorktree: false,
        branchName: "main",
        baseBranch: "main",
        mergeBaseBranch: "main",
      },
    });
    mocks.status.mockReturnValue({ data: undefined });

    render(
      <ProjectWorkspaceEnvironmentRibbon
        environmentId="env_checkout"
        projectName="Safe repository"
        role="builder"
        taskKey="SAFE-13"
        threadId="thread_checkout"
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Build workspace details" }),
    );
    expect(
      screen.getByText(
        "Safe — checkout/environment remains; no cleanup performed",
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/worktree retained/u)).toBeNull();
  });
});
