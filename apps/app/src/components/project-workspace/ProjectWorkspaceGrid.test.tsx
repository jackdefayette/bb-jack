// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useCallback, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ProjectWorkspaceTab,
  ProjectWorkspaceTabUpdate,
} from "./ProjectWorkspaceTabsProvider";
import { ProjectWorkspaceGrid } from "./ProjectWorkspaceGrid";

const browserDeck = vi.hoisted(() => vi.fn());

vi.mock("@/views/thread-detail/ThreadDetailView", () => ({
  ThreadDetailView: ({ threadId }: { threadId: string }) => (
    <div data-testid={`thread-${threadId}`}>{threadId}</div>
  ),
}));

vi.mock("@/components/secondary-panel/BrowserTabDeck", () => ({
  BrowserTabDeck: (props: { canShowNativeBrowserView: boolean }) => {
    browserDeck(props);
    return <div data-testid="browser-deck" />;
  },
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

const BASE_TAB: ProjectWorkspaceTab = {
  id: "workspace-1",
  projectId: "project-1",
  projectName: "Example project",
  primaryThreadId: "thread-a",
  reviewThreadId: "thread-b",
  focusMode: "grid",
  toolsView: "tasks",
  browserTab: {
    id: "browser:environment-1:test",
    kind: "browser",
    environmentId: "environment-1",
    title: null,
    url: "",
  },
};

function Harness({ initialTab = BASE_TAB }: { initialTab?: ProjectWorkspaceTab }) {
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
});

describe("ProjectWorkspaceGrid", () => {
  it("renders the fixed four quadrants and repairs stale agent ids", async () => {
    render(
      <Harness
        initialTab={{
          ...BASE_TAB,
          primaryThreadId: "deleted-primary",
          reviewThreadId: "deleted-review",
        }}
      />,
    );

    expect(screen.getByRole("heading", { name: "Primary Agent" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Review Agent" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Browser" })).toBeTruthy();
    expect(screen.getByTestId("tools-pane")).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByTestId("thread-thread-a")).toBeTruthy();
      expect(screen.getByTestId("thread-thread-b")).toBeTruthy();
    });
  });

  it("focuses and restores the left column without remounting right panes", () => {
    render(<Harness />);
    const reviewPane = screen
      .getByRole("heading", { name: "Review Agent" })
      .closest("[data-project-workspace-pane]");
    const toolsPane = screen.getByTestId("tools-pane");

    fireEvent.doubleClick(screen.getByRole("heading", { name: "Browser" }));

    expect(
      screen.getByRole("main", { name: "Example project project workspace" })
        .dataset.focusMode,
    ).toBe("browser");
    expect(
      screen
        .getByRole("heading", { name: "Review Agent" })
        .closest("[data-project-workspace-pane]"),
    ).toBe(reviewPane);
    expect(screen.getByTestId("tools-pane")).toBe(toolsPane);

    fireEvent.click(screen.getByRole("button", { name: "Restore four quadrants" }));
    expect(
      screen.getByRole("main", { name: "Example project project workspace" })
        .dataset.focusMode,
    ).toBe("grid");
  });

  it("gates the native browser while primary focus hides its mounted tile", () => {
    render(<Harness />);
    expect(browserDeck.mock.lastCall?.[0].canShowNativeBrowserView).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Focus primary agent" }));
    expect(browserDeck.mock.lastCall?.[0].canShowNativeBrowserView).toBe(false);
    expect(screen.getByTestId("browser-deck")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Restore four quadrants" }));
    expect(browserDeck.mock.lastCall?.[0].canShowNativeBrowserView).toBe(true);
  });
});
