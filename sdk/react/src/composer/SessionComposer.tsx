"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { cn } from "@stigmer/theme";
import { getUserMessage, type AttachmentInput, type EnvVarInput, type McpServerUsageInput, type ResourceRef } from "@stigmer/sdk";
import { useComposer } from "./useComposer";
import { ComposerToolbar } from "./ComposerToolbar";
import { type ConfigureMenuItem } from "./ConfigureMenu";
import { ContextChip, type ChipItem } from "./ContextChip";
import { WorkspaceEditor } from "../workspace/WorkspaceEditor";
import { AgentPicker } from "../agent/AgentPicker";
import { AgentEnvForm, type AgentEnvFormSubmitOptions } from "../agent/AgentEnvForm";
import { useAgentSetup, type AgentResolution } from "../agent/useAgentSetup";
import { SecretFlowErrorGuide, isSecretFlowError } from "../error/SecretFlowErrorGuide";
import { McpServerPicker } from "../mcp-server/McpServerPicker";
import { useMcpServerSetup } from "../mcp-server/useMcpServerSetup";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { SkillPicker } from "../skill/SkillPicker";
import { SessionVariablesInput } from "../execution/SessionVariablesInput";
import type { UseSessionVariablesReturn } from "../execution/useSessionVariables";
import type { UseWorkspaceEntriesReturn } from "../workspace/useWorkspaceEntries";
import type { UseGitHubConnectionReturn } from "../github/useGitHubConnection";
import { useAttachments } from "../attachment/useAttachments";
import { AttachmentChipList } from "../attachment/AttachmentChipList";
import { useSessionEnvPool } from "../environment/useSessionEnvPool";
import { usePersonalEnvironment } from "../environment/usePersonalEnvironment";
import { useStigmer } from "../hooks";
import {
  SYSTEM_ENV_VAR_KEYS,
  resolveSystemEnvVarValues,
} from "../environment/systemEnvVars";
import {
  AgentIcon,
  McpServerIcon,
  SkillIcon,
  SecretsIcon,
  AlertTriangleIcon,
  ResolveSpinner,
} from "./icons";

/**
 * Context provided to `onSubmit` at the moment of submission.
 *
 * Contains aggregated one-time environment variables from all setup
 * flows managed by the composer (agent, MCP servers, manual secrets).
 * The consumer passes `context.runtimeEnv` directly to execution
 * creation without needing to understand the individual sources.
 */
export interface SessionComposerSubmitContext {
  /**
   * Aggregated one-time environment variables from all setup flows.
   *
   * Merged from (in precedence order, last-write-wins):
   * 1. Agent one-time env vars (when agent resolution mode is `"oneTime"`)
   * 2. MCP server one-time env vars (collected with `saveForFuture: false`)
   * 3. Manual session variables (from {@link SessionVariablesInput})
   *
   * `undefined` when no runtime env vars were collected from any source.
   * Pass directly to execution creation as `runtimeEnv`.
   */
  readonly runtimeEnv?: Record<string, EnvVarInput>;
  /**
   * Pre-uploaded file attachments for the execution.
   *
   * Each entry contains a `storageKey` obtained from
   * `agentExecution.uploadAttachment()`. Only successfully uploaded
   * attachments are included. Pass directly to execution creation
   * as `attachments`.
   *
   * `undefined` when no files were attached.
   */
  readonly attachments?: AttachmentInput[];
}

/** Props for {@link SessionComposer}. */
export interface SessionComposerProps {
  /**
   * Called when the user submits a message.
   *
   * The optional `context` parameter carries aggregated runtime data
   * collected by the composer's setup flows. When present,
   * `context.runtimeEnv` should be passed to execution creation.
   */
  readonly onSubmit: (
    message: string,
    modelName?: string,
    context?: SessionComposerSubmitContext,
  ) => void;
  /** Shows loading indicator on the send button. */
  readonly isSubmitting?: boolean;
  /** Disables the entire composer (e.g., while an execution streams). */
  readonly disabled?: boolean;

  /** Initial model ID for the model selector. */
  readonly defaultModelId?: string;
  /** Called when the user changes the selected model. */
  readonly onModelChange?: (modelId: string) => void;
  /** Show the model selector. @default true */
  readonly showModelSelector?: boolean;

  /**
   * Workspace state managed by {@link useWorkspaceEntries}.
   * When provided, renders a workspace trigger in the toolbar
   * that opens a popover with the workspace editor.
   */
  readonly workspace?: UseWorkspaceEntriesReturn;
  /** GitHub connection state for the repo picker. */
  readonly gitHubConnection?: UseGitHubConnectionReturn;
  /** Show the GitHub Repo source button. @default true */
  readonly enableGitHub?: boolean;
  /** Show the Local Folder source button. @default false */
  readonly enableLocal?: boolean;
  /**
   * Native folder picker callback passed through to {@link WorkspaceEditor}.
   * When provided, clicking "Local Folder" opens a native dialog instead
   * of the inline text input. See {@link WorkspaceEditorProps.onBrowseLocalFolder}.
   */
  readonly onBrowseLocalFolder?: () => Promise<string | null>;

  /**
   * Organization slug for agent, MCP server, and skill searches.
   * Required when agent, MCP, or skill pickers are enabled.
   */
  readonly org?: string;

