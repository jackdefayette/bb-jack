// @vitest-environment jsdom

import { useEffect } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PaneContent } from "@/lib/split-layout";
import SplitWorkspaceRoute from "./SplitWorkspaceRoute";

const workspaceLifecycle = vi.hoisted(() => ({ mounts: 0, unmounts: 0 }));

vi.mock("./thread-detail/SplitThreadArea", () => ({
  SplitThreadArea: ({ routeContent }: { routeContent: PaneContent }) => {
    useEffect(() => {
      workspaceLifecycle.mounts += 1;
      return () => {
        workspaceLifecycle.unmounts += 1;
      };
    }, []);
    return <output data-testid="route-content">{routeContent.kind}</output>;
  },
}));

vi.mock("./JacksIdeWorkspaceNavigation", () => ({
  JacksIdeThreadWorkspace: () => <div>Jack's IDE thread workspace</div>,
  JacksIdeWorkspaceHome: () => <div>Jack's IDE workspace home</div>,
}));

vi.mock("./RootComposeView", () => ({
  LegacyProjectComposeRedirect: () => <div>legacy redirect</div>,
}));

function NavigationControls() {
  const navigate = useNavigate();
  return (
    <>
      <button onClick={() => navigate("/")}>compose</button>
      <button onClick={() => navigate("/plugins/docs/docs/work/today.md")}>
        plugin
      </button>
      <button onClick={() => navigate("/projects/project-1/threads/thread-1")}>
        thread
      </button>
      <button onClick={() => navigate("/threads/projectless-thread")}>
        projectless thread
      </button>
    </>
  );
}

describe("SplitWorkspaceRoute", () => {
  beforeEach(() => {
    workspaceLifecycle.mounts = 0;
    workspaceLifecycle.unmounts = 0;
  });

  it("keeps plugin panels mounted and routes threads into Jack's IDE", () => {
    render(
      <MemoryRouter initialEntries={["/plugins/docs/docs/work/today.md"]}>
        <NavigationControls />
        <Routes>
          <Route path="*" element={<SplitWorkspaceRoute />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByTestId("route-content").textContent).toBe(
      "plugin-panel",
    );

    fireEvent.click(screen.getByRole("button", { name: "thread" }));
    expect(screen.getByText("Jack's IDE thread workspace")).toBeDefined();
    expect(workspaceLifecycle).toEqual({ mounts: 1, unmounts: 1 });

    fireEvent.click(screen.getByRole("button", { name: "projectless thread" }));
    expect(screen.getByText("Jack's IDE workspace home")).toBeDefined();
    expect(workspaceLifecycle).toEqual({ mounts: 1, unmounts: 1 });

    fireEvent.click(screen.getByRole("button", { name: "compose" }));
    expect(screen.getByText("Jack's IDE workspace home")).toBeDefined();
    expect(workspaceLifecycle).toEqual({ mounts: 1, unmounts: 1 });
  });
});
