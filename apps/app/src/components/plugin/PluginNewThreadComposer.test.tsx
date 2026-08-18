// @vitest-environment jsdom

/**
 * Round-trip guarantee of the `default*` seed props: submitting a seeded,
 * untouched composer must reproduce the request the seeds came from, and a
 * seed change after mount must re-seed even user-touched selections. This is
 * what lets a plugin store a `NewThreadRequest`, re-open it for editing, and
 * save without silently resetting the user's provider/model/permission/
 * environment to project defaults.
 */

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NewThreadRequest } from "@bb/plugin-sdk";
import { PluginNewThreadComposer } from "./PluginNewThreadComposer";

const mocks = vi.hoisted(() => ({
  hosts: [{ id: "host_1", name: "Machine" }],
  promptBoxProps: [] as Array<Record<string, any>>,
  taskStates: [] as Array<Record<string, unknown>>,
  threads: [] as Array<Record<string, unknown>>,
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: { states: mocks.taskStates } }),
}));

vi.mock("@/components/promptbox/NewThreadPromptBox", () => ({
  NewThreadPromptBox: (props: Record<string, unknown>) => {
    mocks.promptBoxProps.push(props);
    const modeConfig = props.modeConfig as
      | { footerControl?: ReactNode; header?: ReactNode }
      | undefined;
    return (
      <div data-testid="new-thread-prompt-box">
        {modeConfig?.header}
        {modeConfig?.footerControl}
      </div>
    );
  },
}));

vi.mock("@/lib/sdk", () => ({
  sdk: { projects: { attachments: { copy: vi.fn() } } },
}));

const PROJECT = {
  id: "proj_1",
  name: "Project One",
  defaultExecutionOptions: {
    providerId: "codex",
    model: "gpt-5.6",
    serviceTier: undefined,
    reasoningLevel: "medium",
    permissionMode: "auto",
  },
  sources: [
    {
      id: "src_1",
      projectId: "proj_1",
      type: "local_path",
      hostId: "host_1",
      path: "/repo",
      isDefault: true,
      createdAt: 0,
      updatedAt: 0,
    },
  ],
};

// A second project on the same host, so a record switch can differ ONLY by
// project id.
const OTHER_PROJECT = {
  ...PROJECT,
  id: "proj_2",
  name: "Project Two",
  sources: [{ ...PROJECT.sources[0], id: "src_2", projectId: "proj_2" }],
};

vi.mock("@/hooks/queries/sidebar-navigation-query", () => ({
  useSidebarNavigation: () => ({
    data: { projects: [PROJECT, OTHER_PROJECT], personalProject: undefined },
  }),
}));

vi.mock("@/hooks/queries/host-queries", () => ({
  useHosts: () => ({ data: mocks.hosts }),
  selectPrimaryHost: (
    hosts: Array<{ id: string }> | undefined,
    primaryHostId: string | null,
  ) => hosts?.find((host) => host.id === primaryHostId) ?? hosts?.[0] ?? null,
}));

vi.mock("@/hooks/queries/system-queries", () => ({
  useOnboardingAgents: () => ({ data: undefined, isPending: false }),
  useSystemConfig: () => ({ data: { primaryHostId: "host_1" } }),
  useSystemExecutionOptions: () => ({
    data: {
      providers: [
        {
          id: "codex",
          displayName: "Codex",
          logoUrl: null,
          capabilities: {
            supportsServiceTier: false,
            supportedPermissionModes: ["auto", "accept-edits", "full"],
          },
          composerActions: [],
        },
        {
          id: "claude-code",
          displayName: "Claude Code",
          logoUrl: null,
          capabilities: {
            supportsServiceTier: false,
            supportedPermissionModes: ["auto", "accept-edits", "full"],
          },
          composerActions: [],
        },
      ],
      models: [
        {
          model: "gpt-5.6",
          displayName: "GPT-5.6",
          isDefault: true,
          supportedReasoningEfforts: [
            { reasoningEffort: "low" },
            { reasoningEffort: "medium" },
            { reasoningEffort: "high" },
          ],
        },
        {
          model: "gpt-5.6-sol",
          displayName: "GPT-5.6 Sol",
          isDefault: false,
          supportedReasoningEfforts: [
            { reasoningEffort: "medium" },
            { reasoningEffort: "high" },
          ],
        },
      ],
      selectedOnlyModels: [],
      modelLoadError: null,
    },
    isLoading: false,
    isError: false,
    isPlaceholderData: false,
  }),
}));

vi.mock("@/hooks/queries/thread-queries", () => ({
  useThreads: () => ({ data: mocks.threads, isLoading: false }),
}));

vi.mock("@/hooks/queries/environment-queries", () => ({
  useEnvironments: () => ({
    data: mocks.threads.flatMap((thread) =>
      typeof thread.environmentId === "string"
        ? [{ id: thread.environmentId, status: "ready" }]
        : [],
    ),
  }),
}));

