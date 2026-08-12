// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginNavPanelProps } from "@bb/plugin-sdk";
import { ProjectWorkspaceToolsPane } from "./ProjectWorkspaceToolsPane";

const mocks = vi.hoisted(() => ({
  navPanels: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/plugin-slots", () => ({
  usePluginSlots: () => ({ navPanels: mocks.navPanels }),
}));

vi.mock("@/components/plugin/PluginSlotMount", () => ({
  PluginSlotMount: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("./ProjectSourceControlPane", () => ({
  ProjectSourceControlPane: ({ projectId }: { projectId: string }) => (
    <div>source control for {projectId}</div>
  ),
}));

function TasksPanel({ subPath }: PluginNavPanelProps) {
  return <div data-testid="tasks-panel-path">{subPath}</div>;
}

beforeEach(() => {
  mocks.navPanels = [
    {
      pluginId: "tasks",
      id: "tasks",
      path: "tasks",
      generation: 1,
      component: TasksPanel,
    },
  ];
});

describe("ProjectWorkspaceToolsPane", () => {
  it("mounts Tasks against the bb project and requests a scoped create", () => {
    const onToolsViewChange = vi.fn();
    const { rerender } = render(
      <ProjectWorkspaceToolsPane
        projectId="proj_demo"
        toolsView="tasks"
        onToolsViewChange={onToolsViewChange}
      />,
    );

    expect(screen.getByTestId("tasks-panel-path").textContent).toBe(
      "bb-project/proj_demo",
    );
    fireEvent.click(screen.getByRole("button", { name: "New task" }));
    expect(onToolsViewChange).toHaveBeenCalledWith("tasks");
    expect(screen.getByTestId("tasks-panel-path").textContent).toBe(
      "bb-project/proj_demo?create=1",
    );

    rerender(
      <ProjectWorkspaceToolsPane
        projectId="proj_demo"
        toolsView="source-control"
        onToolsViewChange={onToolsViewChange}
      />,
    );
    expect(screen.getByText("source control for proj_demo")).toBeTruthy();
  });

  it("fails visibly when the Tasks plugin is disabled", () => {
    mocks.navPanels = [];
    render(
      <ProjectWorkspaceToolsPane
        projectId="proj_demo"
        toolsView="tasks"
        onToolsViewChange={() => undefined}
      />,
    );
    expect(screen.getByText("Tasks is not available")).toBeTruthy();
  });
});
