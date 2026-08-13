// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectWorkspaceTab } from "./ProjectWorkspaceTabsProvider";
import { ProjectWorkspaceBrowserPane } from "./ProjectWorkspaceBrowserPane";

interface MockProjectStatus {
  data?: {
    outcome: string;
    workspace?: {
      branch: { currentBranch: string; defaultBranch: string };
    };
  };
  isLoading: boolean;
  isError: boolean;
}

const mocks = vi.hoisted(() => ({
  browser: vi.fn(),
  paths: vi.fn(),
  environment: vi.fn(),
  file: vi.fn(),
  diff: vi.fn(),
  projectStatus: vi.fn(
    (..._args: unknown[]): MockProjectStatus => ({
      data: {
        outcome: "available",
        workspace: { branch: { currentBranch: "main", defaultBranch: "main" } },
      },
      isLoading: false,
      isError: false,
    }),
  ),
}));

vi.mock("./ProjectWorkspacePaneFrame", () => ({
  ProjectWorkspacePaneFrame: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock("@/components/secondary-panel/BrowserTabDeck", () => ({
  BrowserTabDeck: (props: unknown) => {
    mocks.browser(props);
    return <div data-testid="browser" />;
  },
}));
vi.mock("@/hooks/queries/project-queries", () => ({
  useProjectPathSuggestions: (args: unknown) => {
    mocks.paths(args);
    return { data: { paths: [{ path: "src/demo.ts" }] }, isLoading: false };
  },
  useProjectWorkStatus: (...args: unknown[]) => mocks.projectStatus(...args),
}));
vi.mock("@/hooks/queries/environment-queries", () => ({
  useEnvironment: (id: unknown) => {
    mocks.environment(id);
    return { data: { isGitRepo: true, baseBranch: "main" } };
  },
}));
vi.mock("@/components/secondary-panel/ThreadSecondaryPanelTabContent", () => ({
  ProjectFilePreviewTabContent: (props: unknown) => {
    mocks.file(props);
    return <div data-testid="file" />;
  },
  GitDiffTabContent: (props: unknown) => {
    mocks.diff(props);
    return <div data-testid="diff" />;
  },
}));

const TAB: ProjectWorkspaceTab = {
  id: "workspace_one",
  projectId: "proj_one",
  projectName: "One",
  primaryThreadId: "thr_builder",
  reviewThreadId: "thr_reviewer",
  focusMode: "grid",
  toolsView: "tasks",
  inspectorView: "browser",
  inspectorEnvironmentId: "env_builder",
  inspectorEnvironmentPinned: false,
  inspectorFilePath: "src/demo.ts",
  rowSplitPercent: 64,
  topColumnSplitPercent: 50,
  bottomColumnSplitPercent: 50,
  primaryTaskKey: "ONE-1",
  reviewTaskKey: "ONE-2",
  browserTab: {
    id: "browser:env_builder",
    kind: "browser",
    environmentId: "env_builder",
    title: null,
    url: "",
  },
};

beforeEach(() => {
  mocks.browser.mockClear();
  mocks.paths.mockClear();
  mocks.environment.mockClear();
  mocks.file.mockClear();
  mocks.diff.mockClear();
  mocks.projectStatus.mockClear();
});

afterEach(cleanup);

describe("ProjectWorkspaceBrowserPane", () => {
  it("keeps Browser, Files, and Diff mounted and binds Files/Diff to the exact selected environment", () => {
    const updateTab = vi.fn();
    const view = render(
      <ProjectWorkspaceBrowserPane
        backgroundAgentState={null}
        canShowNativeBrowserView
        environmentId="env_builder"
        environmentOptions={[
          { id: "env_builder", label: "Build worktree" },
          { id: "env_reviewer", label: "Review worktree" },
        ]}
        projectId="proj_one"
        isFocused={false}
        onToggleFocus={() => undefined}
        tab={TAB}
        updateTab={updateTab}
      />,
    );

    expect(screen.getByTestId("browser")).toBeTruthy();
    expect(
      document.querySelector("[data-project-workspace-inspector]")?.className,
    ).toContain("bg-workspace-canvas");
    expect(screen.getByTestId("file")).toBeTruthy();
    expect(screen.getByTestId("diff")).toBeTruthy();
    expect(
      document.querySelector("[data-project-workspace-files]")?.className,
    ).toContain("flex");
    expect(
      document.querySelector("[data-project-workspace-file-preview-scroll]")
        ?.className,
    ).toContain("overflow-auto");
    expect(screen.getByRole("button", { name: "Changes" })).toBeTruthy();
    expect(mocks.paths).toHaveBeenLastCalledWith(
      expect.objectContaining({
        projectId: "proj_one",
        environmentId: "env_builder",
      }),
    );
    expect(mocks.file).toHaveBeenLastCalledWith(
      expect.objectContaining({
        projectId: "proj_one",
        environmentId: "env_builder",
        activePath: "src/demo.ts",
      }),
    );
    expect(mocks.diff).toHaveBeenLastCalledWith(
      expect.objectContaining({ environmentId: "env_builder" }),
    );

    fireEvent.change(
      screen.getByRole("combobox", { name: "Inspector environment" }),
      { target: { value: "env_reviewer" } },
    );
    expect(updateTab).toHaveBeenLastCalledWith("workspace_one", {
      inspectorEnvironmentId: "env_reviewer",
      inspectorEnvironmentPinned: true,
    });

    fireEvent.change(
      screen.getByRole("combobox", { name: "Inspector environment" }),
      { target: { value: "__project_checkout__" } },
    );
    expect(updateTab).toHaveBeenLastCalledWith("workspace_one", {
      inspectorEnvironmentId: null,
      inspectorEnvironmentPinned: true,
    });

    fireEvent.change(
      screen.getByRole("combobox", { name: "Inspector environment" }),
      { target: { value: "__follow_active__" } },
    );
    expect(updateTab).toHaveBeenLastCalledWith("workspace_one", {
      inspectorEnvironmentPinned: false,
    });

    view.rerender(
      <ProjectWorkspaceBrowserPane
        backgroundAgentState={null}
        canShowNativeBrowserView
        environmentId="env_reviewer"
        environmentOptions={[
          { id: "env_builder", label: "Build worktree" },
          { id: "env_reviewer", label: "Review worktree" },
        ]}
        projectId="proj_one"
        isFocused={false}
        onToggleFocus={() => undefined}
        tab={TAB}
        updateTab={updateTab}
      />,
    );
    expect(mocks.browser).toHaveBeenLastCalledWith(
      expect.objectContaining({ environmentId: "env_reviewer" }),
    );
    expect(updateTab).toHaveBeenLastCalledWith("workspace_one", {
      browserTab: expect.objectContaining({ environmentId: "env_reviewer" }),
    });
  });

  it("browses the project checkout and classifies a non-repository diff without an agent environment", () => {
    mocks.projectStatus.mockReturnValueOnce({
      data: { outcome: "not_applicable" },
      isLoading: false,
      isError: false,
    });
    render(
      <ProjectWorkspaceBrowserPane
        backgroundAgentState={null}
        canShowNativeBrowserView={false}
        environmentId={null}
        environmentOptions={[]}
        projectId="proj_one"
        isFocused={false}
        onToggleFocus={() => undefined}
        tab={{ ...TAB, inspectorView: "diff", inspectorEnvironmentId: null }}
        updateTab={vi.fn()}
      />,
    );

    expect(mocks.paths).toHaveBeenLastCalledWith(
      expect.objectContaining({
        projectId: "proj_one",
        environmentId: null,
        hostId: null,
      }),
    );
    expect(mocks.file).toHaveBeenLastCalledWith(
      expect.objectContaining({
        projectId: "proj_one",
        environmentId: null,
        hostId: null,
      }),
    );
    expect(screen.getByText("Not a Git repository.")).toBeTruthy();
    expect(
      screen.getByRole("option", { name: "Project checkout" }),
    ).toBeTruthy();
    expect(mocks.diff).not.toHaveBeenCalled();
  });

  it("opens a real project-scoped diff when the default checkout is Git", () => {
    mocks.projectStatus.mockReturnValueOnce({
      data: {
        outcome: "available",
        workspace: {
          branch: { currentBranch: "feature", defaultBranch: "main" },
        },
      },
      isLoading: false,
      isError: false,
    });
    render(
      <ProjectWorkspaceBrowserPane
        backgroundAgentState={null}
        canShowNativeBrowserView={false}
        environmentId={null}
        environmentOptions={[]}
        projectId="proj_one"
        isFocused={false}
        onToggleFocus={() => undefined}
        tab={{ ...TAB, inspectorView: "diff", inspectorEnvironmentId: null }}
        updateTab={vi.fn()}
      />,
    );

    expect(mocks.diff).toHaveBeenLastCalledWith(
      expect.objectContaining({
        environmentId: undefined,
        projectId: "proj_one",
        target: expect.objectContaining({ mergeBaseBranch: "main" }),
      }),
    );
  });
});
