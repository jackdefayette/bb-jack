// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import {
  ACTIVE_PROJECT_WORKSPACE_TAB_STORAGE_KEY,
  PROJECT_WORKSPACE_TABS_STORAGE_KEY,
  ProjectWorkspaceTabsProvider,
  type ProjectWorkspaceTab,
} from "./ProjectWorkspaceTabsProvider";
import { ProjectWorkspaceTabBar } from "./ProjectWorkspaceTabBar";

vi.mock("@/hooks/queries/sidebar-navigation-query", () => ({
  useSidebarNavigation: () => ({
    data: {
      projects: [
        { id: "project-one", name: "One" },
        { id: "project-two", name: "Two" },
      ],
    },
  }),
}));

const TABS: ProjectWorkspaceTab[] = [
  {
    id: "workspace-one",
    projectId: "project-one",
    projectName: "One",
    primaryThreadId: null,
    reviewThreadId: null,
    focusMode: "grid",
    toolsView: "tasks",
    inspectorView: "browser",
    inspectorEnvironmentId: null,
    inspectorEnvironmentPinned: false,
    inspectorFilePath: null,
    rowSplitPercent: 64,
    topColumnSplitPercent: 50,
    bottomColumnSplitPercent: 50,
    primaryTaskKey: null,
    reviewTaskKey: null,
    browserTab: null,
  },
  {
    id: "workspace-two",
    projectId: "project-two",
    projectName: "Two",
    primaryThreadId: null,
    reviewThreadId: null,
    focusMode: "grid",
    toolsView: "source-control",
    inspectorView: "diff",
    inspectorEnvironmentId: null,
    inspectorEnvironmentPinned: false,
    inspectorFilePath: null,
    rowSplitPercent: 64,
    topColumnSplitPercent: 50,
    bottomColumnSplitPercent: 50,
    primaryTaskKey: null,
    reviewTaskKey: null,
    browserTab: null,
  },
];

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}</output>;
}

function renderTabBar(activeTabId: string) {
  const activeTab = TABS.find((tab) => tab.id === activeTabId) ?? TABS[0];
  return render(
    <MemoryRouter
      initialEntries={[
        `/projects/${activeTab?.projectId ?? "project-one"}/workspaces/${encodeURIComponent(activeTabId)}`,
      ]}
    >
      <ProjectWorkspaceTabsProvider>
        <ProjectWorkspaceTabBar activeTabId={activeTabId} />
        <LocationProbe />
      </ProjectWorkspaceTabsProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.localStorage.setItem(
    PROJECT_WORKSPACE_TABS_STORAGE_KEY,
    JSON.stringify(TABS),
  );
  window.sessionStorage.setItem(
    ACTIVE_PROJECT_WORKSPACE_TAB_STORAGE_KEY,
    "workspace-two",
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ProjectWorkspaceTabBar", () => {
  it("cycles to the previous workspace with Shift+Tab from the workspace surface", async () => {
    renderTabBar("workspace-two");

    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });

    await waitFor(() =>
      expect(screen.getByTestId("location").textContent).toBe(
        "/projects/project-one/workspaces/workspace-one",
      ),
    );
  });

  it("supports conventional Control+Tab cycling without stealing tab focus", async () => {
    renderTabBar("workspace-one");

    fireEvent.keyDown(window, { key: "Tab", ctrlKey: true });

    await waitFor(() =>
      expect(screen.getByTestId("location").textContent).toBe(
        "/projects/project-two/workspaces/workspace-two",
      ),
    );
  });
});