  /**
   * Currently selected agent reference, or null if none.
   * When `onAgentRefChange` is provided, an agent trigger
   * appears in the toolbar (single-select).
   */
  readonly agentRef?: ResourceRef | null;
  /** Called when the agent selection changes. Providing this enables the agent trigger. */
  readonly onAgentRefChange?: (ref: ResourceRef | null) => void;
  /**
   * Called when the agent setup flow resolves how the agent should
   * be used for session creation.
   *
   * The {@link AgentResolution} discriminated union tells the caller
   * which session creation path to use:
   * - `"saved"` — use `agentInstanceId`
   * - `"oneTime"` — use `agentRef` + pass `runtimeEnv` to execution
   * - `"direct"` — use `agentRef` (no secrets needed)
   *
   * Set to `null` when the agent is deselected.
   */
  readonly onAgentResolutionChange?: (resolution: AgentResolution | null) => void;

  /**
   * Agent to auto-select when the composer mounts.
   *
   * When provided, the composer runs the full agent resolution flow
   * on mount — exactly as if the user had picked this agent in the
   * {@link AgentPicker}. If the agent requires credentials, the
   * environment form appears automatically.
   *
   * One-time: consumed on mount; subsequent changes are ignored.
   * To change the agent after mount, use the picker or
   * `onAgentRefChange` externally.
   *
   * Requires `org` and `onAgentRefChange` to be set (same
   * prerequisites as the agent picker).
   *
   * @example
   * ```tsx
   * <SessionComposer
   *   onSubmit={handleCreate}
   *   org="acme"
   *   agentRef={agentRef}
   *   onAgentRefChange={setAgentRef}
   *   onAgentResolutionChange={setResolution}
   *   initialAgentRef={{ org: "stigmer", slug: "agent-creator" }}
   * />
   * ```
   */
  readonly initialAgentRef?: ResourceRef;

  /**
   * Currently selected MCP server usages.
   * When `onMcpServerUsagesChange` is provided, a MCP server trigger
   * appears in the toolbar.
   */
  readonly mcpServerUsages?: McpServerUsageInput[];
  /** Called when the MCP server selection changes. Providing this enables the MCP trigger. */
  readonly onMcpServerUsagesChange?: (usages: McpServerUsageInput[]) => void;

  /**
   * Currently selected skill references.
   * When `onSkillRefsChange` is provided, a skill trigger
   * appears in the toolbar.
   */
  readonly skillRefs?: ResourceRef[];
  /** Called when the skill selection changes. Providing this enables the skill trigger. */
  readonly onSkillRefsChange?: (refs: ResourceRef[]) => void;

  /**
   * Currently selected runner ID, or `null` for "Auto" (backend decides).
   *
   * When `onRunnerIdChange` is provided and `org` is set, renders a
   * runner picker in the toolbar's Tier 1 (alongside Model Selector).
   *
   * The selected runner ID flows through to `session.create({ runnerId })`
   * so the session is bound to that runner's task queue.
   */
  readonly runnerId?: string | null;
  /**
   * Called when the user selects a different runner. `null` = "Auto".
   *
   * Providing this callback enables the runner picker in the toolbar.
   * Requires `org` to be set (same prerequisite as agent/MCP pickers).
   */
  readonly onRunnerIdChange?: (runnerId: string | null) => void;

  /**
   * Session variables state managed by {@link useSessionVariables}.
   * When provided, renders a "Session Variables" trigger in the toolbar
   * that opens a key-value editor for environment variables.
   *
   * Variables are ephemeral by default (single execution). Individual
   * entries can be marked `saveForFuture: true` to persist them to
   * the user's personal environment. The consumer should call
   * `sessionVariables.clear()` after submission.
   */
  readonly sessionVariables?: UseSessionVariablesReturn;

  /**
   * Enable file attachment support in the composer.
   *
   * When `true`, renders an attach button in the toolbar and enables
   * drag-and-drop file upload on the textarea. Attachments are uploaded
   * immediately via `agentExecution.uploadAttachment()` and included
   * in `context.attachments` on submit.
   *
   * @default true
   */
  readonly enableAttachments?: boolean;

  /**
   * Called when a file is rejected (e.g., exceeds the 10 MB limit).
   * Consumers can use this for toast notifications.
   */
  readonly onAttachmentValidationError?: (message: string) => void;

  /**
   * Files to attach programmatically when the composer mounts.
   *
   * When provided, the composer uploads these files via the same
   * attachment pipeline as user-selected files. Attachment chips
   * appear in the UI so the user sees what is attached.
   *
   * One-time: consumed when the value first becomes truthy.
   * Subsequent changes are ignored. This allows async resource
   * fetching — the effect waits for the files to be ready.
   *
   * Requires `enableAttachments` to be `true` (default).
   *
   * @example
   * ```tsx
   * const yaml = serializeAgentYaml(agent);
   * const file = new File([yaml], "my-agent.yaml", { type: "text/yaml" });
   *
   * <SessionComposer
   *   onSubmit={handleSubmit}
   *   initialAttachments={[file]}
   *   initialAgentRef={{ org: "stigmer", slug: "agent-creator" }}
   * />
   * ```
   */
  readonly initialAttachments?: File[];

