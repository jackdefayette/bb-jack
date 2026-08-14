// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useCallback, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ProjectWorkspaceTab,
  ProjectWorkspaceTabUpdate,
} from "./ProjectWorkspaceTabsProvider";
import {
  buildWorkspaceEnvironments,
  ProjectWorkspaceGrid,
} from "./ProjectWorkspaceGrid";

const browserDeck = vi.hoisted(() => vi.fn());
const projectPaths = vi.hoisted(() => vi.fn());
const projectStatus = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ refetchQueries: vi.fn() }),
}));

vi.mock("@/views/thread-detail/ThreadDetailView", () => ({
  ThreadDetailView: ({ threadId }: { threadId: string }) => (
    <div data-testid={`thread-${threadId}`}>{threadId}</div>
  ),
}));

vi.mock("@/components/plugin/PluginNewThreadComposer", () => ({
  PluginNewThreadComposer: ({ draftKey }: { draftKey: string }) => (
    <div data-testid={`ready-${draftKey}`} />
  ),
}));

vi.mock("@/components/secondary-panel/BrowserTabDeck", () => ({
  BrowserTabDeck: (props: { canShowNativeBrowserView: boolean }) => {
    browserDeck(props);
    return <div data-testid="browser-deck" />;
  },
}));

vi.mock("@/components/secondary-panel/ThreadSecondaryPanelTabContent", () => ({
  ProjectFilePreviewTabContent: () => <div data-testid="file-preview" />,
  GitDiffTabContent: () => <div data-testid="diff-preview" />,
}));

vi.mock("./ProjectWorkspaceToolsPane", () => ({
  ProjectWorkspaceToolsPane: () => <div data-testid="tools-pane" />,
}));

vi.mock("@/hooks/queries/sidebar-navigation-query", () => ({
  useSidebarNavigation: () => ({
    isLoading: false,
    data: {
      projects: [
        {
          id: "project-1",
          name: "Example project",
          threads: [
            { id: "thread-a", environmentId: "environment-1" },
            { id: "thread-b", environmentId: "environment-2" },
          ],
        },
      ],
    },
  }),
}));

vi.mock("@/hooks/queries/environment-queries", () => ({
  useEnvironments: () => ({ data: [] }),
  useEnvironment: () => ({ data: { isGitRepo: true, baseBranch: "main" } }),
  useEnvironmentWorkStatus: () => ({ data: undefined }),
}));

vi.mock("@/components/dialogs/WorkingCopyManagerDialog", () => ({
  WorkingCopyManagerDialog: () => null,
}));

vi.mock("@/hooks/queries/project-queries", () => ({
  useProjectPathSuggestions: (args: unknown) => {
    projectPaths(args);
    return { data: { paths: [] }, isLoading: false };
  },
  useProjectWorkStatus: (args: unknown) => {
    projectStatus(args);
    return {
      data: {
        outcome: "available",
        resolvedSource: { hostId: "host-1", path: "/safe/project" },
        workspace: {
          branch: { currentBranch: "feature", defaultBranch: "main" },
        },
      },
      isLoading: false,
      isError: false,
    };
  },
}));

const BASE_TAB: ProjectWorkspaceTab = {
  id: "workspace-1",
  projectId: "project-1",
  projectName: "Example project",
  primaryThreadId: "thread-a",
  reviewThreadId: "thread-b",
  focusMode: "grid",
  toolsView: "tasks",
  inspectorView: "browser",
  inspectorEnvironmentId: "environment-1",
  inspectorEnvironmentPinned: false,
  inspectorFilePath: null,
  rowSplitPercent: 64,
  topColumnSplitPercent: 50,
  bottomColumnSplitPercent: 50,
  primaryTaskKey: null,
  reviewTaskKey: null,
  browserTab: {
    id: "browser:environment-1:test",
    kind: "browser",
    environmentId: "environment-1",
    title: null,
    url: "",
  },
};

function Harness({
  initialTab = BASE_TAB,
}: {
  initialTab?: ProjectWorkspaceTab;
}) {
  const [tab, setTab] = useState(initialTab);
  const updateTab = useCallback(
    (_tabId: string, patch: ProjectWorkspaceTabUpdate) => {
      setTab((current) => ({ ...current, ...patch }));
    },
    [],
  );
  return <ProjectWorkspaceGrid isActive tab={tab} updateTab={updateTab} />;
}

afterEach(() => {
  cleanup();
  browserDeck.mockClear();
  projectPaths.mockClear();
  projectStatus.mockClear();
});

