"use client";

import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { cn } from "@stigmer/theme";
import { Popover } from "@base-ui/react/popover";
import { getUserMessage, type EnvVarInput, type McpServerUsageInput, type ResourceRef } from "@stigmer/sdk";
import { useComposer } from "./useComposer";
import { ModelSelector } from "../models/ModelSelector";
import { WorkspaceEditor } from "../workspace/WorkspaceEditor";
import { AgentPicker } from "../agent/AgentPicker";
import { AgentEnvForm, type AgentEnvFormSubmitOptions } from "../agent/AgentEnvForm";
import { useAgentSetup, type AgentResolution } from "../agent/useAgentSetup";
import { SecretFlowErrorGuide, isSecretFlowError } from "../error/SecretFlowErrorGuide";
import { McpServerPicker } from "../mcp-server/McpServerPicker";
import { useMcpServerSetup } from "../mcp-server/useMcpServerSetup";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { SkillPicker } from "../skill/SkillPicker";
import { OneTimeSecretsInput } from "../execution/OneTimeSecretsInput";
import type { UseOneTimeSecretsReturn } from "../execution/useOneTimeSecrets";
import type { UseWorkspaceEntriesReturn } from "../workspace/useWorkspaceEntries";
import type { UseGitHubConnectionReturn } from "../github/useGitHubConnection";

export interface SessionComposerProps {
  /** Called when the user submits a message. */
  readonly onSubmit: (message: string, modelName?: string) => void;
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
  /** Use the visual folder browser instead of a text input. @default false */
  readonly enableFolderBrowser?: boolean;

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
   * One-time secrets state managed by {@link useOneTimeSecrets}.
   * When provided, renders a "Secrets" trigger in the toolbar that
   * opens a key-value editor for execution-scoped environment variables.
   *
   * Unlike workspace, MCP, and skill context (which are session-level),
   * one-time secrets are ephemeral — the consumer should call
   * `secrets.clear()` after submission.
   */
  readonly secrets?: UseOneTimeSecretsReturn;

  /** Placeholder text for the textarea. @default "Reply\u2026" */
  readonly placeholder?: string;
  /** Initial number of visible rows. @default 1 */
  readonly initialRows?: number;
  /** Auto-focus the textarea on mount. @default false */
  readonly autoFocus?: boolean;
  /** ARIA label for the composer region. @default "Send message" */
  readonly ariaLabel?: string;

  readonly className?: string;
}

