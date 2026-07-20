"use client";

import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { cn } from "@stigmer/theme";
import { getUserMessage, type AttachmentInput, type EnvVarInput, type McpServerUsageInput, type ResourceRef } from "@stigmer/sdk";
import { useComposer } from "./useComposer.js";
import { ComposerToolbar } from "./ComposerToolbar.js";
import { type ConfigureMenuItem } from "./ConfigureMenu.js";
import type { HarnessOption } from "../models/harness.js";
import type { InteractionModeOption } from "./InteractionModePicker.js";
import { parseModelKey } from "../models/registry.js";
import { WorkspaceEditor } from "../workspace/WorkspaceEditor.js";
import { AgentPicker } from "../agent/AgentPicker.js";
import { AgentEnvForm, type AgentEnvFormSubmitOptions } from "../agent/AgentEnvForm.js";
import { useAgentSetup, type AgentResolution } from "../agent/useAgentSetup.js";
import { SecretFlowErrorGuide, isSecretFlowError } from "../error/SecretFlowErrorGuide.js";
import { McpServerPicker } from "../mcp-server/McpServerPicker.js";
import { useMcpServerSetup } from "../mcp-server/useMcpServerSetup.js";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { SkillPicker } from "../skill/SkillPicker.js";
import { SessionVariablesInput } from "../execution/SessionVariablesInput.js";
import type { UseSessionVariablesReturn } from "../execution/useSessionVariables.js";
import type { UseWorkspaceEntriesReturn } from "../workspace/useWorkspaceEntries.js";
import type { UseGitHubConnectionReturn } from "../github/useGitHubConnection.js";
import { useAttachments } from "../attachment/useAttachments.js";
import { AttachmentChipList } from "../attachment/AttachmentChipList.js";
import { useFileReferences } from "../file-reference/useFileReferences.js";
import { FileReferenceChipList } from "../file-reference/FileReferenceChipList.js";
import { FILE_REF_MIME } from "../internal/file-tree/index.js";
import { useSessionEnvPool } from "../environment/useSessionEnvPool.js";
import { usePersonalEnvironment } from "../environment/usePersonalEnvironment.js";
import { useStigmer } from "../hooks.js";
import {
  SYSTEM_ENV_VAR_KEYS,
  resolveSystemEnvVarValues,
} from "../environment/systemEnvVars.js";
import { useRenderTracer } from "../internal/dev/index.js";
import {
  AgentIcon,
  McpServerIcon,
  SkillIcon,
  SecretsIcon,
  AlertTriangleIcon,
  ResolveSpinner,
  XIcon,
} from "./icons.js";

/**
 * Imperative handle exposed by {@link SessionComposer} via `ref`.
 *
 * Allows parent components to programmatically set the composer's
 * message text, focus the textarea, or submit a message directly.
 * Used for features like "Implement plan" where a CTA outside the
 * composer needs to run the agent in one click.
 *
 * @example
 * ```tsx
 * const composerRef = useRef<SessionComposerHandle>(null);
 *
 * function handleBuildFromPlan() {
 *   // Switch to Agent mode and run immediately — no manual Send.
 *   composerRef.current?.submit("Build from plan", {
 *     interactionMode: "agent",
 *     buildFromPlan: true,
 *   });
 * }
 *
 * <SessionComposer ref={composerRef} onSubmit={handleSubmit} />
 * ```
 */