describe("ProjectWorkspaceGrid", () => {
  it("deduplicates one environment shared by both workspace agents", () => {
    expect(buildWorkspaceEnvironments("env_shared", "env_shared")).toEqual([
      { id: "env_shared", label: "Build & Agent 2 environment" },
    ]);
  });
  it("renders four quadrants and never falls back stale roles to unrelated threads", async () => {
    render(
      <Harness
        initialTab={{
          ...BASE_TAB,
          primaryThreadId: "deleted-primary",
          reviewThreadId: "deleted-review",
        }}
      />,
    );

    expect(screen.getByRole("heading", { name: "Build" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Agent 2" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Inspector" })).toBeTruthy();
    expect(screen.getByTestId("tools-pane")).toBeTruthy();
    const workspace = screen.getByRole("main", {
      name: "Example project project workspace",
    });
    expect(workspace.dataset.rowSplitPercent).toBe("64");
    expect(workspace.className).toContain("bb-project-workspace-surface");
    expect(workspace.className).toContain("bg-workspace-border");
    expect(
      Array.from(
        workspace.querySelectorAll(":scope > [data-workspace-quadrant]"),
      ).map((child) => child.getAttribute("data-workspace-quadrant")),
    ).toEqual(["primary", "review", "browser", "tools"]);
    await waitFor(() => {
      expect(
        screen.getByTestId("ready-project-workspace:workspace-1:builder"),
      ).toBeTruthy();
      expect(
        screen.getByTestId("ready-project-workspace:workspace-1:reviewer"),
      ).toBeTruthy();
    });
    expect(screen.queryByTestId("thread-thread-a")).toBeNull();
    expect(screen.queryByTestId("thread-thread-b")).toBeNull();
  });

  it("resizes each seam from the keyboard and persists the layout", () => {
    render(<Harness />);
    const workspace = screen.getByRole("main", {
      name: "Example project project workspace",
    });

    fireEvent.keyDown(
      screen.getByRole("separator", { name: "Resize chat and tools rows" }),
      { key: "ArrowDown" },
    );
    fireEvent.keyDown(
      screen.getByRole("separator", { name: "Resize top chat panes" }),
      { key: "ArrowRight" },
    );
    fireEvent.keyDown(
      screen.getByRole("separator", {
        name: "Resize inspector and project tools",
      }),
      { key: "ArrowLeft" },
    );

    expect(workspace.dataset.rowSplitPercent).toBe("67");
    expect(workspace.dataset.topColumnSplitPercent).toBe("53");
    expect(workspace.dataset.bottomColumnSplitPercent).toBe("47");
    expect(
      screen
        .getByRole("separator", { name: "Resize chat and tools rows" })
        .getAttribute("aria-valuenow"),
    ).toBe("67");
  });

  it("focuses and restores the left column without remounting right panes", () => {
    render(<Harness />);
    const reviewPane = screen
      .getByRole("heading", { name: "Agent 2" })
      .closest("[data-project-workspace-pane]");
    const toolsPane = screen.getByTestId("tools-pane");

    fireEvent.doubleClick(screen.getByRole("heading", { name: "Inspector" }));

    expect(
      screen.getByRole("main", { name: "Example project project workspace" })
        .dataset.focusMode,
    ).toBe("browser");
    expect(
      screen
        .getByRole("heading", { name: "Agent 2" })
        .closest("[data-project-workspace-pane]"),
    ).toBe(reviewPane);
    expect(screen.getByTestId("tools-pane")).toBe(toolsPane);

    fireEvent.click(
      screen.getByRole("button", { name: "Restore four quadrants" }),
    );
    expect(
      screen.getByRole("main", { name: "Example project project workspace" })
        .dataset.focusMode,
    ).toBe("grid");
  });

  it("gates the native browser while primary focus hides its mounted tile", () => {
    render(<Harness />);
    expect(browserDeck.mock.lastCall?.[0].canShowNativeBrowserView).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Focus build chat" }));
    expect(browserDeck.mock.lastCall?.[0].canShowNativeBrowserView).toBe(false);
    expect(screen.getByTestId("browser-deck")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "Restore four quadrants" }),
    );
    expect(browserDeck.mock.lastCall?.[0].canShowNativeBrowserView).toBe(true);
  });

  it("keeps an explicit project checkout pinned while the active agent changes", async () => {
    render(<Harness />);
    const selector = screen.getByRole("combobox", {
      name: "Inspector environment",
    });

    fireEvent.change(selector, { target: { value: "__project_checkout__" } });
    await waitFor(() =>
      expect(selector).toHaveProperty("value", "__project_checkout__"),
    );
    expect(projectPaths).toHaveBeenLastCalledWith(
      expect.objectContaining({ environmentId: null, hostId: null }),
    );
    expect(projectStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ environmentId: null, hostId: null }),
    );

    fireEvent.pointerDown(screen.getByRole("heading", { name: "Agent 2" }));
    await waitFor(() =>
      expect(selector).toHaveProperty("value", "__project_checkout__"),
    );
    expect(projectPaths).toHaveBeenLastCalledWith(
      expect.objectContaining({ environmentId: null, hostId: null }),
    );
  });
});
