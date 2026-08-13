// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { ProjectWorkspaceTab } from "./ProjectWorkspaceTabsProvider";
import {
  ACTIVE_PROJECT_WORKSPACE_TAB_STORAGE_KEY,
  PROJECT_WORKSPACE_TABS_STORAGE_KEY,
  RECENTLY_CLOSED_PROJECT_WORKSPACE_TABS_STORAGE_KEY,
  ProjectWorkspaceTabsProvider,
  parseRecentlyClosedProjectWorkspaceTabs,
  parseProjectWorkspaceTabs,
  useProjectWorkspaceTabs,
} from "./ProjectWorkspaceTabsProvider";

function wrapper({ children }: { children: ReactNode }) {
  return (
    <ProjectWorkspaceTabsProvider>{children}</ProjectWorkspaceTabsProvider>
  );
}

describe("ProjectWorkspaceTabsProvider", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it("allows duplicate project tabs and persists the active tab per session", () => {
    const { result } = renderHook(() => useProjectWorkspaceTabs(), { wrapper });

    act(() => {
      result.current.createTab({
        projectId: "proj_data",
        projectName: "dataConductor",
      });
      result.current.createTab({
        projectId: "proj_data",
        projectName: "dataConductor",
        toolsView: "source-control",
      });
    });

    expect(result.current.tabs).toHaveLength(2);
    expect(result.current.tabs[0]?.projectId).toBe("proj_data");
    expect(result.current.tabs[1]?.projectId).toBe("proj_data");
    expect(result.current.tabs[1]?.toolsView).toBe("source-control");
    expect(
      window.localStorage.getItem(PROJECT_WORKSPACE_TABS_STORAGE_KEY),
    ).toContain("dataConductor");
    expect(
      window.sessionStorage.getItem(ACTIVE_PROJECT_WORKSPACE_TAB_STORAGE_KEY),
    ).toBe(result.current.activeTabId);
  });

  it("selects an adjacent tab when the active tab closes", () => {
    const { result } = renderHook(() => useProjectWorkspaceTabs(), { wrapper });
    let firstId = "";
    let secondId = "";
    act(() => {
      firstId = result.current.createTab({
        projectId: "proj_one",
        projectName: "One",
      }).id;
      secondId = result.current.createTab({
        projectId: "proj_two",
        projectName: "Two",
      }).id;
    });
    expect(result.current.activeTabId).toBe(secondId);

    act(() => result.current.closeTab(secondId));

    expect(result.current.activeTabId).toBe(firstId);
    expect(result.current.tabs.map((tab) => tab.id)).toEqual([firstId]);
  });

  it("reorders tabs and persists the new order", () => {
    const { result } = renderHook(() => useProjectWorkspaceTabs(), { wrapper });
    let firstId = "";
    let secondId = "";
    let thirdId = "";
    act(() => {
      firstId = result.current.createTab({
        projectId: "proj_one",
        projectName: "One",
      }).id;
      secondId = result.current.createTab({
        projectId: "proj_two",
        projectName: "Two",
      }).id;
      thirdId = result.current.createTab({
        projectId: "proj_three",
        projectName: "Three",
      }).id;
    });

    act(() => result.current.reorderTab(thirdId, firstId));

    expect(result.current.tabs.map((tab) => tab.id)).toEqual([
      thirdId,
      firstId,
      secondId,
    ]);
    expect(
      parseProjectWorkspaceTabs(
        window.localStorage.getItem(PROJECT_WORKSPACE_TABS_STORAGE_KEY),
      ).map((tab) => tab.id),
    ).toEqual([thirdId, firstId, secondId]);
  });

  it("keeps each duplicate or multi-project tab's agent environment state when another tab closes", () => {
    const { result } = renderHook(() => useProjectWorkspaceTabs(), { wrapper });
    let builderTab = "";
    let reviewerTab = "";
    let otherProjectTab = "";
    act(() => {
      builderTab = result.current.createTab({
        projectId: "proj_one",
        projectName: "One",
      }).id;
      reviewerTab = result.current.createTab({
        projectId: "proj_one",
        projectName: "One",
      }).id;
      otherProjectTab = result.current.createTab({
        projectId: "proj_two",
        projectName: "Two",
      }).id;
      result.current.updateTab(builderTab, {
        primaryThreadId: "thr_builder",
        inspectorEnvironmentId: "env_builder",
        inspectorEnvironmentPinned: true,
      });
      result.current.updateTab(reviewerTab, {
        reviewThreadId: "thr_reviewer",
        inspectorEnvironmentId: "env_reviewer",
        inspectorView: "diff",
      });
    });

    act(() => result.current.closeTab(otherProjectTab));

    expect(result.current.tabs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: builderTab,
          primaryThreadId: "thr_builder",
          inspectorEnvironmentId: "env_builder",
        }),
        expect.objectContaining({
          id: reviewerTab,
          reviewThreadId: "thr_reviewer",
          inspectorEnvironmentId: "env_reviewer",
          inspectorView: "diff",
        }),
      ]),
    );
    expect(
      window.localStorage.getItem(PROJECT_WORKSPACE_TABS_STORAGE_KEY),
    ).toContain("env_builder");
    expect(
      window.localStorage.getItem(PROJECT_WORKSPACE_TABS_STORAGE_KEY),
    ).toContain("env_reviewer");
  });

  it("does not change the active tab when a non-active duplicate closes", () => {
    const { result } = renderHook(() => useProjectWorkspaceTabs(), { wrapper });
    let firstId = "";
    let activeId = "";
    act(() => {
      firstId = result.current.createTab({
        projectId: "proj_one",
        projectName: "One",
      }).id;
      activeId = result.current.createTab({
        projectId: "proj_one",
        projectName: "One",
      }).id;
    });
    act(() => result.current.closeTab(firstId));
    expect(result.current.activeTabId).toBe(activeId);
    expect(result.current.tabs).toEqual([
      expect.objectContaining({ id: activeId }),
    ]);
  });

  it("restores a closed project's complete workspace identity and state", () => {
    const { result } = renderHook(() => useProjectWorkspaceTabs(), { wrapper });
    let workspaceId = "";
    act(() => {
      workspaceId = result.current.createTab({
        projectId: "proj_restore",
        projectName: "Restore",
      }).id;
      result.current.updateTab(workspaceId, {
        primaryThreadId: "thr_build",
        reviewThreadId: "thr_review",
        primaryTaskKey: "RESTORE-1",
        reviewTaskKey: "RESTORE-2",
        focusMode: "browser",
        toolsView: "source-control",
        inspectorView: "diff",
        inspectorEnvironmentId: "env_review",
        inspectorEnvironmentPinned: true,
        inspectorFilePath: "src/review.ts",
        rowSplitPercent: 64,
        topColumnSplitPercent: 50,
        bottomColumnSplitPercent: 50,
        browserTab: {
          id: "browser:env_review:restore",
          kind: "browser",
          environmentId: "env_review",
          title: "Review docs",
          url: "https://example.com/review",
        },
      });
    });

    act(() => result.current.closeTab(workspaceId));
    expect(result.current.tabs).toEqual([]);
    expect(
      parseRecentlyClosedProjectWorkspaceTabs(
        window.localStorage.getItem(
          RECENTLY_CLOSED_PROJECT_WORKSPACE_TABS_STORAGE_KEY,
        ),
      ).tabs,
    ).toEqual([
      expect.objectContaining({ id: workspaceId, reviewTaskKey: "RESTORE-2" }),
    ]);
    const storageSetItem = vi.spyOn(Storage.prototype, "setItem");

    let restoredId = "";
    act(() => {
      restoredId = result.current.openTab({
        projectId: "proj_restore",
        projectName: "Renamed Restore",
      }).id;
    });

    expect(restoredId).toBe(workspaceId);
    expect(result.current.activeTabId).toBe(workspaceId);
    const restoreWrites = storageSetItem.mock.calls.filter(
      ([key]) =>
        key === PROJECT_WORKSPACE_TABS_STORAGE_KEY ||
        key === RECENTLY_CLOSED_PROJECT_WORKSPACE_TABS_STORAGE_KEY,
    );
    expect(restoreWrites.map(([key]) => key)).toEqual([
      PROJECT_WORKSPACE_TABS_STORAGE_KEY,
      RECENTLY_CLOSED_PROJECT_WORKSPACE_TABS_STORAGE_KEY,
    ]);
    expect(parseProjectWorkspaceTabs(restoreWrites[0]?.[1] ?? null)).toEqual([
      expect.objectContaining({ id: workspaceId }),
    ]);
    expect(
      parseRecentlyClosedProjectWorkspaceTabs(restoreWrites[1]?.[1] ?? null),
    ).toEqual({ version: 1, tabs: [] });
    storageSetItem.mockRestore();
    expect(result.current.tabs).toEqual([
      {
        id: workspaceId,
        projectId: "proj_restore",
        projectName: "Renamed Restore",
        primaryThreadId: "thr_build",
        reviewThreadId: "thr_review",
        primaryTaskKey: "RESTORE-1",
        reviewTaskKey: "RESTORE-2",
        focusMode: "browser",
        toolsView: "source-control",
        inspectorView: "diff",
        inspectorEnvironmentId: "env_review",
        inspectorEnvironmentPinned: true,
        inspectorFilePath: "src/review.ts",
        rowSplitPercent: 64,
        topColumnSplitPercent: 50,
        bottomColumnSplitPercent: 50,
        browserTab: {
          id: "browser:env_review:restore",
          kind: "browser",
          environmentId: "env_review",
          title: "Review docs",
          url: "https://example.com/review",
        },
      },
    ]);
  });

  it("keeps duplicate tabs distinct and explicit creation fresh", () => {
    const { result } = renderHook(() => useProjectWorkspaceTabs(), { wrapper });
    let closedId = "";
    let liveId = "";
    act(() => {
      closedId = result.current.createTab({
        projectId: "proj_duplicate",
        projectName: "Duplicate",
      }).id;
      liveId = result.current.createTab({
        projectId: "proj_duplicate",
        projectName: "Duplicate",
      }).id;
      result.current.updateTab(closedId, { primaryThreadId: "thr_closed" });
    });
    act(() => result.current.closeTab(closedId));

    let ordinaryId = "";
    act(() => {
      ordinaryId = result.current.openTab({
        projectId: "proj_duplicate",
        projectName: "Duplicate",
      }).id;
    });
    expect(ordinaryId).toBe(liveId);
    expect(result.current.tabs).toHaveLength(1);

    let freshId = "";
    act(() => {
      freshId = result.current.createTab({
        projectId: "proj_duplicate",
        projectName: "Duplicate",
      }).id;
    });
    expect(freshId).not.toBe(closedId);
    expect(freshId).not.toBe(liveId);
    expect(result.current.tabs).toEqual([
      expect.objectContaining({ id: liveId }),
      expect.objectContaining({ id: freshId, primaryThreadId: null }),
    ]);
  });

  it("restores and consumes a recently closed tab received from another window", () => {
    const { result } = renderHook(() => useProjectWorkspaceTabs(), { wrapper });
    const remoteClosedTab: ProjectWorkspaceTab = {
      id: "workspace_remote_closed",
      projectId: "proj_remote_closed",
      projectName: "Old remote name",
      primaryThreadId: "thr_remote_build",
      reviewThreadId: "thr_remote_review",
      focusMode: "browser",
      toolsView: "source-control",
      inspectorView: "diff",
      inspectorEnvironmentId: "env_remote_review",
      inspectorEnvironmentPinned: true,
      inspectorFilePath: "src/remote.ts",
      rowSplitPercent: 64,
      topColumnSplitPercent: 50,
      bottomColumnSplitPercent: 50,
      primaryTaskKey: "REMOTE-1",
      reviewTaskKey: "REMOTE-2",
      browserTab: null,
    };
    const serialized = JSON.stringify({
      version: 1,
      tabs: [remoteClosedTab],
    });

    act(() => {
      window.localStorage.setItem(
        RECENTLY_CLOSED_PROJECT_WORKSPACE_TABS_STORAGE_KEY,
        serialized,
      );
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: RECENTLY_CLOSED_PROJECT_WORKSPACE_TABS_STORAGE_KEY,
          newValue: serialized,
        }),
      );
    });

    let restoredId = "";
    act(() => {
      restoredId = result.current.openTab({
        projectId: "proj_remote_closed",
        projectName: "Current remote name",
      }).id;
    });

    expect(restoredId).toBe(remoteClosedTab.id);
    expect(result.current.tabs).toEqual([
      {
        ...remoteClosedTab,
        projectName: "Current remote name",
      },
    ]);
    expect(
      parseRecentlyClosedProjectWorkspaceTabs(
        window.localStorage.getItem(
          RECENTLY_CLOSED_PROJECT_WORKSPACE_TABS_STORAGE_KEY,
        ),
      ),
    ).toEqual({ version: 1, tabs: [] });
  });

  it("accepts cross-window storage events and ignores invalid records", () => {
    const { result } = renderHook(() => useProjectWorkspaceTabs(), { wrapper });
    const serialized = JSON.stringify([
      {
        id: "workspace_remote",
        projectId: "proj_remote",
        projectName: "Remote",
        primaryThreadId: null,
        reviewThreadId: null,
        focusMode: "browser",
        toolsView: "tasks",
      },
      { id: "broken" },
    ]);

    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: PROJECT_WORKSPACE_TABS_STORAGE_KEY,
          newValue: serialized,
        }),
      );
    });

    expect(result.current.tabs).toEqual([
      expect.objectContaining({
        id: "workspace_remote",
        focusMode: "browser",
        browserTab: null,
      }),
    ]);
    expect(parseProjectWorkspaceTabs("not json")).toEqual([]);
    expect(parseRecentlyClosedProjectWorkspaceTabs("not json")).toEqual({
      version: 1,
      tabs: [],
    });
  });
});