vi.mock("@/hooks/queries/project-queries", () => ({
  stripProjectThreads: (project: unknown) => project,
  useProjectPromptHistory: () => ({ data: [] }),
  useProjectSourceBranches: () => ({
    data: {
      branches: ["main", "release"],
      branchesTruncated: false,
      checkout: { kind: "branch", branchName: "main" },
      defaultBranch: "main",
      defaultBranchRelation: null,
      hasUncommittedChanges: false,
      operation: { kind: "none" },
      originDefaultBranch: null,
      remoteBranches: [],
      remoteBranchesTruncated: false,
      selectedBranch: null,
      defaultWorktreeBaseBranch: null,
    },
    isLoading: false,
    isFetching: false,
    refetch: vi.fn(),
  }),
}));

vi.mock("@/hooks/queries/project-default-execution-options-query", () => ({
  useProjectDefaultExecutionOptions: () => ({ data: undefined }),
}));

vi.mock("@/hooks/mutations/project-mutations", () => ({
  useUploadPromptAttachment: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("@/hooks/usePromptMentions", () => ({
  usePromptMentions: () => ({
    triggers: [],
    suggestions: [],
    isLoading: false,
    isError: false,
    setQuery: vi.fn(),
  }),
}));

vi.mock("@/hooks/useCommandSuggestions", () => ({
  useCommandSuggestions: () => ({
    trigger: null,
    suggestions: [],
    isLoading: false,
    isError: false,
    hasMore: false,
    isLoadingMore: false,
    loadMore: vi.fn(),
  }),
}));

function latestPromptBoxProps(): Record<string, any> {
  const props = mocks.promptBoxProps.at(-1);
  expect(props).toBeDefined();
  return props as Record<string, any>;
}

function composerElement(
  seed: NewThreadRequest,
  onSubmit: (request: NewThreadRequest) => void,
  draftKey: string,
) {
  return (
    <MemoryRouter>
      <PluginNewThreadComposer
        draftKey={draftKey}
        defaultProjectId={seed.projectId}
        defaultProviderId={seed.providerId}
        defaultModel={seed.model}
        defaultReasoningLevel={seed.reasoningLevel}
        defaultServiceTier={seed.serviceTier}
        defaultPermissionMode={seed.permissionMode}
        defaultEnvironment={seed.environment}
        initialPrompt="review every PR for slop"
        onSubmit={onSubmit}
      />
    </MemoryRouter>
  );
}

function renderComposer(
  seed: NewThreadRequest,
  onSubmit: (request: NewThreadRequest) => void,
  draftKey: string,
) {
  return render(composerElement(seed, onSubmit, draftKey));
}

const STORED_REQUEST: NewThreadRequest = {
  projectId: "proj_1",
  providerId: "claude-code",
  model: "gpt-5.6-sol",
  reasoningLevel: "high",
  permissionMode: "full",
  // Every seeded field must carry caller-explicit provenance. Without it the
  // server drops the requested providerId/model and re-derives them from the
  // project's stored defaults, undoing the seed.
  executionInputSources: {
    providerId: "explicit",
    model: "explicit",
    reasoningLevel: "explicit",
    permissionMode: "explicit",
  },
  environment: {
    type: "host",
    hostId: "host_1",
    workspace: {
      type: "managed-worktree",
      baseBranch: { kind: "named", name: "release" },
    },
  },
  input: [{ type: "text", text: "review every PR for slop", mentions: [] }],
};

async function submit(): Promise<void> {
  await act(async () => {
    latestPromptBoxProps().onSubmit();
  });
}

describe("PluginNewThreadComposer seeding", () => {
  beforeEach(() => {
    mocks.hosts = [{ id: "host_1", name: "Machine" }];
    mocks.promptBoxProps.length = 0;
    mocks.taskStates = [];
    mocks.threads = [];
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it("round-trips a stored request submitted untouched", async () => {
    const submitted: NewThreadRequest[] = [];
    renderComposer(
      STORED_REQUEST,
      (request) => {
        submitted.push(request);
      },
      "round-trip",
    );

    await waitFor(() => {
      expect(latestPromptBoxProps().disabled).toBe(false);
    });
    await submit();

    expect(submitted).toHaveLength(1);
    expect(submitted[0]).toEqual(STORED_REQUEST);
  });

  it("re-seeds every selection when the seed props change, even after a user pick", async () => {
    const submitted: NewThreadRequest[] = [];
    const view = renderComposer(
      STORED_REQUEST,
      (request) => {
        submitted.push(request);
      },
      "re-seed",
    );
    await waitFor(() => {
      expect(latestPromptBoxProps().disabled).toBe(false);
    });

    // The user touches the model, then switches to another saved record.
    await act(async () => {
      latestPromptBoxProps().execution.model.onChange("gpt-5.6");
    });
    const otherRecord: NewThreadRequest = {
      ...STORED_REQUEST,
      model: "gpt-5.6-sol",
      reasoningLevel: "medium",
      permissionMode: "accept-edits",
      environment: {
        type: "host",
        hostId: "host_1",
        workspace: {
          type: "unmanaged",
          path: null,
          branch: { kind: "existing", name: "release" },
        },
      },
    };
    view.rerender(
      composerElement(
        otherRecord,
        (request) => {
          submitted.push(request);
        },
        "re-seed",
      ),
    );

    await waitFor(() => {
      expect(latestPromptBoxProps().disabled).toBe(false);
    });
    await submit();

    expect(submitted).toHaveLength(1);
    expect(submitted[0]).toEqual(otherRecord);
  });

  it("re-seeds the branch when the next record differs only by project", async () => {
    const submitted: NewThreadRequest[] = [];
    const onSubmit = (request: NewThreadRequest) => {
      submitted.push(request);
    };
    const view = renderComposer(STORED_REQUEST, onSubmit, "project-switch");
    await waitFor(() => {
      expect(latestPromptBoxProps().disabled).toBe(false);
    });

    // The user clears the seeded branch on record one.
    await act(async () => {
      latestPromptBoxProps().modeConfig.branch.onClear();
    });

    // Record two: identical seeds except the project.
    const otherProjectRecord: NewThreadRequest = {
      ...STORED_REQUEST,
      projectId: "proj_2",
    };
    view.rerender(
      composerElement(otherProjectRecord, onSubmit, "project-switch"),
    );
    await waitFor(() => {
      expect(latestPromptBoxProps().disabled).toBe(false);
    });
    await submit();

    // The previous record's "cleared" state must not leak: record two keeps
    // its own seeded base branch.
    expect(submitted).toHaveLength(1);
    expect(submitted[0]).toEqual(otherProjectRecord);
  });

  it("does not resurrect the branch seed after the user leaves and returns to the environment", async () => {
    const submitted: NewThreadRequest[] = [];
    renderComposer(
      STORED_REQUEST,
      (request) => {
        submitted.push(request);
      },
      "env-return",
    );
    await waitFor(() => {
      expect(latestPromptBoxProps().disabled).toBe(false);
    });

    // Away to working-locally, then back to the seeded worktree environment.
    await act(async () => {
      latestPromptBoxProps().modeConfig.environment.onChange(
        "host:host_1:local",
      );
    });
    await act(async () => {
      latestPromptBoxProps().modeConfig.environment.onChange(
        "host:host_1:worktree",
      );
    });
    await waitFor(() => {
      expect(latestPromptBoxProps().disabled).toBe(false);
    });
    await submit();

    expect(submitted).toHaveLength(1);
    // Back in worktree mode, but the retired seed no longer pins "release" —
    // the base branch falls to the environment's own default.
    expect(submitted[0].environment).toEqual({
      type: "host",
      hostId: "host_1",
      workspace: {
        type: "managed-worktree",
        baseBranch: { kind: "default" },
      },
    });
  });

  it("keeps project defaults when no seed props are passed", async () => {
    const submitted: NewThreadRequest[] = [];
    render(
      <MemoryRouter>
        <PluginNewThreadComposer
          draftKey="unseeded"
          defaultProjectId="proj_1"
          initialPrompt="hello"
          onSubmit={(request) => {
            submitted.push(request);
          }}
        />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(latestPromptBoxProps().disabled).toBe(false);
    });
    await submit();

    expect(submitted).toHaveLength(1);
    expect(submitted[0]).toMatchObject({
      projectId: "proj_1",
      providerId: "codex",
      model: "gpt-5.6",
      reasoningLevel: "medium",
      permissionMode: "auto",
      environment: {
        type: "host",
        hostId: "host_1",
        workspace: { type: "unmanaged", path: null },
      },
    });
  });

  it("makes a new isolated worktree the visible workspace-agent default", async () => {
    const submitted: NewThreadRequest[] = [];
    render(
      <MemoryRouter>
        <PluginNewThreadComposer
          draftKey="workspace-agent"
          defaultProjectId="proj_1"
          initialPrompt="build safely"
          workspaceEnvironmentChoices
          onSubmit={(request) => {
            submitted.push(request);
          }}
        />
      </MemoryRouter>,
    );

    const picker = screen.getByRole("button", {
      name: "Working copy: New isolated working copy — Recommended",
    });
    expect(latestPromptBoxProps().modeConfig.header).toBeUndefined();
    expect(latestPromptBoxProps().modeConfig.footerControl).toBeTruthy();
    expect(picker.textContent).toContain("New copy");
    fireEvent.pointerDown(picker, { button: 0, ctrlKey: false });
    expect(screen.getByText("Start fresh")).toBeTruthy();
    expect(screen.getByText("Use existing files")).toBeTruthy();
    expect(
      screen.getByRole("menuitemcheckbox", {
        name: /New isolated working copy — Recommended/u,
      }),
    ).toBeTruthy();
    const currentProjectFolder = screen.getByRole("menuitemcheckbox", {
      name: /This project folder — Shared/u,
    });
    expect(currentProjectFolder.textContent).toContain("Edits /repo directly");
    expect(screen.queryByText("Manage working copies…")).toBeNull();
    expect(latestPromptBoxProps().project).toBeUndefined();
    expect(latestPromptBoxProps().modeConfig.environment.pickerHidden).toBe(
      true,
    );
    expect(latestPromptBoxProps().modeConfig.branch.hidden).toBe(false);
    await waitFor(() => expect(latestPromptBoxProps().disabled).toBe(false));
    await submit();
    expect(submitted[0]?.environment).toEqual({
      type: "host",
      hostId: "host_1",
      workspace: {
        type: "managed-worktree",
        baseBranch: { kind: "default" },
      },
    });

    fireEvent.click(currentProjectFolder);
    expect(picker.textContent).toContain("Project folder");
    expect(picker.getAttribute("aria-label")).toBe(
      "Working copy: This project folder — Shared",
    );
  });

  it("identifies an existing working copy by task and sharing peer", () => {
    mocks.threads = [
      {
        id: "thr_bbj_2",
        title: "BBJ-2 · hi",
        titleFallback: null,
        environmentId: "env_bbj_2",
        environmentWorkspaceDisplayKind: "managed-worktree",
        environmentBranchName: "bb/bbj-2-hi",
        environmentName: null,
        environmentHostId: "host_1",
        latestAttentionAt: 1,
      },
    ];
    render(
      <MemoryRouter>
        <PluginNewThreadComposer
          draftKey="workspace-agent-shared"
          defaultProjectId="proj_1"
          workspaceEnvironmentChoices
          workspaceEnvironmentPeer={{
            environmentId: "env_bbj_2",
            label: "Build",
            taskKey: "BBJ-2",
          }}
          onSubmit={() => undefined}
        />
      </MemoryRouter>,
    );

    fireEvent.pointerDown(
      screen.getByRole("button", {
        name: /Working copy:/u,
      }),
      { button: 0, ctrlKey: false },
    );
    expect(screen.getByText("Active working copies")).toBeTruthy();
    const sharedWorkingCopy = screen.getByRole("menuitemcheckbox", {
      name: /Share files with BBJ-2 — Shared with Build/u,
    });
    expect(sharedWorkingCopy.textContent).toContain(
      "Uses the same folder and branch as Build",
    );
    expect(sharedWorkingCopy.textContent).toContain(
      "Both agents see uncommitted changes immediately",
    );
  });

  it.each(["done", "canceled"])(
    "hides a %s task's working copy from normal selection",
    (taskStatus) => {
      mocks.threads = [
        {
          id: "thr_finished",
          title: "BBJ-3 · finished",
          titleFallback: null,
          environmentId: "env_finished",
          environmentWorkspaceDisplayKind: "managed-worktree",
          environmentBranchName: "bb/bbj-3-finished",
          environmentName: null,
          environmentHostId: "host_1",
          latestAttentionAt: 1,
        },
      ];
      mocks.taskStates = [
        { threadId: "thr_finished", taskKey: "BBJ-3", status: taskStatus },
      ];
      render(
        <MemoryRouter>
          <PluginNewThreadComposer
            draftKey={`workspace-agent-${taskStatus}`}
            defaultProjectId="proj_1"
            workspaceEnvironmentChoices
            onSubmit={() => undefined}
          />
        </MemoryRouter>,
      );
      fireEvent.pointerDown(
        screen.getByRole("button", {
          name: /Working copy:/u,
        }),
        { button: 0, ctrlKey: false },
      );
      expect(screen.queryByText(/Share files with BBJ-3/u)).toBeNull();
    },
  );

  it("keeps the generic environment picker available without a primary host", () => {
    mocks.hosts = [];
    render(
      <MemoryRouter>
        <PluginNewThreadComposer
          draftKey="workspace-agent-no-host"
          defaultProjectId="proj_1"
          workspaceEnvironmentChoices
          onSubmit={() => undefined}
        />
      </MemoryRouter>,
    );

    expect(
      screen.queryByRole("button", {
        name: /Working copy:/u,
      }),
    ).toBeNull();
    expect(latestPromptBoxProps().modeConfig.environment.pickerHidden).toBe(
      false,
    );
  });
});
