import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  findLocalPathProjectSourceForHost,
  PERSONAL_PROJECT_ID,
} from "@bb/domain";
import type { NewThreadComposerProps, NewThreadRequest } from "@bb/plugin-sdk";
import type { CreateExecutionInputSources } from "@bb/server-contract";
import { Button } from "@bb/shared-ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { NewThreadPromptBox } from "@/components/promptbox/NewThreadPromptBox";
import { withAutomationPromptAction } from "@/components/promptbox/PromptBoxActionsMenu";
import { buildProviderPromptActionProps } from "@/components/promptbox/mentions/command-trigger";
import type { PromptBoxHandle } from "@/components/promptbox/PromptBoxInternal";
import type { PromptMentionLinkResolver } from "@/components/promptbox/editor/prompt-mention-link";
import {
  encodeHostValue,
  encodeReuseValue,
  parseEnvironmentValue,
} from "@/components/pickers/environment-picker-value";
import type { ProjectSelectorOption } from "@/components/pickers/ProjectSelector";
import { PluginContext } from "@/components/plugin/plugin-context";
import { WorkingCopyManagerDialog } from "@/components/dialogs/WorkingCopyManagerDialog";
import { newThreadEnvironmentArgsToSeed } from "@/components/plugin/new-thread-environment-seed";
import { useUploadPromptAttachment } from "@/hooks/mutations/project-mutations";
import {
  useProjectPromptHistory,
  useProjectSourceBranches,
  stripProjectThreads,
} from "@/hooks/queries/project-queries";
import { useProjectDefaultExecutionOptions } from "@/hooks/queries/project-default-execution-options-query";
import { selectPrimaryHost, useHosts } from "@/hooks/queries/host-queries";
import { useSidebarNavigation } from "@/hooks/queries/sidebar-navigation-query";
import { useSystemConfig } from "@/hooks/queries/system-queries";
import { useThreads } from "@/hooks/queries/thread-queries";
import { useEnvironments } from "@/hooks/queries/environment-queries";
import { useCommandSuggestions } from "@/hooks/useCommandSuggestions";
import { usePromptDraftStorage } from "@/hooks/usePromptDraftStorage";
import { usePromptMentions } from "@/hooks/usePromptMentions";
import { useThreadCreationOptions } from "@/hooks/useThreadCreationOptions";
import { getMutationErrorMessage } from "@/lib/mutation-errors";
import { getEnvironmentWorkspaceLabelIconName } from "@/lib/environment-workspace-display";
import { promptHistoryEntriesToDrafts } from "@/lib/prompt-history";
import {
  getProjectStoredPromptAttachmentPaths,
  promptDraftToInput,
} from "@/lib/prompt-draft";
import {
  getProjectComposeRoutePath,
  getThreadRoutePath,
  isProjectlessProjectId,
} from "@/lib/route-paths";
import { sdk } from "@/lib/sdk";
import { callPluginRpc } from "@/lib/plugin-sdk-hooks";
import { buildRootComposeBranchUiState } from "@/views/root-compose-branch-ui";
import type { RootComposeBranchEnvironmentMode } from "@/views/root-compose-branch-ui";
import { useScopedBranchSelection } from "@/views/root-compose-branch-selection";
import { resolveRootComposeThreadEnvironment } from "@/views/root-compose-thread-environment";
import {
  buildReuseThreadOptions,
  isProjectSourceWorktreeUnavailable,
  PROJECT_SOURCE_WORKTREE_DISABLED_REASON,
  resolveRootComposeEffectiveEnvironmentValue,
  resolveRootComposeProjectRouting,
  resolveRootComposeProviderRouting,
} from "@/views/root-compose-environment-selection";

/**
 * Host implementation of the SDK's `experimental_NewThreadComposer` — the
 * create-side counterpart to `PluginThreadChat`.
 *
 * It adapts `NewThreadPromptBox` (the exact component the primary new-thread
 * view renders) by assembling the same config objects from the same reusable
 * hooks, skipping the page-level extras a plugin surface has no use for: fork
 * seeds, quick-create-project, the guided machine-setup dialog, the
 * welcome/empty states, and codex-version submit blocking. `RootComposeView`
 * is deliberately left untouched — this is additive, so the primary compose
 * surface carries zero regression risk. The cost is that the config assembly
 * below is a second copy of that view's, which can drift; see
 * docs/api_to_audit.md.
 *
 * The composer resolves selections and hands them to `onSubmit`; the PLUGIN
 * performs the creation through `bb.sdk.threads.spawn`, which is what keeps
 * `origin: "plugin"` + `originPluginId` attribution correct.
 */
interface PluginNewThreadComposerInternalProps extends NewThreadComposerProps {
  /** Host-owned project-workspace affordance; deliberately not public plugin API. */
  workspaceEnvironmentChoices?: boolean;
  /** Identifies the other project-workspace agent when it already owns a worktree. */
  workspaceEnvironmentPeer?: {
    environmentId: string;
    label: "Build" | "Agent 2";
    taskKey: string | null;
  } | null;
}

function terminalTaskThreadIds(value: unknown): Set<string> {
  if (typeof value !== "object" || value === null || !("states" in value)) {
    return new Set();
  }
  const states = (value as { states?: unknown }).states;
  if (!Array.isArray(states)) return new Set();
  return new Set(
    states.flatMap((state) => {
      if (typeof state !== "object" || state === null) return [];
      const row = state as { status?: unknown; threadId?: unknown };
      return (row.status === "done" || row.status === "canceled") &&
        typeof row.threadId === "string"
        ? [row.threadId]
        : [];
    }),
  );
}

