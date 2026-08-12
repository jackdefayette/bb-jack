// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { NewThreadRequest } from "@bb/plugin-sdk";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectWorkspaceAgentPane } from "./ProjectWorkspaceAgentPane";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/lib/plugin-sdk-hooks", () => ({ callPluginRpc: mocks.rpc }));
vi.mock("@/views/thread-detail/ThreadDetailView", () => ({
  ThreadDetailView: () => <div data-testid="thread-detail" />,
}));
vi.mock("./ProjectWorkspaceEnvironmentRibbon", () => ({
  ProjectWorkspaceEnvironmentRibbon: () => <div data-testid="environment-ribbon" />,
}));
vi.mock("./ProjectWorkspacePaneFrame", () => ({
  ProjectWorkspacePaneFrame: ({ actionLabel, children, title }: { actionLabel?: string; children: ReactNode; title: string }) => (
    <section data-action-label={actionLabel}><h2>{title}</h2>{children}</section>
  ),
}));
vi.mock("@/components/plugin/PluginNewThreadComposer", () => ({
  PluginNewThreadComposer: ({ defaultProjectId, draftKey, onSubmit, placeholder, workspaceEnvironmentChoices }: {
    defaultProjectId: string;
    draftKey: string;
    placeholder: string;
    workspaceEnvironmentChoices: boolean;
    onSubmit: (request: NewThreadRequest) => Promise<void>;
  }) => (
    <div data-testid={`composer-${draftKey}`} data-placeholder={placeholder} data-project-id={defaultProjectId} data-workspace-choices={workspaceEnvironmentChoices}>
      <input aria-label={`draft-${draftKey}`} defaultValue="keep this draft" />
      <button type="button" onClick={() => void onSubmit({ projectId: defaultProjectId } as NewThreadRequest).catch(() => undefined)}>
        Submit {draftKey}
      </button>
      <button type="button" onClick={() => void onSubmit({ projectId: "proj_other" } as NewThreadRequest).catch(() => undefined)}>
        Mismatch {draftKey}
      </button>
    </div>
  ),
}));

function pane(overrides: Partial<React.ComponentProps<typeof ProjectWorkspaceAgentPane>> = {}) {
  return (
    <ProjectWorkspaceAgentPane
      label="Build"
      role="builder"
      projectId="proj_one"
      projectName="One"
      taskKey={null}
      environmentId={null}
      threadId={null}
      workspaceTabId="workspace_one"
      isFocused
      isTopRow
      onActivate={() => undefined}
      onNavigate={() => undefined}
      onAgentStarted={() => undefined}
      {...overrides}
    />
  );
}

afterEach(() => {
  cleanup();
  mocks.rpc.mockReset();
});

describe("ProjectWorkspaceAgentPane", () => {
  it("renders independent, symmetric Build and Review chat composers without role instructions", () => {
    render(<>{pane()}{pane({ label: "Review", role: "reviewer", workspaceTabId: "workspace_two" })}</>);

    const buildComposer = screen.getByTestId("composer-project-workspace:workspace_one:builder");
    const reviewComposer = screen.getByTestId("composer-project-workspace:workspace_two:reviewer");
    const readySurfaces = document.querySelectorAll("[data-workspace-agent-ready]");
    expect(screen.getByRole("heading", { name: "Build" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Review" })).toBeTruthy();
    expect(buildComposer.getAttribute("data-project-id")).toBe("proj_one");
    expect(buildComposer.getAttribute("data-workspace-choices")).toBe("true");
    expect(buildComposer.getAttribute("data-placeholder")).toBe("What should we build?");
    expect(reviewComposer.getAttribute("data-project-id")).toBe("proj_one");
    expect(reviewComposer.getAttribute("data-placeholder")).toBe("What should we review?");
    expect(readySurfaces).toHaveLength(2);
    expect(readySurfaces[0]?.className).toBe(readySurfaces[1]?.className);
    expect(screen.queryByText(/Start a builder task/u)).toBeNull();
    expect(screen.getByRole("heading", { name: "Build" }).closest("section")?.getAttribute("data-action-label")).toBe("Focus build chat");
    expect(screen.getByRole("heading", { name: "Review" }).closest("section")?.getAttribute("data-action-label")).toBe("Focus review chat");
  });

  it("accepts a valid project-default result without an environment", async () => {
    const onAgentStarted = vi.fn();
    mocks.rpc.mockResolvedValue({ taskId: "task_1", taskKey: "ONE-1", threadId: "thr_1", environmentId: null });
    render(pane({ onAgentStarted }));
    fireEvent.click(screen.getByRole("button", { name: "Submit project-workspace:workspace_one:builder" }));
    await waitFor(() => expect(onAgentStarted).toHaveBeenCalledWith({ taskId: "task_1", taskKey: "ONE-1", threadId: "thr_1", environmentId: null }));
  });

  it("binds the Tasks start RPC to the workspace key and role", async () => {
    const onAgentStarted = vi.fn();
    mocks.rpc.mockResolvedValue({ taskId: "task_1", taskKey: "ONE-1", threadId: "thr_1", environmentId: "env_1" });
    render(pane({ onAgentStarted }));

    fireEvent.click(screen.getByRole("button", { name: "Submit project-workspace:workspace_one:builder" }));

    await waitFor(() => expect(onAgentStarted).toHaveBeenCalledWith({ taskId: "task_1", taskKey: "ONE-1", threadId: "thr_1", environmentId: "env_1" }));
    expect(mocks.rpc).toHaveBeenCalledWith(fetch, "tasks", "workspaceAgentStart", expect.objectContaining({
      workspaceKey: "workspace_one:builder",
      bbProjectId: "proj_one",
      projectName: "One",
      role: "builder",
    }));
  });

  it("rejects a mismatched project without calling Tasks", async () => {
    render(pane());
    fireEvent.click(screen.getByRole("button", { name: "Mismatch project-workspace:workspace_one:builder" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("fixed to its project"));
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("keeps the composer mounted after an invalid result and retries successfully", async () => {
    const onAgentStarted = vi.fn();
    mocks.rpc
      .mockResolvedValueOnce({ taskId: "task_1", taskKey: "ONE-1", threadId: "thr_1" })
      .mockResolvedValueOnce({ taskId: "task_1", taskKey: "ONE-1", threadId: "thr_1", environmentId: "env_1" });
    render(pane({ onAgentStarted }));
    const draft = screen.getByLabelText("draft-project-workspace:workspace_one:builder") as HTMLInputElement;
    fireEvent.change(draft, { target: { value: "preserve me" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit project-workspace:workspace_one:builder" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("invalid agent start result"));
    expect(draft.value).toBe("preserve me");
    fireEvent.click(screen.getByRole("button", { name: "Submit project-workspace:workspace_one:builder" }));
    await waitFor(() => expect(onAgentStarted).toHaveBeenCalledTimes(1));
  });
});
