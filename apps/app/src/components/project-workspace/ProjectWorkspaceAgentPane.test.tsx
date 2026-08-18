// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { NewThreadRequest } from "@bb/plugin-sdk";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectWorkspaceAgentPane } from "./ProjectWorkspaceAgentPane";

const mocks = vi.hoisted(() => ({ refetchQueries: vi.fn(), rpc: vi.fn() }));

vi.mock("@/lib/plugin-sdk-hooks", () => ({ callPluginRpc: mocks.rpc }));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ refetchQueries: mocks.refetchQueries }),
}));
vi.mock("@/views/thread-detail/ThreadDetailView", () => ({
  ThreadDetailView: ({
    environmentCheckoutCompactLabel,
  }: {
    environmentCheckoutCompactLabel?: string;
  }) => (
    <div
      data-testid="thread-detail"
      data-environment-checkout-label={environmentCheckoutCompactLabel}
    />
  ),
}));
vi.mock("./ProjectWorkspaceEnvironmentRibbon", () => ({
  ProjectWorkspaceEnvironmentRibbon: () => (
    <div data-testid="environment-ribbon" />
  ),
}));
vi.mock("./ProjectWorkspacePaneFrame", () => ({
  ProjectWorkspacePaneFrame: ({
    actionLabel,
    children,
    headerAccessory,
    title,
  }: {
    actionLabel?: string;
    children: ReactNode;
    headerAccessory?: ReactNode;
    title: string;
  }) => (
    <section data-action-label={actionLabel}>
      <header>
        <h2>{title}</h2>
        {headerAccessory}
      </header>
      <main>{children}</main>
    </section>
  ),
}));
vi.mock("@/components/plugin/PluginNewThreadComposer", () => ({
  PluginNewThreadComposer: ({
    defaultProjectId,
    draftKey,
    onSubmit,
    placeholder,
    workspaceEnvironmentChoices,
    workspaceEnvironmentPeer,
  }: {
    defaultProjectId: string;
    draftKey: string;
    placeholder: string;
    workspaceEnvironmentChoices: boolean;
    workspaceEnvironmentPeer?: {
      environmentId: string;
      label: string;
      taskKey: string | null;
    } | null;
    onSubmit: (request: NewThreadRequest) => Promise<void>;
  }) => (
    <div
      data-testid={`composer-${draftKey}`}
      data-placeholder={placeholder}
      data-project-id={defaultProjectId}
      data-workspace-choices={workspaceEnvironmentChoices}
      data-workspace-peer={
        workspaceEnvironmentPeer
          ? `${workspaceEnvironmentPeer.environmentId}:${workspaceEnvironmentPeer.label}`
          : undefined
      }
    >
      <input aria-label={`draft-${draftKey}`} defaultValue="keep this draft" />
      <button
        type="button"
        onClick={() =>
          void onSubmit({
            projectId: defaultProjectId,
          } as NewThreadRequest).catch(() => undefined)
        }
      >
        Submit {draftKey}
      </button>
      <button
        type="button"
        onClick={() =>
          void onSubmit({ projectId: "proj_other" } as NewThreadRequest).catch(
            () => undefined,
          )
        }
      >
        Mismatch {draftKey}
      </button>
    </div>
  ),
}));

function pane(
  overrides: Partial<
    React.ComponentProps<typeof ProjectWorkspaceAgentPane>
  > = {},
) {
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
  mocks.refetchQueries.mockReset();
  mocks.refetchQueries.mockResolvedValue(undefined);
  mocks.rpc.mockReset();
});