export function PluginNewThreadComposer({
  defaultProjectId,
  defaultProviderId,
  defaultModel,
  defaultReasoningLevel,
  defaultServiceTier,
  defaultPermissionMode,
  defaultEnvironment,
  initialPrompt,
  placeholder,
  layout = "contained",
  focusRequest,
  className,
  draftKey,
  onSubmit,
  workspaceEnvironmentChoices = false,
  workspaceEnvironmentPeer = null,
}: PluginNewThreadComposerInternalProps) {
  // Null outside a plugin slot mount (host-internal usages, tests).
  const pluginId = useContext(PluginContext);
  const navigate = useNavigate();
  const promptBoxRef = useRef<PromptBoxHandle>(null);
  const [workingCopyManagerOpen, setWorkingCopyManagerOpen] = useState(false);

  // --- Project selection -------------------------------------------------
  const sidebarNavigationQuery = useSidebarNavigation();
  const projects = useMemo(
    () => sidebarNavigationQuery.data?.projects.map(stripProjectThreads),
    [sidebarNavigationQuery.data],
  );
  const [pickedProjectId, setPickedProjectId] = useState<string | null>(
    defaultProjectId ?? null,
  );
  const [seededDefaultProjectId, setSeededDefaultProjectId] =
    useState(defaultProjectId);
  // Re-seed during render (not in an effect) so a new `defaultProjectId` never
  // paints one frame of the previous project's environment options.
  if (seededDefaultProjectId !== defaultProjectId) {
    setSeededDefaultProjectId(defaultProjectId);
    setPickedProjectId(defaultProjectId ?? null);
  }

  // --- Execution/environment seeds ---------------------------------------
  // The `default*` props are seeds, value-compared so a plugin can pass a
  // fresh `defaultEnvironment` object each render. A signature change means
  // the caller switched records: it re-seeds every selection (via the
  // creation-options resetKey below), including ones the user had touched.
  // `defaultProjectId` is part of the identity so switching to a record that
  // differs ONLY by project still clears the previous record's branch
  // override — otherwise record two would lose its branch seed.
  const seedSignature = JSON.stringify([
    defaultProjectId ?? null,
    defaultProviderId ?? null,
    defaultModel ?? null,
    defaultReasoningLevel ?? null,
    defaultServiceTier ?? null,
    defaultPermissionMode ?? null,
    defaultEnvironment ?? null,
  ]);
  const environmentSeed =
    defaultEnvironment === undefined
      ? null
      : newThreadEnvironmentArgsToSeed(defaultEnvironment);
  // The seeded branch shows until the user picks or clears one; re-seed on a
  // signature change so switching records reloads that record's branch.
  const [seededSignature, setSeededSignature] = useState(seedSignature);
  const [branchSeedOverridden, setBranchSeedOverridden] = useState(false);
  if (seededSignature !== seedSignature) {
    setSeededSignature(seedSignature);
    setBranchSeedOverridden(false);
  }
  const projectId = useMemo(() => {
    const candidate = pickedProjectId ?? PERSONAL_PROJECT_ID;
    if (isProjectlessProjectId(candidate)) return PERSONAL_PROJECT_ID;
    if (!projects) return candidate;
    return projects.some((project) => project.id === candidate)
      ? candidate
      : PERSONAL_PROJECT_ID;
  }, [pickedProjectId, projects]);
  const isProjectless = isProjectlessProjectId(projectId);
  const currentProject = useMemo(
    () =>
      isProjectless
        ? sidebarNavigationQuery.data?.personalProject
        : projects?.find((project) => project.id === projectId),
    [isProjectless, projectId, projects, sidebarNavigationQuery.data],
  );
  const projectSources = useMemo(
    () => currentProject?.sources ?? [],
    [currentProject?.sources],
  );
  const projectOptions = useMemo(
    (): readonly ProjectSelectorOption[] =>
      projects?.map((project) => ({ id: project.id, name: project.name })) ??
      [],
    [projects],
  );

  // --- Hosts and reusable worktrees --------------------------------------
  const hostsQuery = useHosts();
  const systemConfigQuery = useSystemConfig();
  const primaryHostId =
    selectPrimaryHost(
      hostsQuery.data,
      systemConfigQuery.data?.primaryHostId ?? null,
    )?.id ?? null;
  const knownHostIds = useMemo(
    () => new Set((hostsQuery.data ?? []).map((host) => host.id)),
    [hostsQuery.data],
  );
  const worktreeHostNameById = useMemo(() => {
    const hosts = hostsQuery.data ?? [];
    if (hosts.length <= 1) return null;
    return new Map(hosts.map((host) => [host.id, host.name]));
  }, [hostsQuery.data]);
  const threadsQuery = useThreads(
    { projectId, archived: false },
    { enabled: Boolean(projectId) },
  );
  const environmentsQuery = useEnvironments(projectId, {
    enabled: Boolean(projectId),
  });
  const rawReuseThreadOptions = useMemo(
    () =>
      buildReuseThreadOptions(
        threadsQuery.data ?? [],
        worktreeHostNameById,
      ).filter((option) =>
        (environmentsQuery.data ?? []).some(
          (environment) =>
            environment.id === option.environmentId &&
            environment.status === "ready",
        ),
      ),
    [environmentsQuery.data, threadsQuery.data, worktreeHostNameById],
  );
  const reusableThreadIds = useMemo(
    () =>
      rawReuseThreadOptions.flatMap((option) =>
        option.threads.map((thread) => thread.id),
      ),
    [rawReuseThreadOptions],
  );
  const taskWorkingCopyStates = useQuery({
    queryKey: ["tasksWorkingCopyThreadStates", reusableThreadIds],
    queryFn: () =>
      callPluginRpc(fetch, "tasks", "getWorkingCopyThreadStates", {
        threadIds: reusableThreadIds,
      }),
    enabled: reusableThreadIds.length > 0,
    retry: false,
  });
  const reuseThreadOptions = useMemo(() => {
    if (
      reusableThreadIds.length > 0 &&
      taskWorkingCopyStates.data === undefined
    ) {
      return [];
    }
    const terminalIds = terminalTaskThreadIds(taskWorkingCopyStates.data);
    return rawReuseThreadOptions.filter(
      (option) =>
        option.threads.length === 0 ||
        !option.threads.every((thread) => terminalIds.has(thread.id)),
    );
  }, [
    rawReuseThreadOptions,
    reusableThreadIds.length,
    taskWorkingCopyStates.data,
  ]);

  // --- Execution options --------------------------------------------------
  const resolveProviderRouting = useCallback(
    (environmentSelectionValue: string) =>
      resolveRootComposeProviderRouting({
        environmentSelectionValue,
        isProjectless,
        knownHostIds,
        primaryHostId,
        projectSources,
        reuseThreadOptions,
        reuseThreadOptionsLoading: threadsQuery.isLoading,
      }),
    [
      isProjectless,
      knownHostIds,
      primaryHostId,
      projectSources,
      reuseThreadOptions,
      threadsQuery.isLoading,
    ],
  );
  const projectDefaultExecutionOptionsQuery = useProjectDefaultExecutionOptions(
    { projectId },
    {
      enabled:
        currentProject !== undefined &&
        currentProject.defaultExecutionOptions === null,
    },
  );
  const projectDefaults =
    currentProject?.defaultExecutionOptions ??
    projectDefaultExecutionOptionsQuery.data ??
    null;
  // "component-local" keeps every pick inside this composer: a plugin panel
  // must not rewrite the user's persisted root-composer defaults. The
  // `default*` seed props take precedence over the project's remembered
  // defaults; the seed signature in resetKey makes a seed change reset even
  // user-touched selections (switching saved records must reload them).
  const workspaceEnvironmentSeed =
    workspaceEnvironmentChoices && primaryHostId !== null && !isProjectless
      ? encodeHostValue(primaryHostId, "worktree")
      : undefined;
  const creationOptions = useThreadCreationOptions({
    scope: "component-local",
    preferenceProjectId: projectId,
    resetKey: `${projectId} ${seedSignature}`,
    resolveProviderRouting,
    initialProviderId: defaultProviderId ?? projectDefaults?.providerId,
    initialModel: defaultModel ?? projectDefaults?.model,
    initialServiceTier: defaultServiceTier ?? projectDefaults?.serviceTier,
    initialReasoningLevel:
      defaultReasoningLevel ?? projectDefaults?.reasoningLevel,
    initialPermissionMode:
      defaultPermissionMode ?? projectDefaults?.permissionMode,
    initialEnvironmentSelectionValue:
      environmentSeed?.selectionValue ?? workspaceEnvironmentSeed,
  });
  const {
    activeModel,
    executionInputSources,
    executionOptionsRouting,
    environmentSelectionValue,
    hasMultipleProviders,
    isLoadingModels,
    modelLoadError,
    modelLoadFailed,
    modelOptions,
    moreModelOptions,
    permissionMode,
    permissionModeOptions,
    providerOptions,
    reasoningLevel,
    reasoningOptions,
    selectedModel,
    selectedProviderComposerActions,
    selectedProviderId,
    serviceTier,
    serviceTierSupportByProvider,
    setEnvironmentSelectionValue: setCreationEnvironmentSelectionValue,
    setPermissionMode,
    setReasoningLevel,
    setSelectedModel,
    setSelectedProviderId,
    setServiceTier,
    supportsPermissionModeSelection,
    supportsServiceTier,
  } = creationOptions;
  const selectedThreadModel = activeModel?.model ?? selectedModel;
  // Changing the environment retires the seeded branch for good. Without this,
  // switching away and back would resurrect it — the seed is keyed on the
  // environment matching, so returning would silently re-apply a branch the
  // user had already navigated out of.
  const setEnvironmentSelectionValue = useCallback(
    (value: string) => {
      setBranchSeedOverridden(true);
      setCreationEnvironmentSelectionValue(value);
    },
    [setCreationEnvironmentSelectionValue],
  );
  // Provenance for the seeded execution fields. "explicit" is right whether or
  // not the user then changed the value: either way it is a concrete choice
  // the composer displayed, not a default the server should re-derive. Fields
  // with no seed keep the hook's own provenance, so an unseeded caller sends
  // exactly what it sent before.
  const seededExecutionInputSources = useMemo(
    (): CreateExecutionInputSources => ({
      ...(defaultProviderId !== undefined
        ? { providerId: "explicit" as const }
        : {}),
      ...(defaultModel !== undefined ? { model: "explicit" as const } : {}),
      ...(defaultReasoningLevel !== undefined
        ? { reasoningLevel: "explicit" as const }
        : {}),
      // Mirrors the submitted request, which omits serviceTier entirely when
      // the selected provider has no tiers.
      ...(defaultServiceTier !== undefined && supportsServiceTier && serviceTier
        ? { serviceTier: "explicit" as const }
        : {}),
      ...(defaultPermissionMode !== undefined
        ? { permissionMode: "explicit" as const }
        : {}),
    }),
    [
      defaultModel,
      defaultPermissionMode,
      defaultProviderId,
      defaultReasoningLevel,
      defaultServiceTier,
      serviceTier,
      supportsServiceTier,
    ],
  );

  // --- Environment / branch selection -------------------------------------
  const effectiveEnvironmentValue = useMemo(
    () =>
      resolveRootComposeEffectiveEnvironmentValue({
        environmentSelectionValue,
        isProjectless,
        knownHostIds,
        primaryHostId,
        projectSources,
        reuseThreadOptions,
        reuseThreadOptionsLoading: threadsQuery.isLoading,
      }),
    [
      environmentSelectionValue,
      isProjectless,
      knownHostIds,
      primaryHostId,
      projectSources,
      reuseThreadOptions,
      threadsQuery.isLoading,
    ],
  );
  const parsedEnvironment = useMemo(
    () => parseEnvironmentValue(effectiveEnvironmentValue),
    [effectiveEnvironmentValue],
  );
  const isHostMode = parsedEnvironment?.type === "host";
  const branchEnvironmentMode: RootComposeBranchEnvironmentMode = isProjectless
    ? "other"
    : isHostMode && parsedEnvironment.mode === "local"
      ? "local"
      : isHostMode && parsedEnvironment.mode === "worktree"
        ? "worktree"
        : "other";
  const {
    selectedBranch: pickedBranch,
    onBranchChange,
    onClearBranch,
    onCreateBranch: handleCreateBranch,
    onCreateBranchFrom,
  } = useScopedBranchSelection({
    environmentValue: effectiveEnvironmentValue,
    projectId,
  });
  // The seeded branch backs the picker only while the user has not picked or
  // cleared one AND the environment still matches the seed — a manual pick,
  // clear, or environment change makes the composer behave exactly as if the
  // seed were absent.
  const selectedBranch =
    pickedBranch ??
    (!branchSeedOverridden &&
    environmentSeed !== null &&
    effectiveEnvironmentValue === environmentSeed.selectionValue
      ? environmentSeed.branch
      : null);
  const handleBranchChange = useCallback(
    (name: string) => {
      setBranchSeedOverridden(true);
      onBranchChange(name);
    },
    [onBranchChange],
  );
  const handleClearBranch = useCallback(() => {
    setBranchSeedOverridden(true);
    onClearBranch();
  }, [onClearBranch]);
  const handleCreateBranchFrom = useCallback(
    (name: string) => {
      setBranchSeedOverridden(true);
      onCreateBranchFrom(name);
    },
    [onCreateBranchFrom],
  );
  const [branchSearchQuery, setBranchSearchQuery] = useState("");
  useEffect(() => {
    setBranchSearchQuery("");
  }, [effectiveEnvironmentValue, projectId]);
  const branchesQuery = useProjectSourceBranches(
    projectId,
    isHostMode ? parsedEnvironment.hostId : null,
    {
      enabled: isHostMode && !isProjectless,
      query: branchSearchQuery,
      selectedBranch: selectedBranch?.name ?? "",
    },
  );
  const projectSourceWorktreeUnavailable = isProjectSourceWorktreeUnavailable(
    branchesQuery.data,
  );
  const requestsManagedWorktree =
    isHostMode && parsedEnvironment.mode === "worktree";
  const managedWorktreeAvailabilityPending =
    requestsManagedWorktree && !isProjectless && branchesQuery.isLoading;
  const managedWorktreeUnavailable =
    requestsManagedWorktree && projectSourceWorktreeUnavailable;
  useEffect(() => {
    if (!projectSourceWorktreeUnavailable || !requestsManagedWorktree) return;
    if (parsedEnvironment?.type !== "host") return;
    // A host-driven correction, not a user pick, so it uses the raw setter:
    // retiring the branch seed is reserved for the user changing environment.
    setCreationEnvironmentSelectionValue(
      encodeHostValue(parsedEnvironment.hostId, "local"),
    );
  }, [
    parsedEnvironment,
    projectSourceWorktreeUnavailable,
    requestsManagedWorktree,
    setCreationEnvironmentSelectionValue,
  ]);
  const branchOptions = useMemo(() => {
    const branches = branchesQuery.data?.branches ?? [];
    const selectedRef = branchesQuery.data?.selectedBranch;
    return selectedRef?.kind === "local" && !branches.includes(selectedRef.name)
      ? [selectedRef.name, ...branches]
      : branches;
  }, [branchesQuery.data?.branches, branchesQuery.data?.selectedBranch]);
  const remoteBranchOptions = useMemo(() => {
    if (branchEnvironmentMode === "other") return [];
    const branches = branchesQuery.data?.remoteBranches ?? [];
    const selectedRef = branchesQuery.data?.selectedBranch;
    return selectedRef?.kind === "remote" &&
      !branches.includes(selectedRef.name)
      ? [selectedRef.name, ...branches]
      : branches;
  }, [
    branchEnvironmentMode,
    branchesQuery.data?.remoteBranches,
    branchesQuery.data?.selectedBranch,
  ]);
  const branchSelectionSeed =
    branchEnvironmentMode === "local" &&
    branchesQuery.data?.checkout.kind === "branch"
      ? branchesQuery.data.checkout.branchName
      : branchEnvironmentMode === "worktree"
        ? (branchesQuery.data?.defaultWorktreeBaseBranch ??
          branchesQuery.data?.defaultBranch ??
          null)
        : null;
  const branchUiState = useMemo(
    () =>
      buildRootComposeBranchUiState({
        checkout: branchesQuery.data,
        isFetching: branchesQuery.isFetching,
        isLoading: branchesQuery.isLoading,
        mode: branchEnvironmentMode,
        selectedBranch,
      }),
    [
      branchEnvironmentMode,
      branchesQuery.data,
      branchesQuery.isFetching,
      branchesQuery.isLoading,
      selectedBranch,
    ],
  );
  const refetchBranches = branchesQuery.refetch;
  const handleBranchOpenChange = useCallback(
    (open: boolean) => {
      if (open) void refetchBranches();
    },
    [refetchBranches],
  );
  const selectedBranchName = selectedBranch?.name ?? null;
  const handleCreateBranchFromSeed = useCallback(() => {
    setBranchSeedOverridden(true);
    // Prefer the effective selection (which may be the environment seed's
    // branch) as the base — the hook only knows about manual picks.
    handleCreateBranch(selectedBranchName ?? branchSelectionSeed);
  }, [branchSelectionSeed, handleCreateBranch, selectedBranchName]);
  const selectedEnvironment = useMemo(
    () =>
      resolveRootComposeThreadEnvironment({
        defaultBranch: branchesQuery.data?.defaultBranch,
        defaultWorktreeBaseBranch:
          branchesQuery.data?.defaultWorktreeBaseBranch,
        environmentValue: effectiveEnvironmentValue,
        projectId,
        selectedBranch,
      }),
    [
      branchesQuery.data?.defaultBranch,
      branchesQuery.data?.defaultWorktreeBaseBranch,
      effectiveEnvironmentValue,
      projectId,
      selectedBranch,
    ],
  );

  // --- Draft, mentions, commands, attachments -----------------------------
  const promptDraft = usePromptDraftStorage({
    kind: "plugin-new-thread",
    key: draftKey ?? pluginId ?? "default",
  });
  const seedInitialPrompt = promptDraft.restoreIfEmpty;
  useEffect(() => {
    if (initialPrompt === undefined || initialPrompt.length === 0) return;
    seedInitialPrompt({ text: initialPrompt, mentions: [], attachments: [] });
  }, [initialPrompt, seedInitialPrompt]);
  useEffect(() => {
    if (focusRequest === undefined) return;
    promptBoxRef.current?.focusEnd();
  }, [focusRequest]);

  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [isCopyingAttachments, setIsCopyingAttachments] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const uploadPromptAttachment = useUploadPromptAttachment();
  const handleAttachFiles = useCallback(
    async (files: File[]) => {
      if (!projectId || files.length === 0) return;
      setAttachmentError(null);
      for (const file of files) {
        try {
          const uploaded = await uploadPromptAttachment.mutateAsync({
            projectId,
            file,
          });
          promptDraft.addAttachment(uploaded);
        } catch (error) {
          setAttachmentError(
            getMutationErrorMessage({
              error,
              fallbackMessage: "Attachment upload failed",
            }),
          );
          break;
        }
      }
    },
    [projectId, promptDraft, uploadPromptAttachment],
  );

  const reuseEnvironmentId =
    parsedEnvironment?.type === "reuse"
      ? parsedEnvironment.environmentId
      : null;
  const projectRouting = resolveRootComposeProjectRouting(
    parsedEnvironment,
    primaryHostId,
  );
  const resolveMentionLink = useCallback<PromptMentionLinkResolver>(
    (resource) => {
      if (resource.kind === "thread") {
        const targetProjectId = resource.projectId ?? projectId;
        return () =>
          navigate(
            getThreadRoutePath({
              projectId: targetProjectId,
              threadId: resource.threadId,
            }),
          );
      }
      if (resource.kind === "project") {
        return () => navigate(getProjectComposeRoutePath(resource.projectId));
      }
      return null;
    },
    [navigate, projectId],
  );
  const promptMentions = usePromptMentions(
    isProjectless ? undefined : projectId,
    {
      environmentId: reuseEnvironmentId,
      hostId: projectRouting.hostId ?? null,
    },
  );
  const [commandQuery, setCommandQuery] = useState<string | null>(null);
  const providerPromptActions = useMemo(
    () => buildProviderPromptActionProps(selectedProviderComposerActions),
    [selectedProviderComposerActions],
  );
  const promptActions = useMemo(
    () => withAutomationPromptAction(providerPromptActions.promptActions),
    [providerPromptActions.promptActions],
  );
  const commandSuggestions = useCommandSuggestions({
    projectId,
    providerId: selectedProviderId,
    skillsTrigger: providerPromptActions.skillsTrigger,
    promptActions,
    environmentId: reuseEnvironmentId,
    hostId: projectRouting.hostId ?? null,
    query: commandQuery,
  });

  const { data: projectPromptHistory = [] } =
    useProjectPromptHistory(projectId);
  const promptHistoryDrafts = useMemo(
    () => promptHistoryEntriesToDrafts(projectPromptHistory),
    [projectPromptHistory],
  );
  const currentDraft = useMemo(
    () => ({
      text: promptDraft.text,
      mentions: promptDraft.mentions,
      attachments: promptDraft.attachments,
    }),
    [promptDraft.attachments, promptDraft.mentions, promptDraft.text],
  );
  const promptInput = useMemo(
    () => promptDraftToInput(currentDraft),
    [currentDraft],
  );

  // --- Submit --------------------------------------------------------------
  const isSubmitDisabled =
    !selectedProviderId ||
    isLoadingModels ||
    modelLoadError?.code === "missing_executable" ||
    modelLoadError?.code === "auth_required" ||
    !selectedThreadModel ||
    isSubmitting ||
    isCopyingAttachments ||
    promptInput.length === 0 ||
    selectedEnvironment === null ||
    managedWorktreeAvailabilityPending ||
    managedWorktreeUnavailable ||
    (branchEnvironmentMode === "local" &&
      selectedBranch !== null &&
      branchUiState.mutationBlocker !== null);

  const handleSubmit = useCallback(async () => {
    const submittedDraft = promptDraft.getCurrent();
    const input = promptDraftToInput(submittedDraft);
    if (
      input.length === 0 ||
      isSubmitting ||
      selectedEnvironment === null ||
      !selectedProviderId ||
      !selectedThreadModel ||
      managedWorktreeAvailabilityPending ||
      managedWorktreeUnavailable
    ) {
      return;
    }
    const request: NewThreadRequest = {
      projectId,
      providerId: selectedProviderId,
      model: selectedThreadModel,
      reasoningLevel,
      permissionMode,
      ...(supportsServiceTier && serviceTier ? { serviceTier } : {}),
      // A seeded field is a caller-explicit value, so it must carry a
      // provenance source: the server DISCARDS a requested providerId/model
      // whose source key is absent (resolveRequestedCreateExecutionValue) and
      // falls back to the project's stored defaults — which would silently
      // undo the very seeds the caller passed in. `component-local` scope
      // never reports a providerId source at all, so seeding is the only
      // thing that makes the composer's provider survive the round trip.
      executionInputSources: {
        ...executionInputSources,
        ...seededExecutionInputSources,
      },
      environment: selectedEnvironment,
      input,
    };
    setIsSubmitting(true);
    try {
      await onSubmit(request);
      // Only a resolved submit clears the draft — a plugin whose create call
      // throws keeps everything the user typed.
      promptDraft.clearIfCurrentMatches(submittedDraft);
    } catch {
      // The plugin owns surfacing its own creation failure.
    } finally {
      setIsSubmitting(false);
    }
  }, [
    executionInputSources,
    isSubmitting,
    managedWorktreeAvailabilityPending,
    managedWorktreeUnavailable,
    onSubmit,
    permissionMode,
    projectId,
    seededExecutionInputSources,
    promptDraft,
    reasoningLevel,
    selectedEnvironment,
    selectedProviderId,
    selectedThreadModel,
    serviceTier,
    supportsServiceTier,
  ]);

  const handleProjectChange = useCallback(
    async (nextProjectId: string | null) => {
      const nextValue = nextProjectId ?? PERSONAL_PROJECT_ID;
      if (nextValue === projectId || isCopyingAttachments) return;
      const attachmentPaths = getProjectStoredPromptAttachmentPaths(
        promptDraft.getCurrent().attachments,
      );
      if (attachmentPaths.length > 0) {
        setAttachmentError(null);
        setIsCopyingAttachments(true);
        try {
          await sdk.projects.attachments.copy({
            projectId: nextValue,
            sourceProjectId: projectId,
            paths: attachmentPaths,
          });
        } catch (error) {
          setAttachmentError(
            getMutationErrorMessage({
              error,
              fallbackMessage:
                "Attachments could not be moved to the selected project",
            }),
          );
          return;
        } finally {
          setIsCopyingAttachments(false);
        }
      }
      setPickedProjectId(nextValue);
    },
    [isCopyingAttachments, projectId, promptDraft],
  );

  const handleWorktreeChange = useCallback(
    (environmentId: string) => {
      setEnvironmentSelectionValue(encodeReuseValue(environmentId));
    },
    [setEnvironmentSelectionValue],
  );

  const hasWorkspaceEnvironmentPicker =
    workspaceEnvironmentChoices && primaryHostId !== null && !isProjectless;
  const isolatedWorkspaceLabel = projectSourceWorktreeUnavailable
    ? "New isolated working copy unavailable"
    : "New isolated working copy — Recommended";
  const reusedWorkspace =
    parsedEnvironment?.type === "reuse"
      ? reuseThreadOptions.find(
          (option) => option.environmentId === parsedEnvironment.environmentId,
        )
      : undefined;
  const currentProjectFolder =
    primaryHostId === null
      ? null
      : (findLocalPathProjectSourceForHost(projectSources, primaryHostId)
          ?.path ?? null);
  const reusedWorkspaceIsPeer =
    reusedWorkspace !== undefined &&
    workspaceEnvironmentPeer?.environmentId === reusedWorkspace.environmentId;
  const reusedWorkspaceTaskLabel =
    reusedWorkspaceIsPeer && workspaceEnvironmentPeer?.taskKey
      ? workspaceEnvironmentPeer.taskKey
      : reusedWorkspace
        ? (reusedWorkspace.threads[0]?.title ??
          reusedWorkspace.name ??
          reusedWorkspace.branchName ??
          "previous task")
        : "previous task";
  const reusedWorkspaceShareLabel =
    reusedWorkspaceIsPeer && workspaceEnvironmentPeer
      ? ` — Shared with ${workspaceEnvironmentPeer.label}`
      : " — Shared";
  const workspaceSelectionLabel =
    parsedEnvironment?.type === "reuse"
      ? `Share files with ${reusedWorkspaceTaskLabel}${reusedWorkspaceShareLabel}`
      : parsedEnvironment?.type === "host" && parsedEnvironment.mode === "local"
        ? "This project folder — Shared"
        : isolatedWorkspaceLabel;
  const workspaceControlLabel =
    parsedEnvironment?.type === "reuse"
      ? reusedWorkspaceTaskLabel
      : parsedEnvironment?.type === "host" && parsedEnvironment.mode === "local"
        ? "Project folder"
        : projectSourceWorktreeUnavailable
          ? "New copy unavailable"
          : "New copy";
  const workspaceIcon = getEnvironmentWorkspaceLabelIconName(
    parsedEnvironment?.type === "host" && parsedEnvironment.mode === "local"
      ? "other"
      : "managed-worktree",
  );
  const workspaceEnvironmentControl = hasWorkspaceEnvironmentPicker ? (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          aria-label={`Working copy: ${workspaceSelectionLabel}`}
          className="h-7 min-w-0 max-w-40 gap-1 px-2 text-xs text-muted-foreground"
        >
          <Icon name={workspaceIcon} className="size-3.5 shrink-0" />
          <span title={workspaceSelectionLabel} className="truncate">
            {workspaceControlLabel}
          </span>
          <Icon name="ChevronDown" className="size-3 shrink-0 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-[min(30rem,calc(100vw-2rem))]"
        mobileTitle="Working copy"
      >
        <DropdownMenuLabel>Start fresh</DropdownMenuLabel>
        <DropdownMenuCheckboxItem
          checked={
            effectiveEnvironmentValue ===
            encodeHostValue(primaryHostId, "worktree")
          }
          disabled={projectSourceWorktreeUnavailable}
          onSelect={() =>
            setEnvironmentSelectionValue(
              encodeHostValue(primaryHostId, "worktree"),
            )
          }
          className="items-start py-2.5"
        >
          <span className="flex flex-col gap-0.5 pr-2">
            <span className="font-medium text-foreground">
              {isolatedWorkspaceLabel}
            </span>
            <span className="text-2xs leading-4 text-muted-foreground">
              Creates a new folder and branch. It won&apos;t affect this project
              folder or include its uncommitted changes.
            </span>
          </span>
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Use existing files</DropdownMenuLabel>
        <DropdownMenuCheckboxItem
          checked={
            effectiveEnvironmentValue ===
            encodeHostValue(primaryHostId, "local")
          }
          onSelect={() =>
            setEnvironmentSelectionValue(
              encodeHostValue(primaryHostId, "local"),
            )
          }
          className="items-start py-2.5"
        >
          <span className="flex flex-col gap-0.5 pr-2">
            <span className="font-medium text-foreground">
              This project folder — Shared
            </span>
            <span className="text-2xs leading-4 text-muted-foreground">
              Edits {currentProjectFolder ?? "the project folder"} directly. You
              and other agents using it share uncommitted changes.
            </span>
          </span>
        </DropdownMenuCheckboxItem>
        {reuseThreadOptions.length > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Active working copies</DropdownMenuLabel>
            {reuseThreadOptions.map((option) => {
              const isPeer =
                workspaceEnvironmentPeer?.environmentId ===
                option.environmentId;
              const taskLabel =
                isPeer && workspaceEnvironmentPeer?.taskKey
                  ? workspaceEnvironmentPeer.taskKey
                  : (option.threads[0]?.title ??
                    option.name ??
                    option.branchName ??
                    "previous task");
              const peerLabel = isPeer
                ? (workspaceEnvironmentPeer?.label ?? null)
                : null;
              const optionValue = encodeReuseValue(option.environmentId);
              return (
                <DropdownMenuCheckboxItem
                  key={option.environmentId}
                  checked={effectiveEnvironmentValue === optionValue}
                  onSelect={() => setEnvironmentSelectionValue(optionValue)}
                  className="items-start py-2.5"
                >
                  <span className="flex flex-col gap-0.5 pr-2">
                    <span className="font-medium text-foreground">
                      Share files with {taskLabel}
                      {peerLabel ? ` — Shared with ${peerLabel}` : " — Shared"}
                    </span>
                    <span className="text-2xs leading-4 text-muted-foreground">
                      {option.branchName ? `Branch ${option.branchName}. ` : ""}
                      {peerLabel
                        ? `Uses the same folder and branch as ${peerLabel}. Both agents see uncommitted changes immediately.`
                        : `Reuses ${taskLabel}'s folder and branch. Agents there see the same uncommitted changes immediately.`}
                    </span>
                  </span>
                </DropdownMenuCheckboxItem>
              );
            })}
          </>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => setWorkingCopyManagerOpen(true)}>
          <Icon name="Settings" className="size-3.5" />
          Manage working copies…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ) : null;

  return (
    <div
      className={cn(
        layout === "contained"
          ? "flex h-full min-h-0 flex-col justify-end"
          : "flex flex-col",
        className,
      )}
    >
      <NewThreadPromptBox
        promptBoxRef={promptBoxRef}
        value={promptDraft.text}
        mentionRanges={promptDraft.mentions}
        onChange={promptDraft.setTextAndMentions}
        onSubmit={() => void handleSubmit()}
        isSubmitting={isSubmitting}
        disabled={isSubmitDisabled}
        placeholder={placeholder}
        zenModeStorageKey={`bb.promptbox.zen-mode.plugin-new-thread.${
          draftKey ?? pluginId ?? "default"
        }`}
        history={{
          currentDraft,
          entries: promptHistoryDrafts,
          onSelectEntry: promptDraft.setDraft,
          resetKey: projectId,
        }}
        typeahead={{
          mention: {
            triggers: promptMentions.triggers,
            suggestions: promptMentions.suggestions,
            isLoading: promptMentions.isLoading,
            isError: promptMentions.isError,
            onQueryChange: promptMentions.setQuery,
            resolveLink: resolveMentionLink,
          },
          command: {
            trigger: commandSuggestions.trigger,
            suggestions: commandSuggestions.suggestions,
            isLoading: commandSuggestions.isLoading,
            isError: commandSuggestions.isError,
            hasMore: commandSuggestions.hasMore,
            isLoadingMore: commandSuggestions.isLoadingMore,
            loadMore: commandSuggestions.loadMore,
            onQueryChange: setCommandQuery,
          },
        }}
        attachments={{
          items: promptDraft.attachments,
          projectId,
          onAttachFiles: handleAttachFiles,
          onRemove: promptDraft.removeAttachment,
          isAttaching: uploadPromptAttachment.isPending || isCopyingAttachments,
          error: attachmentError,
        }}
        promptActions={promptActions}
        modeConfig={{
          footerControl: workspaceEnvironmentControl,
          environment: {
            value: effectiveEnvironmentValue,
            onChange: setEnvironmentSelectionValue,
            sources: projectSources,
            reuseDisabled: reuseThreadOptions.length === 0,
            pickerHidden: hasWorkspaceEnvironmentPicker,
            worktreeDisabledReason: projectSourceWorktreeUnavailable
              ? PROJECT_SOURCE_WORKTREE_DISABLED_REASON
              : null,
          },
          branch: {
            value:
              selectedBranch?.name ??
              (branchEnvironmentMode === "worktree"
                ? branchUiState.currentBranch
                : null),
            currentBranch: branchUiState.currentBranch,
            isNew: selectedBranch?.isNew ?? false,
            hidden: projectSourceWorktreeUnavailable,
            options: branchOptions,
            remoteOptions: remoteBranchOptions,
            loading: branchesQuery.isFetching,
            placeholder: branchUiState.placeholder,
            triggerLabel: branchUiState.triggerLabel,
            triggerTitle: branchUiState.triggerTitle,
            currentOptionLabel:
              branchEnvironmentMode === "local"
                ? branchUiState.currentOptionLabel
                : null,
            currentOptionTitle:
              branchEnvironmentMode === "local"
                ? (branchUiState.currentOptionLabel ?? undefined)
                : undefined,
            optionDisabledReason: branchUiState.mutationBlocker?.label,
            optionDisabledTitle: branchUiState.mutationBlocker?.title,
            createDisabledReason: branchUiState.mutationBlocker?.label,
            createDisabledTitle: branchUiState.mutationBlocker?.title,
            onChange: handleBranchChange,
            onClear: handleClearBranch,
            onCreate: handleCreateBranchFromSeed,
            onCreateBaseChange: handleCreateBranchFrom,
            onOpenChange: handleBranchOpenChange,
            onSearchQueryChange: setBranchSearchQuery,
          },
          worktree: {
            projectId,
            options: reuseThreadOptions,
            value: reuseEnvironmentId,
            onChange: handleWorktreeChange,
          },
          permission: {
            value: permissionMode,
            options: permissionModeOptions,
            onChange: setPermissionMode,
            supported: supportsPermissionModeSelection,
          },
        }}
        project={
          workspaceEnvironmentChoices
            ? undefined
            : {
                projects: projectOptions,
                value: projectId,
                onChange: handleProjectChange,
                disabled: isCopyingAttachments,
              }
        }
        execution={{
          providerRouting: executionOptionsRouting,
          provider: {
            options: providerOptions,
            selectedId: selectedProviderId,
            onChange: setSelectedProviderId,
            hasMultiple: hasMultipleProviders,
          },
          model: {
            active: activeModel,
            selected: selectedModel,
            options: modelOptions,
            moreOptions: moreModelOptions,
            isLoading: isLoadingModels,
            loadFailed: modelLoadFailed,
            loadError: modelLoadError,
            onChange: setSelectedModel,
          },
          serviceTier: {
            value: serviceTier,
            onChange: setServiceTier,
            supported: supportsServiceTier,
            supportByProvider: serviceTierSupportByProvider,
          },
          reasoning: {
            value: reasoningLevel,
            options: reasoningOptions,
            onChange: setReasoningLevel,
          },
        }}
      />
      {hasWorkspaceEnvironmentPicker ? (
        <WorkingCopyManagerDialog
          open={workingCopyManagerOpen}
          onOpenChange={setWorkingCopyManagerOpen}
          projectId={projectId}
          initialEnvironmentId={reuseEnvironmentId}
        />
      ) : null}
    </div>
  );
}
