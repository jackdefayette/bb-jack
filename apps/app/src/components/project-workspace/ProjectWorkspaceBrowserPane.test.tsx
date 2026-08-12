// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { ProjectWorkspaceTab } from "./ProjectWorkspaceTabsProvider";
import { ProjectWorkspaceBrowserPane } from "./ProjectWorkspaceBrowserPane";

const mocks = vi.hoisted(() => ({
  browser: vi.fn(),
  paths: vi.fn(),
  environment: vi.fn(),
  file: vi.fn(),
  diff: vi.fn(),
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

describe("ProjectWorkspaceBrowserPane", () => {
  it("keeps Browser, Files, and Diff mounted and binds Files/Diff to the exact selected environment", () => {
    const updateTab = vi.fn();
    const view = render(
      <ProjectWorkspaceBrowserPane
        backgroundAgentState={null}
        canShowNativeBrowserView
        environmentId="env_builder"
        environmentOptions={[
          { id: "env_builder", label: "Builder worktree" },
          { id: "env_reviewer", label: "Reviewer worktree" },
        ]}
        projectId="proj_one"
        isFocused={false}
        onToggleFocus={() => undefined}
        tab={TAB}
        updateTab={updateTab}
      />,
    );

    expect(screen.getByTestId("browser")).toBeTruthy();
    expect(screen.getByTestId("file")).toBeTruthy();
    expect(screen.getByTestId("diff")).toBeTruthy();
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

    view.rerender(
      <ProjectWorkspaceBrowserPane
        backgroundAgentState={null}
        canShowNativeBrowserView
        environmentId="env_reviewer"
        environmentOptions={[
          { id: "env_builder", label: "Builder worktree" },
          { id: "env_reviewer", label: "Reviewer worktree" },
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
});