export interface SessionComposerHandle {
  /** Replace the composer's message text. */
  setMessage(message: string): void;
  /** Focus the composer's textarea. */
  focus(): void;
  /**
   * Submit a message programmatically through the composer's full submit
   * pipeline (system/agent/MCP env resolution, attachments, session vars).
   *
   * Unlike calling the consumer's `onSubmit` directly, this guarantees the
   * same runtime context the user would get from pressing Send. No-ops when
   * the message is empty or the composer is disabled.
   *
   * @param message - The message to submit.
   * @param options.interactionMode - Force the interaction mode for this one
   *   submission, overriding the picker. Avoids the same-tick race when the
   *   caller also calls `onInteractionModeChange` just before submitting.
   * @param options.attachments - Pre-uploaded attachments (storage keys from
   *   `agentExecution.uploadAttachment`) to include with this one submission,
   *   in addition to any files attached in the composer. Used by "Build from
   *   plan" to deliver the approved `plan.md` to the implement execution.
   * @param options.buildFromPlan - Marks this submission as the implement
   *   turn of a Plan → Build handoff (`execution_config.build_from_plan`).
   *   The runner injects the implement-plan directive and the thread hides
   *   the turn's message; the message stays a short label for surfaces
   *   without that treatment (the CLI, history).
   */
  submit(
    message: string,
    options?: {
      interactionMode?: InteractionModeOption;
      attachments?: AttachmentInput[];
      buildFromPlan?: boolean;
    },
  ): void;
}

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
  /**
   * Interaction mode selected by the user for this execution.
   *
   * - `"agent"` (default): full tool access — read, write, create, delete.
   * - `"plan"`: read-only analysis — read, search, list only.
   *
   * `undefined` when no mode picker is shown (defaults to `"agent"`).
   * Pass to execution creation as `execution_config.interaction_mode`.
   */
  readonly interactionMode?: InteractionModeOption;
  /**
   * Workspace-relative file paths the user referenced via drag-to-reference.
   *
   * These are lightweight "attention" signals — the agent reads the files
   * directly from the workspace filesystem. No upload, no injection.
   *
   * `undefined` when no file references are present.
   * Pass to execution creation as `workspaceFileRefs`.
   */
  readonly workspaceFileRefs?: string[];
  /**
   * The submission is a Build-from-plan turn.
   *
   * Only ever set through {@link SessionComposerHandle.submit} (the thread
   * card / plan editor CTA) — there is no composer UI for it. Pass to
   * execution creation as `execution_config.build_from_plan`; the runner
   * injects the implement-plan directive and the thread hides the turn's
   * machine-written message (the plan card above it is the visible cause).
   *
   * `undefined` for ordinary submissions.
   */
  readonly buildFromPlan?: boolean;
  /**
   * ID of the execution this submission supersedes (edit-and-resubmit).
   *
   * Never set by the composer itself — the session viewer merges it into
   * the context when the user submits while the composer is in editing
   * mode (see `SessionComposerProps.isEditing`). Pass to execution
   * creation as `supersedesExecutionId`; chat threads hide the superseded
   * execution so the edited message replaces the original in place.
   *
   * `undefined` for ordinary submissions.
   */
  readonly supersedesExecutionId?: string;
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

  /**
   * When provided, the Send button becomes a Stop control while an execution
   * is in flight — clicking it calls this handler (graceful cancel, escalating
   * to terminate on a repeat press). The textarea stays disabled, but the card
   * is not dimmed so Stop reads as live and clickable.
   *
   * Opt-in: when omitted, the composer behaves exactly as before. Typically
   * wired to `useSessionConversation`'s `stop`, gated on `isStoppable`.
   */
  readonly onStop?: () => void;
  /** `true` while a stop request is in flight — shows a spinner on the Stop button. */
  readonly isStopping?: boolean;

  /**
   * Marks the composer as editing a previously sent message
   * (edit-and-resubmit). Renders an "Editing message" banner above the
   * textarea with a cancel (X) affordance; Escape in the textarea also
   * cancels. The banner is purely presentational — the viewer owns the
   * editing state and attaches the supersede link on submit.
   *
   * Opt-in: when omitted, the composer behaves exactly as before.
   */
  readonly isEditing?: boolean;
  /**
   * Called when the user cancels editing (banner X or Escape).
   *
   * The consumer clears its editing state and typically clears the
   * prefilled text via {@link SessionComposerHandle.setMessage}.
   * Required for the editing banner to render its cancel affordance;
   * ignored when `isEditing` is false.
   */
  readonly onCancelEdit?: () => void;

  /**
   * Currently selected execution harness.
   *
   * Controls which models appear in the model selector and flows
   * through to session creation. When omitted, defaults to `"native"`.
   */
  readonly harness?: HarnessOption;
  /**
   * Called when the user switches the harness.
   *
   * Providing this callback enables the harness selector in the toolbar.
   */
  readonly onHarnessChange?: (harness: HarnessOption) => void;
  /** Show the harness selector in the toolbar. @default false */
  readonly showHarnessSelector?: boolean;

  /**
   * Currently selected interaction mode.
   *
   * When `onInteractionModeChange` is provided, renders a mode picker
   * in the toolbar. Defaults to `"agent"` when omitted.
   */
  readonly interactionMode?: InteractionModeOption;
  /**
   * Called when the user switches the interaction mode.
   *
   * Providing this callback enables the mode picker in the toolbar.
   */
  readonly onInteractionModeChange?: (mode: InteractionModeOption) => void;
  /** Show the interaction mode picker in the toolbar. @default false */
  readonly showInteractionModePicker?: boolean;

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
   * Pre-bind the session to a specific, already-existing
   * `AgentInstance` when the composer mounts.
   *
   * Requires `initialAgentRef` (the agent the instance deploys). When
   * both are provided, the composer resolves the agent directly to this
   * instance — skipping the environment-collection flow entirely, since
   * the chosen instance already binds its own environment(s). The
   * resulting resolution is `{ mode: "saved", instanceId }`, so the
   * session is created against this exact configured deployment.
   *
   * This is the agent analog of running a specific WorkflowInstance: it
   * powers the "Start session" action on an instance in the Agent detail
   * page's Instances tab.
   *
   * One-time: consumed on mount; subsequent changes are ignored.
   */
  readonly initialInstanceId?: string;

  /**
   * When `true`, the agent chip renders without an X (remove) button.
   *
   * Used on the session page to indicate the session's default agent,
   * where removing it would just re-select the same agent (a
   * confusing no-op). The user can still switch agents via the
   * Configure menu.
   *
   * @default false
   */
  readonly isDefaultAgent?: boolean;

  /**
   * Lock the current agent: the Agent entry is removed from the
   * Configure menu so the user cannot swap or deselect it.
   *
   * Locking does not unwire the agent machinery — `initialAgentRef`
   * resolution still runs on mount, and when the agent requires
   * credentials the environment form stays reachable in the Configure
   * menu until setup completes (lock ≠ unwire). Pair with
   * `initialAgentRef` to pin a pre-configured agent in end-user-facing
   * embeds (see `SessionViewer` / `NewSessionViewer` `audience`).
   *
   * @default false
   */
  readonly lockAgent?: boolean;

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
   * Enable workspace file-reference support via drag-to-reference.
   *
   * When `true`, dragging a file from the workspace tree into the
   * composer creates a file-reference chip (no upload). Referenced
   * paths are included in `context.workspaceFileRefs` on submit.
   *
   * @default true
   */
  readonly enableFileReferences?: boolean;

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
   * const yaml = serializeManifest(agent);
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
 * The toolbar uses a two-group layout:
 * - **Left (primary state):** Interaction Mode, Model Selector
 * - **Right (secondary actions, icon-only):** Workspace, Attach, Configure (Agent, MCP, Skills, Secrets), Send
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
const SessionComposerInner = forwardRef<SessionComposerHandle, SessionComposerProps>(function SessionComposer({
  onSubmit,
  isSubmitting = false,
  disabled = false,
  onStop,
  isStopping = false,
  isEditing = false,
  onCancelEdit,
  harness,
  onHarnessChange,
  showHarnessSelector = false,
  interactionMode,
  onInteractionModeChange,
  showInteractionModePicker = false,
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
  initialInstanceId,
  isDefaultAgent = false,
  lockAgent = false,
  mcpServerUsages,
  onMcpServerUsagesChange,
  skillRefs,
  onSkillRefsChange,
  sessionVariables,
  enableAttachments = true,
  enableFileReferences = true,
  onAttachmentValidationError,
  initialAttachments,
  placeholder = "Reply\u2026",
  initialRows = 1,
  autoFocus = false,
  ariaLabel = "Send message",
  className,
}, ref) {
  useRenderTracer("SessionComposer", { disabled, isSubmitting });

  const [modelId, setModelIdRaw] = useState<string | undefined>(defaultModelId);
  const userOverrodeModel = useRef(false);

  // Sync internal modelId when the external defaultModelId prop changes
  // (e.g., lastExecModelId resolves after executions load). Only sync if the
  // user hasn't made a local selection in this composer instance.
  useEffect(() => {
    if (!userOverrodeModel.current && defaultModelId !== undefined) {
      setModelIdRaw(defaultModelId);
    }
  }, [defaultModelId]);

  const setModelId = useCallback((id: string | undefined) => {
    userOverrodeModel.current = true;
    setModelIdRaw(id);
  }, []);

  const [displayNames, setDisplayNames] = useState<Map<string, string>>(
    () => new Map(),
  );

  const isDisabled = disabled || isSubmitting;

  // Stop-mode: an in-flight, stoppable execution. The textarea/config stay
  // disabled, but the card is kept un-dimmed so the Stop button reads as live.
  const stopMode = onStop != null;

  const showAgent = onAgentRefChange != null && org != null;
  const showMcp = onMcpServerUsagesChange != null && org != null;
  const showWorkspace = workspace != null;
  const showSkills = onSkillRefsChange != null && org != null;
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
  const fileRefs = useFileReferences();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isDragOverFileRef, setIsDragOverFileRef] = useState(false);

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
      const hasFileRef = e.dataTransfer.types.includes(FILE_REF_MIME);
      if (hasFileRef && enableFileReferences && !isDisabled) {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOverFileRef(true);
        setIsDragOver(true);
        return;
      }
      if (!enableAttachments || isDisabled) return;
      e.preventDefault();
      e.stopPropagation();
      setIsDragOverFileRef(false);
      setIsDragOver(true);
    },
    [enableAttachments, enableFileReferences, isDisabled],
  );

  const handleDragLeave = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);
      setIsDragOverFileRef(false);
    },
    [],
  );

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);
      setIsDragOverFileRef(false);

      if (isDisabled) return;

      const fileRefData = e.dataTransfer.getData(FILE_REF_MIME);
      if (fileRefData && enableFileReferences) {
        try {
          const { path } = JSON.parse(fileRefData) as { path: string };
          if (path) fileRefs.add(path);
        } catch {
          // Malformed payload — ignore silently
        }
        return;
      }

      if (!enableAttachments) return;
      if (e.dataTransfer.files.length > 0) {
        attachments.addFiles(e.dataTransfer.files);
      }
    },
    [enableAttachments, enableFileReferences, isDisabled, attachments, fileRefs],
  );

  // ---------------------------------------------------------------------------
  // Submit — aggregates one-time runtimeEnv from all setup flows
  // ---------------------------------------------------------------------------

  const handleSubmit = useCallback(
    async (
      message: string,
      overrides?: {
        interactionMode?: InteractionModeOption;
        attachments?: AttachmentInput[];
        buildFromPlan?: boolean;
      },
    ) => {
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

      // Composer-attached files plus caller-supplied extras (e.g. the approved
      // plan.md from a Build-from-plan turn) travel as one attachment list.
      const composerAttachments = enableAttachments
        ? attachments.toAttachmentInputs()
        : [];
      const attachmentInputs = [
        ...composerAttachments,
        ...(overrides?.attachments ?? []),
      ];

      const hasEnv = Object.keys(env).length > 0;
      const hasAttachments = attachmentInputs.length > 0;
      const effectiveMode =
        overrides?.interactionMode ??
        (showInteractionModePicker && interactionMode
          ? interactionMode
          : undefined);
      const hasFileRefs = enableFileReferences && fileRefs.hasRefs;
      const buildFromPlan = overrides?.buildFromPlan;

      const context: SessionComposerSubmitContext | undefined =
        hasEnv || hasAttachments || effectiveMode || hasFileRefs || buildFromPlan
          ? {
              runtimeEnv: hasEnv ? env : undefined,
              attachments: hasAttachments ? attachmentInputs : undefined,
              interactionMode: effectiveMode,
              workspaceFileRefs: hasFileRefs ? [...fileRefs.refs] : undefined,
              buildFromPlan,
            }
          : undefined;

      const resolvedModelId = modelId
        ? (parseModelKey(modelId)?.modelId ?? modelId)
        : undefined;
      onSubmit(message, resolvedModelId, context);

      if (enableAttachments) {
        attachments.clear();
      }
      if (enableFileReferences) {
        fileRefs.clear();
      }
    },
    [onSubmit, modelId, stigmer, agentSetup.state, mcpSetup.pendingRuntimeEnv, sessionVariables, enableAttachments, attachments, personalEnv, showInteractionModePicker, interactionMode],
  );

  const composer = useComposer({
    onSubmit: handleSubmit,
    disabled: isDisabled,
  });

  useImperativeHandle(ref, () => ({
    setMessage: composer.setMessage,
    focus: () => composer.textareaRef.current?.focus(),
    submit: (message, options) => {
      const trimmed = message.trim();
      if (!trimmed || isDisabled) return;
      void handleSubmit(trimmed, options);
    },
  }), [composer.setMessage, composer.textareaRef, handleSubmit, isDisabled]);

  const handleModelChange = useCallback(
    (id: string) => {
      setModelId(id);
      onModelChange?.(id);
    },
    [onModelChange],
  );

  const handleHarnessChange = useCallback(
    (h: HarnessOption) => {
      onHarnessChange?.(h);
    },
    [onHarnessChange],
  );

  const handleInteractionModeChange = useCallback(
    (mode: InteractionModeOption) => {
      onInteractionModeChange?.(mode);
    },
    [onInteractionModeChange],
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

  const handleAgentSelectToInstance = useCallback(
    async (ref: ResourceRef, instanceId: string) => {
      try {
        const result = await agentSetup.resolveToInstance(ref, instanceId);
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


  // ---------------------------------------------------------------------------
  // Initial agent: auto-resolve on mount when initialAgentRef is provided
  // ---------------------------------------------------------------------------

  const handleAgentSelectRef = useRef(handleAgentSelect);
  handleAgentSelectRef.current = handleAgentSelect;

  const handleAgentSelectToInstanceRef = useRef(handleAgentSelectToInstance);
  handleAgentSelectToInstanceRef.current = handleAgentSelectToInstance;

  const initialAgentHandled = useRef(false);

  useEffect(() => {
    if (!initialAgentRef || !showAgent || !org || initialAgentHandled.current) {
      return;
    }

    let cancelled = false;
    initialAgentHandled.current = true;

    // When an explicit instance is provided, bind directly to it
    // (skips env collection); otherwise run the full resolution flow.
    const run = initialInstanceId
      ? handleAgentSelectToInstanceRef.current(initialAgentRef, initialInstanceId)
      : handleAgentSelectRef.current(initialAgentRef);

    run.catch(() => {
      if (!cancelled) {
        initialAgentHandled.current = false;
      }
    });

    return () => {
      cancelled = true;
    };
  }, [initialAgentRef, initialInstanceId, showAgent, org]);

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
  // Initial MCP: seed useMcpServerSetup from mcpServerUsages prop on mount
  // ---------------------------------------------------------------------------

  const initialMcpSeeded = useRef(false);
  const mcpSetupAddServerRef = useRef(mcpSetup.addServer);
  mcpSetupAddServerRef.current = mcpSetup.addServer;
  const mcpSetupSetEnabledToolsRef = useRef(mcpSetup.setEnabledTools);
  mcpSetupSetEnabledToolsRef.current = mcpSetup.setEnabledTools;

  useEffect(() => {
    if (!showMcp || initialMcpSeeded.current || !mcpServerUsages?.length) return;
    initialMcpSeeded.current = true;

    for (const usage of mcpServerUsages) {
      const ref = usage.mcpServerRef;
      if (!ref) continue;
      const savedTools = usage.enabledTools;

      mcpSetupAddServerRef.current(ref).then(() => {
        if (savedTools?.length) {
          mcpSetupSetEnabledToolsRef.current(ref, savedTools);
        }
      }).catch(() => {
        // Non-fatal: server may have been deleted or become inaccessible.
        // The user can re-add it via the MCP picker.
      });
    }
  }, [showMcp, mcpServerUsages]);

  // ---------------------------------------------------------------------------
  // MCP server setup: sync usageInputs to consumer
  // ---------------------------------------------------------------------------

  const hasLoadingMcpEntries = useMemo(
    () => Object.values(mcpSetup.entries).some(e => e.status === "loading"),
    [mcpSetup.entries],
  );

  useEffect(() => {
    if (!showMcp || hasLoadingMcpEntries) return;
    onMcpServerUsagesChange?.(mcpSetup.usageInputs);
  }, [showMcp, mcpSetup.usageInputs, onMcpServerUsagesChange, hasLoadingMcpEntries]);

  // ---------------------------------------------------------------------------
  // Submission blocking: MCP servers must be fully configured before send
  // ---------------------------------------------------------------------------

  const mcpBlocked = showMcp && !mcpSetup.allReady;
  const canSend = composer.canSubmit && !mcpBlocked;

  const handleTextareaKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      // Escape exits edit-and-resubmit mode — same reflex as dismissing a
      // popover. Only intercepted while editing so it never shadows other
      // Escape behaviors (e.g. closing an open picker above the textarea).
      if (isEditing && onCancelEdit && e.key === "Escape") {
        e.preventDefault();
        onCancelEdit();
        return;
      }
      if (!canSend && e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        return;
      }
      composer.textareaProps.onKeyDown(e);
    },
    [canSend, composer.textareaProps, isEditing, onCancelEdit],
  );

  const workspaceCount = workspace?.entries.length ?? 0;

  // When only one source type is enabled and no entries exist yet, bypass
  // the popover entirely (desktop) or auto-drill into the GitHub panel (web).
  const workspaceDirectAction = useMemo(() => {
    if (workspaceCount > 0) return undefined;
    if (enableLocal && !enableGitHub && onBrowseLocalFolder) {
      return async () => {
        const path = await onBrowseLocalFolder();
        if (path) workspace?.addLocalPath(path);
      };
    }
    return undefined;
  }, [workspaceCount, enableLocal, enableGitHub, onBrowseLocalFolder, workspace]);

  const workspaceInitialPanel = useMemo(
    () => {
      if (workspaceCount > 0) return null;
      if (enableGitHub && !enableLocal) return "github" as const;
      return null;
    },
    [workspaceCount, enableGitHub, enableLocal],
  );

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
      // A locked agent stays out of the menu unless setup is pending:
      // the env-collection form lives in this panel and must remain
      // reachable until the agent resolves (lock ≠ unwire). Once
      // resolved, the entry disappears and the agent cannot be swapped.
      if (!lockAgent || agentPending) {
        items.push({
          id: "agent",
          icon: <AgentIcon />,
          label: "Agent",
          count: agentRef || agentPending ? 1 : 0,
          hasWarning: agentPending && agentSetup.state.status === "needsEnvVars",
        });
      }
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
  }, [showAgent, lockAgent, agentRef, agentSetup.state, showMcp, mcpCount, mcpSetup.needsSetupCount, showSkills, skillCount, showSessionVars, sessionVarCount]);

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
          // Plan mode tints the frame so the active mode is visible at a
          // glance, without opening the picker. Themeable via --stgm-primary-muted.
          interactionMode === "plan" && "border-primary-muted",
          isDisabled && !stopMode && "opacity-50",
          isDragOver && "ring-2 ring-primary/50",
        )}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* Zone 0.5: Edit-and-resubmit banner. Rendered inside the card so the
            editing state visually owns the text below it — the user reads
            "Editing message" and the prefilled prompt as one unit. */}
        {isEditing && (
          <div
            role="status"
            className="flex items-center justify-between gap-2 rounded-t-xl border-b border-border bg-muted px-3 py-1.5"
          >
            <span className="text-xs font-medium text-muted-foreground">
              Editing message
            </span>
            {onCancelEdit && (
              <button
                type="button"
                onClick={onCancelEdit}
                aria-label="Cancel editing"
                title="Cancel editing (Esc)"
                className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <XIcon />
              </button>
            )}
          </div>
        )}

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
                {isDragOverFileRef ? "Reference workspace file" : "Drop files to attach"}
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

        {/* Zone 2.5: Attachment and file-reference chips */}
        {(showAttach && attachments.hasEntries) || (enableFileReferences && fileRefs.hasRefs) ? (
          <div className="space-y-1.5 px-3 pb-2">
            {showAttach && attachments.hasEntries && (
              <AttachmentChipList
                entries={attachments.entries}
                onRemove={attachments.removeEntry}
                onRetry={attachments.retryEntry}
                disabled={isDisabled}
              />
            )}
            {enableFileReferences && fileRefs.hasRefs && (
              <FileReferenceChipList
                refs={fileRefs.refs}
                onRemove={fileRefs.remove}
                disabled={isDisabled}
              />
            )}
          </div>
        ) : null}

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
          onStop={onStop}
          isStopping={isStopping}
          showWorkspace={showWorkspace}
          workspaceCount={workspaceCount}
          onWorkspaceDirectAction={workspaceDirectAction}
          workspaceContent={
            workspace
              ? <WorkspaceEditor
                    workspace={workspace}
                    disabled={isDisabled}
                    gitHubConnection={gitHubConnection}
                    enableGitHub={enableGitHub}
                    enableLocal={enableLocal}
                    onBrowseLocalFolder={onBrowseLocalFolder}
                    initialPanel={workspaceInitialPanel}
                  />
              : null
          }
          showAttach={showAttach}
          attachmentCount={attachments.entries.length}
          onAttachClick={() => fileInputRef.current?.click()}
          configureItems={configureItems}
          configOpen={configOpen}
          onConfigOpenChange={handleConfigOpenChange}
          configActivePanel={configActivePanel}
          onConfigActivePanelChange={handleConfigActivePanelChange}
          renderConfigPanel={renderConfigPanel}
          showHarnessSelector={showHarnessSelector}
          harness={harness}
          onHarnessChange={handleHarnessChange}
          showInteractionModePicker={showInteractionModePicker}
          interactionMode={interactionMode}
          onInteractionModeChange={handleInteractionModeChange}
          showModelSelector={showModelSelector}
          modelId={modelId}
          onModelChange={handleModelChange}
        />
      </div>
    </div>
  );
});

export const SessionComposer = memo(SessionComposerInner);


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

