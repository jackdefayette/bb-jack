// @vitest-environment jsdom

import type { ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NewThreadPromptBox } from "./NewThreadPromptBox";

vi.mock("@/components/commands/AppCommandProvider", () => ({
  useAppCommandContext: vi.fn(),
  useAppCommandHandler: vi.fn(),
}));

vi.mock("@/components/plugin/PluginComposerBanners", () => ({
  PluginComposerBanners: () => null,
}));

vi.mock("@/components/plugin/plugin-composer-host", () => ({
  PluginComposerHostProvider: ({ children }: { children: ReactNode }) =>
    children,
  PluginComposerViewProvider: ({ children }: { children: ReactNode }) =>
    children,
  usePluginComposerViewModel: () => ({}),
}));

vi.mock("@/components/promptbox/ExecutionControls", () => ({
  ExecutionControls: () => <button type="button">Model selector</button>,
}));

vi.mock("@/components/promptbox/PromptBoxInternal", () => ({
  PromptBoxInternal: ({ footerStart }: { footerStart?: ReactNode }) => (
    <div data-testid="footer-start">{footerStart}</div>
  ),
}));

vi.mock("@/components/promptbox/usePromptVoice", () => ({
  usePromptVoice: () => ({
    state: "idle",
    isSupported: false,
    stream: null,
    start: vi.fn(),
    stop: vi.fn(),
    cancel: vi.fn(),
  }),
}));

vi.mock("@/components/pickers/BranchPicker", () => ({
  BranchPicker: () => null,
}));
vi.mock("@/components/pickers/EnvironmentPicker", () => ({
  EnvironmentPickerUI: () => null,
}));
vi.mock("@/components/pickers/MachinePicker", () => ({
  MachinePickerUI: () => null,
}));
vi.mock("@/components/pickers/PermissionModePicker", () => ({
  PermissionModePicker: () => null,
}));
vi.mock("@/components/pickers/ProjectSelector", () => ({
  ProjectSelector: () => null,
}));
vi.mock("@/components/pickers/WorktreePicker", () => ({
  WorktreePicker: () => null,
}));

vi.mock("@/hooks/queries/host-queries", () => ({
  selectPrimaryHost: (hosts: readonly { id: string }[] | undefined) =>
    hosts?.[0] ?? null,
  useHosts: () => ({ data: [{ id: "host_test" }] }),
}));
vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: () => ({ data: { primaryHostId: "host_test" } }),
}));
vi.mock("@/hooks/useHostDaemon", () => ({
  useHostDaemon: () => ({
    isLocalDaemonHost: () => true,
    localDaemonHostId: "host_test",
  }),
}));
vi.mock("@/views/thread-detail/PaneContext", () => ({
  useOptionalPaneContext: () => null,
}));

afterEach(cleanup);

describe("NewThreadPromptBox footer control", () => {
  it("forwards the compact control beside the model selector", () => {
    render(
      <NewThreadPromptBox
        value=""
        mentionRanges={[]}
        onChange={vi.fn()}
        onSubmit={vi.fn()}
        isSubmitting={false}
        disabled={false}
        zenModeStorageKey="test"
        history={{
          currentDraft: { text: "", mentions: [], attachments: [] },
          entries: [],
          onSelectEntry: vi.fn(),
        }}
        typeahead={{
          mention: {
            suggestions: [],
            isLoading: false,
            isError: false,
            onQueryChange: vi.fn(),
          },
          command: {
            trigger: null,
            suggestions: [],
            isLoading: false,
            isError: false,
            hasMore: false,
            isLoadingMore: false,
            loadMore: vi.fn(),
            onQueryChange: vi.fn(),
          },
        }}
        attachments={{}}
        modeConfig={{
          environment: {
            value: "host:host_test:worktree",
            onChange: vi.fn(),
            sources: [],
          },
          branch: {
            value: "main",
            currentBranch: "main",
            isNew: false,
            options: ["main"],
            onChange: vi.fn(),
            onCreate: vi.fn(),
          },
          worktree: { options: [], value: null, onChange: vi.fn() },
          permission: {
            value: "auto",
            options: [],
            onChange: vi.fn(),
            supported: true,
          },
          footerControl: <button type="button">Working copy</button>,
        }}
        execution={{
          provider: { selectedId: "codex" },
          model: {
            selected: "gpt-5.6",
            options: [],
            moreOptions: [],
            isLoading: false,
            loadFailed: false,
            onChange: vi.fn(),
          },
          reasoning: {
            value: "medium",
            options: [],
            onChange: vi.fn(),
          },
        }}
      />,
    );

    const footer = screen.getByTestId("footer-start");
    expect(footer.textContent).toBe("Model selectorWorking copy");
    expect(screen.getByRole("button", { name: "Working copy" })).toBeTruthy();
  });
});
