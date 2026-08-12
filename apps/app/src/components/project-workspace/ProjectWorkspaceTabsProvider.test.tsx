// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type { ReactNode } from "react";
import {
  ACTIVE_PROJECT_WORKSPACE_TAB_STORAGE_KEY,
  PROJECT_WORKSPACE_TABS_STORAGE_KEY,
  ProjectWorkspaceTabsProvider,
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
  });
});
