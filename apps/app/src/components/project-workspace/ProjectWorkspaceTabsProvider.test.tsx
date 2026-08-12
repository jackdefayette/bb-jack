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

  it("keeps each duplicate or multi-project tab's agent environment state when another tab closes", () => {
    const { result } = renderHook(() => useProjectWorkspaceTabs(), { wrapper });
    let builderTab = "";
    let reviewerTab = "";
    let otherProjectTab = "";
    act(() => {
      builderTab = result.current.createTab({ projectId: "proj_one", projectName: "One" }).id;
      reviewerTab = result.current.createTab({ projectId: "proj_one", projectName: "One" }).id;
      otherProjectTab = result.current.createTab({ projectId: "proj_two", projectName: "Two" }).id;
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

    expect(result.current.tabs).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: builderTab, primaryThreadId: "thr_builder", inspectorEnvironmentId: "env_builder" }),
      expect.objectContaining({ id: reviewerTab, reviewThreadId: "thr_reviewer", inspectorEnvironmentId: "env_reviewer", inspectorView: "diff" }),
    ]));
    expect(window.localStorage.getItem(PROJECT_WORKSPACE_TABS_STORAGE_KEY)).toContain("env_builder");
    expect(window.localStorage.getItem(PROJECT_WORKSPACE_TABS_STORAGE_KEY)).toContain("env_reviewer");
  });

  it("does not change the active tab when a non-active duplicate closes", () => {
    const { result } = renderHook(() => useProjectWorkspaceTabs(), { wrapper });
    let firstId = "";
    let activeId = "";
    act(() => {
      firstId = result.current.createTab({ projectId: "proj_one", projectName: "One" }).id;
      activeId = result.current.createTab({ projectId: "proj_one", projectName: "One" }).id;
    });
    act(() => result.current.closeTab(firstId));
    expect(result.current.activeTabId).toBe(activeId);
    expect(result.current.tabs).toEqual([expect.objectContaining({ id: activeId })]);
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