/**
 * Unified message composer for Stigmer sessions.
 *
 * Combines a self-resizing textarea, model selector, and context pickers
 * (agent, workspace, MCP servers, skills) into a single input card.
 * Context pickers appear as toolbar triggers that open popovers. Selected
 * items render as removable chips between the textarea and toolbar.
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
  enableFolderBrowser = false,
  org,
  agentRef,
  onAgentRefChange,
  onAgentResolutionChange,
  mcpServerUsages,
  onMcpServerUsagesChange,
  skillRefs,
  onSkillRefsChange,
  secrets,
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

  const handleSubmit = useCallback(
    (message: string) => {
      onSubmit(message, modelId);
    },
    [onSubmit, modelId],
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

  const showAgent = onAgentRefChange != null && org != null;
  const showMcp = onMcpServerUsagesChange != null && org != null;

  // -------------------------------------------------------------------------
  // Agent setup: state-machine-driven popover + environment resolution
  // -------------------------------------------------------------------------

  const agentSetup = useAgentSetup(showAgent ? (org ?? null) : null);

  const [agentPopoverOpen, setAgentPopoverOpen] = useState(false);

  const showEnvForm = agentSetup.state.status === "needsEnvVars";
  const isAgentBusy =
    agentSetup.state.status === "resolving" ||
    agentSetup.state.status === "submitting";

  const handleAgentPopoverOpenChange = useCallback(
    (open: boolean) => {
      setAgentPopoverOpen(open);
      if (!open) {
        agentSetup.reset();
      }
    },
    [agentSetup],
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
          setAgentPopoverOpen(false);
        }
        // "needsEnvVars" — state machine transitions automatically,
        // popover content switches to env form via `showEnvForm`.
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
        setAgentPopoverOpen(false);
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

  // -------------------------------------------------------------------------
  // MCP server setup: multi-server credential + tool selection flow
  // -------------------------------------------------------------------------

  const mcpSetup = useMcpServerSetup(showMcp ? (org ?? null) : null);

  const [mcpPopoverOpen, setMcpPopoverOpen] = useState(false);

  useEffect(() => {
    if (!showMcp) return;
    onMcpServerUsagesChange?.(mcpSetup.usageInputs);
  }, [showMcp, mcpSetup.usageInputs, onMcpServerUsagesChange]);

  // -------------------------------------------------------------------------
  // Submission blocking: MCP servers must be fully configured before send
  // -------------------------------------------------------------------------

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

  const showWorkspace = workspace != null;
  const showSkills = onSkillRefsChange != null && org != null;
  const showSecrets = secrets != null;
  const hasContextTriggers =
    showAgent || showWorkspace || showMcp || showSkills || showSecrets;

  // Build chip items from all context sources
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
        items.push({
          key: `mcp:${key}`,
          label: name,
          type: "mcp",
          onRemove: () => mcpSetup.removeServer(mcpRefFromKey(key)),
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

    if (secrets) {
      for (const entry of secrets.entries) {
        const k = entry.key.trim();
        if (k === "") continue;
        items.push({
          key: `secret:${entry.id}`,
          label: k,
          type: "secret",
          onRemove: () => secrets.removeEntry(entry.id),
        });
      }
    }

    return items;
  }, [
    agentRef,
    handleAgentChipRemove,
    workspace,
    showMcp,
    mcpSetup.entries,
    mcpSetup.removeServer,
    skillRefs,
    secrets,
    displayNames,
    onSkillRefsChange,
  ]);

  const workspaceCount = workspace?.entries.length ?? 0;
  const mcpCount = showMcp ? Object.keys(mcpSetup.entries).length : 0;
  const skillCount = skillRefs?.length ?? 0;
  const secretCount = secrets?.entries.length ?? 0;

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
        )}
      >
        {/* Zone 1: Textarea */}
        <textarea
          {...composer.textareaProps}
          onKeyDown={handleTextareaKeyDown}
          placeholder={placeholder}
          rows={initialRows}
          autoFocus={autoFocus}
          className="block w-full resize-none bg-transparent px-4 pt-3 pb-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none disabled:cursor-not-allowed"
        />

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
              />
            ))}
          </div>
        )}

        {/* Zone 2.5: MCP setup warning */}
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
              onClick={() => setMcpPopoverOpen(true)}
              disabled={isDisabled}
              className="ml-auto shrink-0 rounded px-1.5 py-0.5 text-[0.6rem] font-medium hover:bg-warning/20 disabled:pointer-events-none disabled:opacity-50"
            >
              Configure
            </button>
          </div>
        )}

        {/* Zone 3: Toolbar */}
        <div className="flex items-center justify-between gap-2 border-t border-border/50 px-3 py-2">
          <div className="flex items-center gap-1.5">
            {/* Context triggers */}
            {hasContextTriggers && (
              <>
                {showAgent && (
                  <ContextPopover
                    icon={<AgentIcon />}
                    label="Agent"
                    count={agentRef ? 1 : 0}
                    disabled={isDisabled}
                    open={agentPopoverOpen}
                    onOpenChange={handleAgentPopoverOpenChange}
                  >
                    {showEnvForm ? (
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
                    )}
                  </ContextPopover>
                )}

                {showWorkspace && (
                  <ContextPopover
                    icon={<WorkspaceIcon />}
                    label="Workspace"
                    count={workspaceCount}
                    disabled={isDisabled}
                  >
                    <WorkspaceEditor
                      workspace={workspace}
                      disabled={isDisabled}
                      gitHubConnection={gitHubConnection}
                      enableGitHub={enableGitHub}
                      enableLocal={enableLocal}
                      enableFolderBrowser={enableFolderBrowser}
                    />
                  </ContextPopover>
                )}

                {showMcp && (
                  <ContextPopover
                    icon={<McpServerIcon />}
                    label="MCP"
                    count={mcpCount}
                    disabled={isDisabled}
                    open={mcpPopoverOpen}
                    onOpenChange={setMcpPopoverOpen}
                  >
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
                      onDisplayNameResolved={handleDisplayNameResolved}
                      disabled={isDisabled}
                    />
                  </ContextPopover>
                )}

                {showSkills && (
                  <ContextPopover
                    icon={<SkillIcon />}
                    label="Skills"
                    count={skillCount}
                    disabled={isDisabled}
                  >
                    <SkillPicker
                      org={org!}
                      value={skillRefs ?? []}
                      onChange={onSkillRefsChange!}
                      onDisplayNameResolved={handleDisplayNameResolved}
                      disabled={isDisabled}
                    />
                  </ContextPopover>
                )}

                {showSecrets && (
                  <ContextPopover
                    icon={<SecretsIcon />}
                    label="Secrets"
                    count={secretCount}
                    disabled={isDisabled}
                  >
                    <OneTimeSecretsInput
                      secrets={secrets}
                      disabled={isDisabled}
                    />
                  </ContextPopover>
                )}

                {showModelSelector && (
                  <div className="mx-0.5 h-4 w-px bg-border/50" />
                )}
              </>
            )}

            {showModelSelector && (
              <ModelSelector
                value={modelId}
                onValueChange={handleModelChange}
                disabled={isDisabled}
              />
            )}
          </div>

          <button
            type="button"
            disabled={!canSend}
            onClick={composer.submit}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-40"
            aria-label="Send message"
          >
            {isSubmitting ? <SpinnerIcon /> : <ArrowUpIcon />}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Context popover wrapper