describe("ProjectWorkspaceAgentPane", () => {
  it("renders independent Build and Agent 2 composers without forcing a review role", () => {
    render(
      <>
        {pane()}
        {pane({
          label: "Agent 2",
          role: "reviewer",
          workspaceTabId: "workspace_two",
          workspaceEnvironmentPeer: {
            environmentId: "env_build",
            label: "Build",
            taskKey: "ONE-1",
          },
        })}
      </>,
    );

    const buildComposer = screen.getByTestId(
      "composer-project-workspace:workspace_one:builder",
    );
    const reviewComposer = screen.getByTestId(
      "composer-project-workspace:workspace_two:reviewer",
    );
    const readySurfaces = document.querySelectorAll(
      "[data-workspace-agent-ready]",
    );
    expect(screen.getByRole("heading", { name: "Build" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Agent 2" })).toBeTruthy();
    expect(buildComposer.getAttribute("data-project-id")).toBe("proj_one");
    expect(buildComposer.getAttribute("data-workspace-choices")).toBe("true");
    expect(buildComposer.getAttribute("data-placeholder")).toBe(
      "What should we build?",
    );
    expect(reviewComposer.getAttribute("data-project-id")).toBe("proj_one");
    expect(reviewComposer.getAttribute("data-placeholder")).toBe(
      "What should this agent do?",
    );
    expect(reviewComposer.getAttribute("data-workspace-peer")).toBe(
      "env_build:Build",
    );
    expect(readySurfaces).toHaveLength(2);
    expect(readySurfaces[0]?.className).toBe(readySurfaces[1]?.className);
    expect(screen.queryByText(/Start a builder task/u)).toBeNull();
    expect(
      screen
        .getByRole("heading", { name: "Build" })
        .closest("section")
        ?.getAttribute("data-action-label"),
    ).toBe("Focus build chat");
    expect(
      screen
        .getByRole("heading", { name: "Agent 2" })
        .closest("section")
        ?.getAttribute("data-action-label"),
    ).toBe("Focus agent 2 chat");
  });

  it("moves active-chat environment details into the compact pane header", () => {
    render(
      pane({ environmentId: "env_1", taskKey: "ONE-1", threadId: "thr_1" }),
    );

    const environmentControl = screen.getByTestId("environment-ribbon");
    const chatBody = document.querySelector(
      '[data-workspace-chat-body="builder"]',
    );
    expect(environmentControl.closest("header")).toBeTruthy();
    expect(chatBody).toBeTruthy();
    expect(chatBody?.contains(environmentControl)).toBe(false);
    expect(
      screen
        .getByTestId("thread-detail")
        .getAttribute("data-environment-checkout-label"),
    ).toBe("ONE-1");
  });

  it("accepts a valid project-default result without an environment", async () => {
    const onAgentStarted = vi.fn();
    mocks.rpc.mockResolvedValue({
      taskId: "task_1",
      taskKey: "ONE-1",
      threadId: "thr_1",
      environmentId: null,
    });
    render(pane({ onAgentStarted }));
    fireEvent.click(
      screen.getByRole("button", {
        name: "Submit project-workspace:workspace_one:builder",
      }),
    );
    await waitFor(() =>
      expect(onAgentStarted).toHaveBeenCalledWith({
        taskId: "task_1",
        taskKey: "ONE-1",
        threadId: "thr_1",
        environmentId: null,
      }),
    );
  });

  it("binds the Tasks start RPC to the workspace key and role", async () => {
    const onAgentStarted = vi.fn();
    mocks.rpc.mockResolvedValue({
      taskId: "task_1",
      taskKey: "ONE-1",
      threadId: "thr_1",
      environmentId: "env_1",
    });
    render(pane({ onAgentStarted }));

    fireEvent.click(
      screen.getByRole("button", {
        name: "Submit project-workspace:workspace_one:builder",
      }),
    );

    await waitFor(() =>
      expect(onAgentStarted).toHaveBeenCalledWith({
        taskId: "task_1",
        taskKey: "ONE-1",
        threadId: "thr_1",
        environmentId: "env_1",
      }),
    );
    expect(mocks.rpc).toHaveBeenCalledWith(
      fetch,
      "tasks",
      "workspaceAgentStart",
      expect.objectContaining({
        workspaceKey: "workspace_one:builder",
        bbProjectId: "proj_one",
        projectName: "One",
        role: "builder",
      }),
    );
    expect(mocks.refetchQueries).toHaveBeenCalledWith(
      {
        queryKey: ["sidebarNavigation"],
        type: "active",
      },
      { throwOnError: true },
    );
  });

  it("refreshes the thread projection before attaching a new agent", async () => {
    const sequence: string[] = [];
    const onAgentStarted = vi.fn(() => sequence.push("attached"));
    mocks.rpc.mockResolvedValue({
      taskId: "task_1",
      taskKey: "ONE-1",
      threadId: "thr_1",
      environmentId: "env_1",
    });
    mocks.refetchQueries.mockImplementation(async () => {
      sequence.push("refreshed");
    });
    render(pane({ onAgentStarted }));

    fireEvent.click(
      screen.getByRole("button", {
        name: "Submit project-workspace:workspace_one:builder",
      }),
    );

    await waitFor(() => expect(onAgentStarted).toHaveBeenCalledTimes(1));
    expect(sequence).toEqual(["refreshed", "attached"]);
  });

  it("keeps the draft and retries idempotently after projection refresh fails", async () => {
    const onAgentStarted = vi.fn();
    const result = {
      taskId: "task_1",
      taskKey: "ONE-1",
      threadId: "thr_1",
      environmentId: "env_1",
    };
    mocks.rpc.mockResolvedValue(result);
    mocks.refetchQueries
      .mockRejectedValueOnce(new Error("Sidebar refresh failed"))
      .mockResolvedValueOnce(undefined);
    render(pane({ onAgentStarted }));
    const draft = screen.getByLabelText(
      "draft-project-workspace:workspace_one:builder",
    ) as HTMLInputElement;
    fireEvent.change(draft, { target: { value: "preserve me" } });

    fireEvent.click(
      screen.getByRole("button", {
        name: "Submit project-workspace:workspace_one:builder",
      }),
    );
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "Retry to attach the existing task",
      ),
    );
    expect(onAgentStarted).not.toHaveBeenCalled();
    expect(draft.value).toBe("preserve me");

    fireEvent.click(
      screen.getByRole("button", {
        name: "Submit project-workspace:workspace_one:builder",
      }),
    );
    await waitFor(() => expect(onAgentStarted).toHaveBeenCalledWith(result));
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    expect(draft.value).toBe("preserve me");
  });

  it("rejects a mismatched project without calling Tasks", async () => {
    render(pane());
    fireEvent.click(
      screen.getByRole("button", {
        name: "Mismatch project-workspace:workspace_one:builder",
      }),
    );
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "fixed to its project",
      ),
    );
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("keeps the composer mounted after an invalid result and retries successfully", async () => {
    const onAgentStarted = vi.fn();
    mocks.rpc
      .mockResolvedValueOnce({
        taskId: "task_1",
        taskKey: "ONE-1",
        threadId: "thr_1",
      })
      .mockResolvedValueOnce({
        taskId: "task_1",
        taskKey: "ONE-1",
        threadId: "thr_1",
        environmentId: "env_1",
      });
    render(pane({ onAgentStarted }));
    const draft = screen.getByLabelText(
      "draft-project-workspace:workspace_one:builder",
    ) as HTMLInputElement;
    fireEvent.change(draft, { target: { value: "preserve me" } });
    fireEvent.click(
      screen.getByRole("button", {
        name: "Submit project-workspace:workspace_one:builder",
      }),
    );
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "invalid agent start result",
      ),
    );
    expect(draft.value).toBe("preserve me");
    fireEvent.click(
      screen.getByRole("button", {
        name: "Submit project-workspace:workspace_one:builder",
      }),
    );
    await waitFor(() => expect(onAgentStarted).toHaveBeenCalledTimes(1));
  });
});