  /** Placeholder text for the textarea. @default "Reply\u2026" */
  readonly placeholder?: string;
  /** Initial number of visible rows. @default 1 */
  readonly initialRows?: number;
  /** Auto-focus the textarea on mount. @default false */
  readonly autoFocus?: boolean;
  /** ARIA label for the composer region. @default "Send message" */
  readonly ariaLabel?: string;

  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * Unified message composer for Stigmer sessions.
 *
 * Combines a self-resizing textarea, model selector, and context pickers
 * (agent, workspace, MCP servers, skills) into a single input card.
 *
 * The toolbar uses a two-tier layout:
 * - **Tier 1** (always visible): Attach, Workspace, Model Selector
 * - **Tier 2** (behind Configure menu): Agent, MCP, Skills, Secrets
 *
 * Selected items render as removable chips between the textarea and toolbar.
 *
 * Used for both new session creation (launcher) and follow-up messages
 * within an existing session. Layout positioning is the consumer's
 * responsibility.
 *
 * Uses `<div role="form">` instead of `<form>` so it can be embedded
 * inside host application forms without nesting violations.
 *
 * All visual properties flow through `--stgm-*` tokens.
 *
 * @example
 * ```tsx
 * // Launcher with all context types
 * <SessionComposer
 *   onSubmit={handleCreate}
 *   org={org}
 *   agentRef={agentRef}
 *   onAgentRefChange={setAgentRef}
 *   onAgentResolutionChange={setResolution}
 *   workspace={workspace}
 *   enableGitHub
 *   mcpServerUsages={mcpUsages}
 *   onMcpServerUsagesChange={setMcpUsages}
 *   skillRefs={skillRefs}
 *   onSkillRefsChange={setSkillRefs}
 *   initialRows={3}
 *   placeholder="Describe what you need help with..."
 *   autoFocus
 * />
 *
 * // Pre-filled launcher (auto-selects agent on mount)
 * <SessionComposer
 *   onSubmit={handleCreate}
 *   org={org}
 *   agentRef={agentRef}
 *   onAgentRefChange={setAgentRef}
 *   onAgentResolutionChange={setResolution}
 *   initialAgentRef={{ org: "stigmer", slug: "agent-creator" }}
 *   placeholder="Describe the agent you want to create..."
 *   initialRows={3}
 *   autoFocus
 * />
 *
 * // Follow-up (compact, workspace only)
 * <SessionComposer
 *   onSubmit={(msg, model) => conv.sendFollowUp(msg, { modelName: model })}
 *   disabled={!conv.canSendFollowUp}
 *   isSubmitting={conv.isSending}
 *   workspace={workspace}
 * />
 * ```
 */
export function SessionComposer({
  onSubmit,
  isSubmitting = false,
  disabled = false,
  defaultModelId,
  onModelChange,
  showModelSelector = true,
  workspace,
  gitHubConnection,
  enableGitHub = true,
  enableLocal = false,
  onBrowseLocalFolder,
  org,
  agentRef,
  onAgentRefChange,
  onAgentResolutionChange,
  initialAgentRef,
  mcpServerUsages,
  onMcpServerUsagesChange,
  skillRefs,
  onSkillRefsChange,
  runnerId,
  onRunnerIdChange,
  sessionVariables,
  enableAttachments = true,
  onAttachmentValidationError,
  initialAttachments,
  placeholder = "Reply\u2026",
  initialRows = 1,
  autoFocus = false,
  ariaLabel = "Send message",
  className,
}: SessionComposerProps) {
  const [modelId, setModelId] = useState<string | undefined>(defaultModelId);

  const [displayNames, setDisplayNames] = useState<Map<string, string>>(
    () => new Map(),
  );

  const isDisabled = disabled || isSubmitting;

  const showAgent = onAgentRefChange != null && org != null;
  const showMcp = onMcpServerUsagesChange != null && org != null;
  const showWorkspace = workspace != null;
  const showSkills = onSkillRefsChange != null && org != null;
  const showRunner = onRunnerIdChange != null && org != null;
  const showSessionVars = sessionVariables != null;
  const showAttach = enableAttachments;

  // ---------------------------------------------------------------------------
  // Configure menu state — drives the Tier 2 drill-down popover
  // ---------------------------------------------------------------------------

  const [configOpen, setConfigOpen] = useState(false);
  const [configActivePanel, setConfigActivePanel] = useState<string | null>(null);
  const configMcpInitialServerKeyRef = useRef<string | undefined>(undefined);

  // ---------------------------------------------------------------------------
  // Session env pool — cross-references secrets across all sources
  // ---------------------------------------------------------------------------

  const personalEnv = usePersonalEnvironment(
    (showAgent || showMcp) ? (org ?? null) : null,
  );

  const personalEnvKeys = useMemo(
    () => new Set(Object.keys(personalEnv.environment?.spec?.data ?? {})),
    [personalEnv.environment],
  );

  const stigmer = useStigmer();

  const pool = useSessionEnvPool({
    personalEnvKeys,
    manualSecrets: sessionVariables?.entries,
  });

  const poolKeysWithSystem = useMemo(
    () => new Set([...pool.availableKeys, ...SYSTEM_ENV_VAR_KEYS]),
    [pool.availableKeys],
  );

  // ---------------------------------------------------------------------------
  // Setup hooks — instantiated before handleSubmit so it can read their state
  // ---------------------------------------------------------------------------

  const agentSetup = useAgentSetup(
    showAgent ? (org ?? null) : null,
    poolKeysWithSystem,
  );

  const mcpSetup = useMcpServerSetup(
    showMcp ? (org ?? null) : null,
    poolKeysWithSystem,
  );

  // ---------------------------------------------------------------------------
  // Pool-resolve notification — when POOL_RESOLVE transitions agentSetup to
  // "ready" reactively (via the useEffect inside useAgentSetup), the
  // imperative callbacks (handleAgentSelect, handleEnvSubmit) are not
  // involved, so onAgentResolutionChange would never fire. This effect
  // bridges that gap so the parent always knows the current resolution.
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (agentSetup.state.status !== "ready") return;
    onAgentResolutionChange?.(agentSetup.state.resolution);
  }, [agentSetup.state, onAgentResolutionChange]);

  // ---------------------------------------------------------------------------
  // Attachments — file upload state machine
  // ---------------------------------------------------------------------------

  const attachments = useAttachments(
    enableAttachments
      ? { onValidationError: onAttachmentValidationError }
      : undefined,
  );
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        attachments.addFiles(e.target.files);
      }
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    [attachments],
  );

  const handleDragOver = useCallback(
    (e: DragEvent) => {
      if (!enableAttachments || isDisabled) return;
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(true);
    },
    [enableAttachments, isDisabled],
  );

  const handleDragLeave = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);
    },
    [],
  );

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);
      if (!enableAttachments || isDisabled) return;
      if (e.dataTransfer.files.length > 0) {
        attachments.addFiles(e.dataTransfer.files);
      }
    },
    [enableAttachments, isDisabled, attachments],
  );

  // ---------------------------------------------------------------------------
  // Submit — aggregates one-time runtimeEnv from all setup flows
  // ---------------------------------------------------------------------------

  const handleSubmit = useCallback(
    async (message: string) => {
      // Persist save-for-future manual secrets before building runtimeEnv
      if (sessionVariables?.hasSaveForFutureEntries) {
        const saveVars = sessionVariables.toSaveForFutureEnv();
        if (Object.keys(saveVars).length > 0) {
          try {
            await personalEnv.getOrCreate();
            await personalEnv.addVariables(saveVars);
          } catch {
            // Best-effort: if persistence fails, the values still flow
            // into runtimeEnv for this execution via the one-time path.
          }
        }
      }

      const env: Record<string, EnvVarInput> = {};

      // System env vars first (lowest priority) — auto-resolved from
      // the Stigmer client's connection context so MCP servers and
      // agents can reach the backend without manual user input.
      const systemVars = await resolveSystemEnvVarValues(stigmer);
      Object.assign(env, systemVars);

      if (
        agentSetup.state.status === "ready" &&
        agentSetup.state.resolution.mode === "oneTime"
      ) {
        Object.assign(env, agentSetup.state.resolution.runtimeEnv);
      }

      const mcpEnv = mcpSetup.pendingRuntimeEnv;
      if (Object.keys(mcpEnv).length > 0) {
        Object.assign(env, mcpEnv);
      }

      if (sessionVariables && sessionVariables.hasValidEntries) {
        Object.assign(env, sessionVariables.toRuntimeEnv());
      }

      const attachmentInputs = enableAttachments
        ? attachments.toAttachmentInputs()
        : undefined;

      const hasEnv = Object.keys(env).length > 0;
      const hasAttachments =
        attachmentInputs !== undefined && attachmentInputs.length > 0;

      const context: SessionComposerSubmitContext | undefined =
        hasEnv || hasAttachments
          ? {
              runtimeEnv: hasEnv ? env : undefined,
              attachments: hasAttachments ? attachmentInputs : undefined,
            }
          : undefined;

      onSubmit(message, modelId, context);

      if (enableAttachments) {
        attachments.clear();
      }
    },
    [onSubmit, modelId, stigmer, agentSetup.state, mcpSetup.pendingRuntimeEnv, sessionVariables, enableAttachments, attachments, personalEnv],
  );

  const composer = useComposer({
    onSubmit: handleSubmit,
    disabled: isDisabled,
  });

  const handleModelChange = useCallback(
    (id: string) => {
      setModelId(id);
      onModelChange?.(id);
    },
    [onModelChange],
  );

  const handleDisplayNameResolved = useCallback(
    (key: string, name: string) => {
      setDisplayNames((prev) => {
        const next = new Map(prev);
        next.set(key, name);
        return next;
      });
    },
    [],
  );

  // ---------------------------------------------------------------------------
  // Agent setup: state-machine-driven popover + environment resolution
  // ---------------------------------------------------------------------------

  const showEnvForm = agentSetup.state.status === "needsEnvVars";
  const isAgentBusy =
    agentSetup.state.status === "resolving" ||
    agentSetup.state.status === "submitting";

  const handleConfigOpenChange = useCallback(
    (open: boolean) => {
      setConfigOpen(open);
      if (!open) {
        configMcpInitialServerKeyRef.current = undefined;
        if (
          configActivePanel === "agent" &&
          agentSetup.state.status !== "needsEnvVars" &&
          agentSetup.state.status !== "submitting"
        ) {
          agentSetup.reset();
        }
      }
    },
    [configActivePanel, agentSetup],
  );

  const handleConfigActivePanelChange = useCallback(
    (panel: string | null) => {
      if (
        configActivePanel === "agent" &&
        panel !== "agent" &&
        agentSetup.state.status !== "needsEnvVars" &&
        agentSetup.state.status !== "submitting"
      ) {
        agentSetup.reset();
      }
      setConfigActivePanel(panel);
    },
    [configActivePanel, agentSetup],
  );

  const handleAgentSelect = useCallback(
    async (ref: ResourceRef | null) => {
      if (!ref) {
        onAgentRefChange?.(null);
        onAgentResolutionChange?.(null);
        return;
      }

      try {
        const result = await agentSetup.resolveAgent(ref);

        if (result.status === "ready") {
          onAgentRefChange?.(result.agentRef);
          onAgentResolutionChange?.(result.resolution);
          handleDisplayNameResolved(
            `${result.agentRef.org}/${result.agentRef.slug}`,
            result.agentName,
          );
          setConfigOpen(false);
        }
        // "needsEnvVars" — state machine transitions automatically,
        // panel content switches to env form via `showEnvForm`.
      } catch {
        // Error is captured by agentSetup.state.error — displayed inline.
      }
    },
    [
      agentSetup,
      onAgentRefChange,
      onAgentResolutionChange,
      handleDisplayNameResolved,
    ],
  );

  const handleEnvFormSubmit = useCallback(
    async (
      values: Record<string, EnvVarInput>,
      { saveForFuture }: AgentEnvFormSubmitOptions,
    ) => {
      try {
        const result = await agentSetup.submitEnvVars(values, { saveForFuture });
        onAgentRefChange?.(result.agentRef);
        onAgentResolutionChange?.(result.resolution);
        handleDisplayNameResolved(
          `${result.agentRef.org}/${result.agentRef.slug}`,
          result.agentName,
        );
        setConfigOpen(false);
      } catch {
        // Error is captured by agentSetup.state.error — displayed inline.
      }
    },
    [
      agentSetup,
      onAgentRefChange,
      onAgentResolutionChange,
      handleDisplayNameResolved,
    ],
  );

  const handleAgentChipRemove = useCallback(() => {
    onAgentRefChange?.(null);
    onAgentResolutionChange?.(null);
  }, [onAgentRefChange, onAgentResolutionChange]);

  const handlePendingAgentChipRemove = useCallback(() => {
    agentSetup.reset();
    onAgentRefChange?.(null);
    onAgentResolutionChange?.(null);
  }, [agentSetup, onAgentRefChange, onAgentResolutionChange]);

  // ---------------------------------------------------------------------------
  // Initial agent: auto-resolve on mount when initialAgentRef is provided
  // ---------------------------------------------------------------------------

  const handleAgentSelectRef = useRef(handleAgentSelect);
  handleAgentSelectRef.current = handleAgentSelect;

  const initialAgentHandled = useRef(false);

  useEffect(() => {
    if (!initialAgentRef || !showAgent || !org || initialAgentHandled.current) {
      return;
    }

    let cancelled = false;
    initialAgentHandled.current = true;

    handleAgentSelectRef.current(initialAgentRef).catch(() => {
      if (!cancelled) {
        initialAgentHandled.current = false;
      }
    });

    return () => {
      cancelled = true;
    };
  }, [initialAgentRef, showAgent, org]);

  // ---------------------------------------------------------------------------
  // Initial agent: auto-open Configure > Agent when env vars are needed
  // ---------------------------------------------------------------------------

  const initialAgentConfigAutoOpened = useRef(false);

  useEffect(() => {
    if (initialAgentConfigAutoOpened.current) return;
    if (!initialAgentRef) return;
    if (agentSetup.state.status !== "needsEnvVars") return;

    initialAgentConfigAutoOpened.current = true;
    setConfigOpen(true);
    setConfigActivePanel("agent");
  }, [initialAgentRef, agentSetup.state.status]);

  // ---------------------------------------------------------------------------
  // Initial attachments: upload files on mount when provided
  // ---------------------------------------------------------------------------

  const initialAttachmentsHandled = useRef(false);

  useEffect(() => {
    if (
      initialAttachments &&
      initialAttachments.length > 0 &&
      enableAttachments &&
      !initialAttachmentsHandled.current
    ) {
      initialAttachmentsHandled.current = true;
      attachments.addFiles(initialAttachments);
    }
  }, [initialAttachments, enableAttachments, attachments]);

  // ---------------------------------------------------------------------------
  // MCP server setup: sync usageInputs to consumer
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!showMcp) return;
    onMcpServerUsagesChange?.(mcpSetup.usageInputs);
  }, [showMcp, mcpSetup.usageInputs, onMcpServerUsagesChange]);

  // ---------------------------------------------------------------------------
  // Submission blocking: MCP servers must be fully configured before send
  // ---------------------------------------------------------------------------

  const mcpBlocked = showMcp && !mcpSetup.allReady;
  const canSend = composer.canSubmit && !mcpBlocked;

  const handleTextareaKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (!canSend && e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        return;
      }
      composer.textareaProps.onKeyDown(e);
    },
    [canSend, composer.textareaProps],
  );

  // ---------------------------------------------------------------------------
  // Chips — aggregated from all context sources
  // ---------------------------------------------------------------------------

  const chips = useMemo(() => {
    const items: ChipItem[] = [];

    if (agentRef) {
      const refStr = `${agentRef.org}/${agentRef.slug}`;
      items.push({
        key: `agent:${refStr}`,
        label: displayNames.get(refStr) ?? agentRef.slug,
        type: "agent",
        onRemove: handleAgentChipRemove,
      });
    } else if (
      agentSetup.state.status === "needsEnvVars" ||
      agentSetup.state.status === "resolving" ||
      agentSetup.state.status === "submitting"
    ) {
      const st = agentSetup.state;
      const ref = st.agentRef;
      const refStr = `${ref.org}/${ref.slug}`;
      const name =
        st.status !== "resolving"
          ? st.agentName
          : (displayNames.get(refStr) ?? ref.slug);

      items.push({
        key: `agent:${refStr}`,
        label: name,
        type: "agent",
        onRemove: handlePendingAgentChipRemove,
        status:
          st.status === "resolving"
            ? "loading"
            : st.status === "submitting"
              ? "submitting"
              : "needsSetup",
        onClick:
          st.status === "needsEnvVars"
            ? () => {
                setConfigOpen(true);
                setConfigActivePanel("agent");
              }
            : undefined,
      });
    }

    if (workspace) {
      for (const entry of workspace.entries) {
        items.push({
          key: `ws:${entry.id}`,
          label: entry.name,
          type: "workspace",
          onRemove: () => workspace.remove(entry.id),
        });
      }
    }

    if (showMcp) {
      for (const [key, entry] of Object.entries(mcpSetup.entries)) {
        const slug = key.slice(key.indexOf("/") + 1);
        const name =
          entry.status !== "loading"
            ? (entry.mcpServer.metadata?.name ?? displayNames.get(key) ?? slug)
            : (displayNames.get(key) ?? slug);

        let detail: string | undefined;
        if (
          entry.status === "ready" &&
          entry.discoveredTools.length > 0 &&
          entry.enabledTools.length < entry.discoveredTools.length
        ) {
          detail = `${entry.enabledTools.length}/${entry.discoveredTools.length}`;
        }

        items.push({
          key: `mcp:${key}`,
          label: name,
          type: "mcp",
          onRemove: () => mcpSetup.removeServer(mcpRefFromKey(key)),
          status: entry.status,
          detail,
          onClick:
            entry.status === "needsSetup"
              ? () => {
                  configMcpInitialServerKeyRef.current = key;
                  setConfigOpen(true);
                  setConfigActivePanel("mcp");
                }
              : undefined,
        });
      }
    }

    if (skillRefs) {
      for (const ref of skillRefs) {
        const refStr = `${ref.org}/${ref.slug}`;
        items.push({
          key: `skill:${refStr}`,
          label: displayNames.get(refStr) ?? ref.slug,
          type: "skill",
          onRemove: () => {
            onSkillRefsChange?.(
              skillRefs.filter((r) => `${r.org}/${r.slug}` !== refStr),
            );
          },
        });
      }
    }

    if (sessionVariables) {
      for (const entry of sessionVariables.entries) {
        const k = entry.key.trim();
        if (k === "") continue;
        items.push({
          key: `secret:${entry.id}`,
          label: k,
          type: "secret",
          onRemove: () => sessionVariables.removeEntry(entry.id),
        });
      }
    }

    return items;
  }, [
    agentRef,
    agentSetup.state,
    handleAgentChipRemove,
    handlePendingAgentChipRemove,
    workspace,
    showMcp,
    mcpSetup.entries,
    mcpSetup.removeServer,
    skillRefs,
    sessionVariables,
    displayNames,
    onSkillRefsChange,
  ]);

  const workspaceCount = workspace?.entries.length ?? 0;
  const mcpCount = showMcp ? Object.keys(mcpSetup.entries).length : 0;
  const skillCount = skillRefs?.length ?? 0;
  const sessionVarCount = sessionVariables?.entries.length ?? 0;

  // ---------------------------------------------------------------------------
  // Required-by map — tracks which keys are needed by which resources
  // ---------------------------------------------------------------------------

  const requiredByMap = useMemo((): Record<string, string[]> => {
    const map: Record<string, string[]> = {};

    if (agentSetup.state.status === "needsEnvVars") {
      const agentName = agentSetup.state.agentName;
      for (const v of agentSetup.state.missingVariables) {
        (map[v.key] ??= []).push(agentName);
      }
    }

    if (showMcp) {
      for (const entry of Object.values(mcpSetup.entries)) {
        if (entry.status !== "needsSetup") continue;
        const serverName = entry.mcpServer.metadata?.name ?? "MCP Server";
        for (const v of entry.missingVariables) {
          (map[v.key] ??= []).push(serverName);
        }
      }
    }

    return map;
  }, [agentSetup.state, showMcp, mcpSetup.entries]);

  // ---------------------------------------------------------------------------
  // Configure menu — Tier 2 items and panel renderer
  // ---------------------------------------------------------------------------

  const configureItems = useMemo((): ConfigureMenuItem[] => {
    const items: ConfigureMenuItem[] = [];
    if (showAgent) {
      const agentPending =
        !agentRef &&
        (agentSetup.state.status === "needsEnvVars" ||
          agentSetup.state.status === "resolving" ||
          agentSetup.state.status === "submitting");
      items.push({
        id: "agent",
        icon: <AgentIcon />,
        label: "Agent",
        count: agentRef || agentPending ? 1 : 0,
        hasWarning: agentPending && agentSetup.state.status === "needsEnvVars",
      });
    }
    if (showMcp) {
      items.push({
        id: "mcp",
        icon: <McpServerIcon />,
        label: "MCP Servers",
        count: mcpCount,
        hasWarning: mcpSetup.needsSetupCount > 0,
      });
    }
    if (showSkills) {
      items.push({
        id: "skills",
        icon: <SkillIcon />,
        label: "Skills",
        count: skillCount,
      });
    }
    if (showSessionVars) {
      items.push({
        id: "sessionVars",
        icon: <SecretsIcon />,
        label: "Session Variables",
        count: sessionVarCount,
      });
    }
    return items;
  }, [showAgent, agentRef, agentSetup.state, showMcp, mcpCount, mcpSetup.needsSetupCount, showSkills, skillCount, showSessionVars, sessionVarCount]);

  const renderConfigPanel = useCallback(
    (panelId: string): React.ReactNode => {
      switch (panelId) {
        case "agent":
          return showEnvForm ? (
            <div>
              <AgentEnvForm
                agentName={
                  agentSetup.state.status === "needsEnvVars"
                    ? agentSetup.state.agentName
                    : "Agent"
                }
                variables={
                  agentSetup.state.status === "needsEnvVars"
                    ? agentSetup.state.missingVariables
                    : []
                }
                onSubmit={handleEnvFormSubmit}
                onCancel={() => agentSetup.reset()}
                isSubmitting={isAgentBusy}
                disabled={isDisabled}
                poolValues={pool.getAvailableValue}
              />
              {agentSetup.state.error && (
                <AgentSetupError error={agentSetup.state.error} />
              )}
            </div>
          ) : (
            <div className="relative">
              <AgentPicker
                org={org!}
                scope="all"
                value={agentRef ?? null}
                onChange={handleAgentSelect}
                onDisplayNameResolved={handleDisplayNameResolved}
                disabled={isDisabled || isAgentBusy}
              />
              {isAgentBusy && (
                <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-popover/80">
                  <ResolveSpinner />
                </div>
              )}
              {agentSetup.state.error && (
                <AgentSetupError error={agentSetup.state.error} />
              )}
            </div>
          );

        case "mcp":
          return (
            <McpServerPicker
              org={org!}
              scope="all"
              setup={{
                entries: mcpSetup.entries,
                onServerAdded: (ref) => mcpSetup.addServer(ref),
                onServerRemoved: (ref) => mcpSetup.removeServer(ref),
                onSubmitEnvVars: (ref, values, opts) =>
                  mcpSetup.submitEnvVars(ref, values, {
                    saveForFuture: opts.saveForFuture,
                  }),
                onEnabledToolsChange: (ref, tools) =>
                  mcpSetup.setEnabledTools(ref, tools),
              }}
              initialServerKey={configMcpInitialServerKeyRef.current}
              onDisplayNameResolved={handleDisplayNameResolved}
              disabled={isDisabled}
              poolValues={pool.getAvailableValue}
            />
          );

        case "skills":
          return (
            <SkillPicker
              org={org!}
              scope="all"
              value={skillRefs ?? []}
              onChange={onSkillRefsChange!}
              onDisplayNameResolved={handleDisplayNameResolved}
              disabled={isDisabled}
            />
          );

        case "sessionVars":
          return (
            <SessionVariablesInput
              sessionVariables={sessionVariables!}
              disabled={isDisabled}
              requiredByMap={requiredByMap}
            />
          );

        default:
          return null;
      }
    },
    [
      showEnvForm,
      agentSetup,
      isAgentBusy,
      isDisabled,
      org,
      agentRef,
      handleAgentSelect,
      handleEnvFormSubmit,
      handleDisplayNameResolved,
      mcpSetup,
      skillRefs,
      onSkillRefsChange,
      sessionVariables,
      pool,
      requiredByMap,
    ],
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div
      role="form"
      aria-label={ariaLabel}
      className={cn("shrink-0", className)}
    >
      <div
        className={cn(
          "rounded-xl border border-border bg-card shadow-sm",
          "focus-within:ring-2 focus-within:ring-ring",
          isDisabled && "opacity-50",
          isDragOver && "ring-2 ring-primary/50",
        )}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* Zone 1: Textarea */}
        <div className="relative">
          <textarea
            {...composer.textareaProps}
            onKeyDown={handleTextareaKeyDown}
            placeholder={placeholder}
            rows={initialRows}
            autoFocus={autoFocus}
            className="block w-full resize-none bg-transparent px-4 pt-3 pb-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none disabled:cursor-not-allowed"
          />
          {isDragOver && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-t-xl bg-primary-subtle">
              <span className="text-xs font-medium text-primary">
                Drop files to attach
              </span>
            </div>
          )}
        </div>

        {/* Hidden file input for the attach button */}
        {showAttach && (
          <input
            ref={fileInputRef}
            type="file"
            multiple
            onChange={handleFileInputChange}
            className="hidden"
            aria-hidden="true"
            tabIndex={-1}
          />
        )}

        {/* Zone 2: Context chips */}
        {chips.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-3 pb-2">
            {chips.map((chip) => (
              <ContextChip
                key={chip.key}
                label={chip.label}
                type={chip.type}
                onRemove={chip.onRemove}
                disabled={isDisabled}
                status={chip.status}
                detail={chip.detail}
                onClick={chip.onClick}
              />
            ))}
          </div>
        )}

        {/* Zone 2.5: Attachment chips */}
        {showAttach && attachments.hasEntries && (
          <AttachmentChipList
            entries={attachments.entries}
            onRemove={attachments.removeEntry}
            onRetry={attachments.retryEntry}
            disabled={isDisabled}
            className="px-3 pb-2"
          />
        )}

        {/* Zone 2.7: Agent setup warning */}
        {showAgent &&
          agentSetup.state.status === "needsEnvVars" &&
          !agentRef && (
            <div
              role="status"
              className="mx-3 mb-2 flex items-center gap-2 rounded-md bg-warning/10 px-2.5 py-1.5 text-xs text-warning"
            >
              <AlertTriangleIcon />
              <span>Agent needs configuration before use</span>
              <button
                type="button"
                onClick={() => {
                  setConfigOpen(true);
                  setConfigActivePanel("agent");
                }}
                disabled={isDisabled}
                className="ml-auto shrink-0 rounded px-1.5 py-0.5 text-[0.6rem] font-medium hover:bg-warning/20 disabled:pointer-events-none disabled:opacity-50"
              >
                Configure
              </button>
            </div>
          )}

        {/* Zone 2.75: MCP setup warning */}
        {showMcp && mcpSetup.needsSetupCount > 0 && (
          <div
            role="status"
            className="mx-3 mb-2 flex items-center gap-2 rounded-md bg-warning/10 px-2.5 py-1.5 text-xs text-warning"
          >
            <AlertTriangleIcon />
            <span>
              {mcpSetup.needsSetupCount === 1
                ? "1 MCP server needs configuration"
                : `${mcpSetup.needsSetupCount} MCP servers need configuration`}
            </span>
            <button
              type="button"
              onClick={() => {
                if (mcpSetup.needsSetupCount === 1) {
                  const key = Object.entries(mcpSetup.entries).find(
                    ([, e]) => e.status === "needsSetup",
                  )?.[0];
                  configMcpInitialServerKeyRef.current = key;
                } else {
                  configMcpInitialServerKeyRef.current = undefined;
                }
                setConfigOpen(true);
                setConfigActivePanel("mcp");
              }}
              disabled={isDisabled}
              className="ml-auto shrink-0 rounded px-1.5 py-0.5 text-[0.6rem] font-medium hover:bg-warning/20 disabled:pointer-events-none disabled:opacity-50"
            >
              Configure
            </button>
          </div>
        )}

        {/* Zone 3: Toolbar */}
        <ComposerToolbar
          disabled={isDisabled}
          isSubmitting={isSubmitting}
          canSend={canSend}
          onSend={composer.submit}
          showAttach={showAttach}
          attachmentCount={attachments.entries.length}
          onAttachClick={() => fileInputRef.current?.click()}
          showWorkspace={showWorkspace}
          workspaceCount={workspaceCount}
          workspaceContent={
            workspace
              ? <WorkspaceEditor
                  workspace={workspace}
                  disabled={isDisabled}
                  gitHubConnection={gitHubConnection}
                  enableGitHub={enableGitHub}
                  enableLocal={enableLocal}
                  onBrowseLocalFolder={onBrowseLocalFolder}
                />
              : null
          }
          configureItems={configureItems}
          configOpen={configOpen}
          onConfigOpenChange={handleConfigOpenChange}
          configActivePanel={configActivePanel}
          onConfigActivePanelChange={handleConfigActivePanelChange}
          renderConfigPanel={renderConfigPanel}
          showRunner={showRunner}
          runnerOrg={org ?? ""}
          runnerId={runnerId ?? null}
          onRunnerIdChange={onRunnerIdChange ?? (() => {})}
          showModelSelector={showModelSelector}
          modelId={modelId}
          onModelChange={handleModelChange}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Agent setup error — secret-flow guidance or generic fallback
// ---------------------------------------------------------------------------

function AgentSetupError({ error }: { error: Error }) {
  if (isSecretFlowError(error)) {
    return <SecretFlowErrorGuide error={error} className="mt-2" />;
  }
  return (
    <p className="mt-2 text-xs text-destructive">
      {getUserMessage(error)}
    </p>
  );
}

// ---------------------------------------------------------------------------
// MCP key-to-ref utility
// ---------------------------------------------------------------------------

function mcpRefFromKey(key: string): ResourceRef {
  const idx = key.indexOf("/");
  return {
    org: key.slice(0, idx),
    slug: key.slice(idx + 1),
    kind: ApiResourceKind.mcp_server,
  };
}
