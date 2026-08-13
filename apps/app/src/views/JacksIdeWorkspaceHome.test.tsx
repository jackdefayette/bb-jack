// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  JacksIdeThreadWorkspace,
  JacksIdeWorkspaceHome,
} from "./JacksIdeWorkspaceNavigation";

const workspaceState = vi.hoisted(() => ({
  activeTabId: null as string | null,
  tabs: [] as Array<{
    id: string;
    projectId: string;
    projectName: string;
    primaryThreadId?: string | null;
  }>,
  openTab: vi.fn(),
  selectTab: vi.fn(),
  updateTab: vi.fn(),
}));

const navigationState = vi.hoisted(() => ({
  data: {
    projects: [] as Array<{ id: string; name: string }>,
  },
  isLoading: false,
}));

vi.mock("@/components/project-workspace/ProjectWorkspaceTabsProvider", () => ({
  useProjectWorkspaceTabs: () => workspaceState,
}));

vi.mock("@/hooks/queries/sidebar-navigation-query", () => ({
  useSidebarNavigation: () => navigationState,
}));

function renderHome() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route path="/" element={<JacksIdeWorkspaceHome />} />
        <Route
          path="/projects/:projectId/workspaces/:workspaceTabId"
          element={<div>four-pane workspace</div>}
        />
      </Routes>
    </MemoryRouter>,
  );
}

function renderThreadWorkspace() {
  return render(
    <MemoryRouter
      initialEntries={["/projects/proj-enterprise/threads/thread-new"]}
    >
      <Routes>
        <Route
          path="/projects/:projectId/threads/:threadId"
          element={
            <JacksIdeThreadWorkspace
              projectId="proj-enterprise"
              threadId="thread-new"
            />
          }
        />
        <Route
          path="/projects/:projectId/workspaces/:workspaceTabId"
          element={<div>four-pane workspace</div>}
        />
        <Route path="/" element={<div>Jack's IDE workspace home</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("JacksIdeWorkspaceHome", () => {
  afterEach(cleanup);

  beforeEach(() => {
    workspaceState.activeTabId = null;
    workspaceState.tabs = [];
    workspaceState.openTab.mockReset();
    workspaceState.selectTab.mockReset();
    workspaceState.updateTab.mockReset();
    navigationState.data.projects = [];
    navigationState.isLoading = false;
  });

  it("returns the app root to the active four-pane workspace", async () => {
    workspaceState.activeTabId = "workspace-active";
    workspaceState.tabs = [
      {
        id: "workspace-active",
        projectId: "proj-enterprise",
        projectName: "enterprise-architecture-lab",
      },
    ];

    renderHome();

    await waitFor(() =>
      expect(screen.getByText("four-pane workspace")).toBeDefined(),
    );
    expect(workspaceState.selectTab).toHaveBeenCalledWith("workspace-active");
    expect(workspaceState.openTab).not.toHaveBeenCalled();
  });

  it("creates a four-pane tab for the first project when none is open", async () => {
    navigationState.data.projects = [
      { id: "proj-bb", name: "bb-jack" },
      { id: "proj-enterprise", name: "enterprise-architecture-lab" },
    ];
    workspaceState.openTab.mockReturnValue({
      id: "workspace-new",
      projectId: "proj-bb",
      projectName: "bb-jack",
    });

    renderHome();

    await waitFor(() =>
      expect(screen.getByText("four-pane workspace")).toBeDefined(),
    );
    expect(workspaceState.openTab).toHaveBeenCalledWith({
      projectId: "proj-bb",
      projectName: "bb-jack",
    });
    expect(workspaceState.selectTab).toHaveBeenCalledWith("workspace-new");
  });

  it("opens an ordinary thread route in the project's Build quadrant", async () => {
    navigationState.data.projects = [
      { id: "proj-enterprise", name: "enterprise-architecture-lab" },
    ];
    workspaceState.activeTabId = "workspace-enterprise";
    workspaceState.tabs = [
      {
        id: "workspace-enterprise",
        projectId: "proj-enterprise",
        projectName: "enterprise-architecture-lab",
        primaryThreadId: "thread-old",
      },
    ];

    renderThreadWorkspace();

    await waitFor(() =>
      expect(screen.getByText("four-pane workspace")).toBeDefined(),
    );
    expect(workspaceState.updateTab).toHaveBeenCalledWith(
      "workspace-enterprise",
      { primaryThreadId: "thread-new" },
    );
    expect(workspaceState.selectTab).toHaveBeenCalledWith(
      "workspace-enterprise",
    );
  });

  it("returns a stale project thread route to Jack's IDE home", async () => {
    renderThreadWorkspace();

    await waitFor(() =>
      expect(screen.getByText("Jack's IDE workspace home")).toBeDefined(),
    );
    expect(workspaceState.openTab).not.toHaveBeenCalled();
  });
});