// ---------------------------------------------------------------------------

function ContextPopover({
  icon,
  label,
  count,
  children,
  disabled,
  open,
  onOpenChange,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  children: React.ReactNode;
  disabled?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger
        disabled={disabled}
        className={cn(
          "inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs transition-colors",
          "text-muted-foreground hover:text-foreground hover:bg-accent/50",
          "disabled:pointer-events-none disabled:opacity-50",
        )}
      >
        {icon}
        <span>{label}</span>
        {count > 0 && (
          <span className="rounded-full bg-primary/15 px-1.5 text-[0.6rem] font-medium text-primary">
            {count}
          </span>
        )}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={8} align="start">
          <Popover.Popup
            className={[
              "z-popover overflow-x-hidden overflow-y-auto rounded-lg border border-border",
              "bg-popover p-3 shadow-md text-popover-foreground",
              "max-h-[80vh]",
            ].join(" ")}
          >
            {children}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

// ---------------------------------------------------------------------------
// Context chip
// ---------------------------------------------------------------------------

interface ChipItem {
  key: string;
  label: string;
  type: "agent" | "workspace" | "mcp" | "skill" | "secret";
  onRemove: () => void;
}

const CHIP_TYPE_LABELS: Record<ChipItem["type"], string> = {
  agent: "Agent",
  workspace: "WS",
  mcp: "MCP",
  skill: "Skill",
  secret: "1-time",
};

function ContextChip({
  label,
  type,
  onRemove,
  disabled,
}: {
  label: string;
  type: ChipItem["type"];
  onRemove: () => void;
  disabled?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-muted/50 px-2 py-0.5 text-xs text-foreground">
      <span className="text-[0.55rem] font-medium uppercase tracking-wider text-muted-foreground">
        {CHIP_TYPE_LABELS[type]}
      </span>
      <span className="max-w-[120px] truncate">{label}</span>
      <button
        type="button"
        onClick={onRemove}
        disabled={disabled}
        className="ml-0.5 shrink-0 text-muted-foreground hover:text-destructive disabled:pointer-events-none"
        aria-label={`Remove ${label}`}
      >
        <XIcon />
      </button>
    </span>
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

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function AlertTriangleIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8 1.5 1.5 13.5h13L8 1.5z" />
      <path d="M8 6v3" />
      <circle cx="8" cy="11" r="0.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

function ArrowUpIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8 12V4M4 7l4-4 4 4" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      className="animate-spin"
      aria-hidden="true"
    >
      <path d="M8 2a6 6 0 1 0 6 6" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 4L10 10M10 4L4 10" />
    </svg>
  );
}

function AgentIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="5" width="10" height="8" rx="2" />
      <circle cx="6" cy="9" r="1" fill="currentColor" stroke="none" />
      <circle cx="10" cy="9" r="1" fill="currentColor" stroke="none" />
      <path d="M8 1v4" />
      <circle cx="8" cy="1" r="1" />
    </svg>
  );
}

function WorkspaceIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M1.5 3.5V11a1 1 0 001 1h9a1 1 0 001-1V5.5a1 1 0 00-1-1H7L5.5 3H2.5a1 1 0 00-1 .5z" />
    </svg>
  );
}

function McpServerIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="2" y="2" width="12" height="4" rx="1" />
      <rect x="2" y="10" width="12" height="4" rx="1" />
      <circle cx="5" cy="4" r="0.75" fill="currentColor" stroke="none" />
      <circle cx="5" cy="12" r="0.75" fill="currentColor" stroke="none" />
    </svg>
  );
}

function SkillIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 3h12M2 7h8M2 11h10M2 15h6" />
    </svg>
  );
}

function SecretsIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="8" width="10" height="6" rx="1.5" />
      <path d="M5 8V5.5a3 3 0 0 1 6 0V8" />
      <circle cx="8" cy="11.5" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function ResolveSpinner() {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        className="animate-spin text-muted-foreground"
        aria-hidden="true"
      >
        <path d="M8 2a6 6 0 1 0 6 6" />
      </svg>
      <span className="text-[0.6rem] text-muted-foreground">
        Checking agent requirements...
      </span>
    </div>
  );
}
