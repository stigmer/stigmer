"use client";

import { useCallback, useMemo, useState } from "react";
import { cn } from "@stigmer/theme";
import { Popover } from "@base-ui/react/popover";
import type { McpServerUsageInput, ResourceRef } from "@stigmer/sdk";
import { useComposer } from "./useComposer";
import { ModelSelector } from "../models/ModelSelector";
import { WorkspaceEditor } from "../workspace/WorkspaceEditor";
import { McpServerPicker } from "../mcp-server/McpServerPicker";
import { SkillPicker } from "../skill/SkillPicker";
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
   * Organization slug for MCP server and skill searches.
   * Required when MCP or skill pickers are enabled.
   */
  readonly org?: string;

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
 * (workspace, MCP servers, skills) into a single input card. Context
 * pickers appear as toolbar triggers that open popovers. Selected items
 * render as removable chips between the textarea and toolbar.
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
  mcpServerUsages,
  onMcpServerUsagesChange,
  skillRefs,
  onSkillRefsChange,
  placeholder = "Reply\u2026",
  initialRows = 1,
  autoFocus = false,
  ariaLabel = "Send message",
  className,
}: SessionComposerProps) {
  const [modelId, setModelId] = useState<string | undefined>(defaultModelId);

  // Display name cache for MCP servers and skills (populated by pickers)
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

  const showWorkspace = workspace != null;
  const showMcp = onMcpServerUsagesChange != null && org != null;
  const showSkills = onSkillRefsChange != null && org != null;
  const hasContextTriggers = showWorkspace || showMcp || showSkills;

  // Build chip items from all context sources
  const chips = useMemo(() => {
    const items: ChipItem[] = [];

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

    if (mcpServerUsages) {
      for (const usage of mcpServerUsages) {
        const refStr = `${usage.mcpServerRef.org}/${usage.mcpServerRef.slug}`;
        items.push({
          key: `mcp:${refStr}`,
          label: displayNames.get(refStr) ?? usage.mcpServerRef.slug,
          type: "mcp",
          onRemove: () => {
            onMcpServerUsagesChange?.(
              mcpServerUsages.filter(
                (u) =>
                  `${u.mcpServerRef.org}/${u.mcpServerRef.slug}` !== refStr,
              ),
            );
          },
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

    return items;
  }, [
    workspace,
    mcpServerUsages,
    skillRefs,
    displayNames,
    onMcpServerUsagesChange,
    onSkillRefsChange,
  ]);

  const workspaceCount = workspace?.entries.length ?? 0;
  const mcpCount = mcpServerUsages?.length ?? 0;
  const skillCount = skillRefs?.length ?? 0;

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

        {/* Zone 3: Toolbar */}
        <div className="flex items-center justify-between gap-2 border-t border-border/50 px-3 py-2">
          <div className="flex items-center gap-1.5">
            {/* Context triggers */}
            {hasContextTriggers && (
              <>
                {showWorkspace && (
                  <ContextPopover
                    trigger={
                      <ContextTriggerButton
                        icon={<WorkspaceIcon />}
                        label="Workspace"
                        count={workspaceCount}
                        disabled={isDisabled}
                      />
                    }
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
                    trigger={
                      <ContextTriggerButton
                        icon={<McpServerIcon />}
                        label="MCP"
                        count={mcpCount}
                        disabled={isDisabled}
                      />
                    }
                    disabled={isDisabled}
                  >
                    <McpServerPicker
                      org={org!}
                      value={mcpServerUsages ?? []}
                      onChange={onMcpServerUsagesChange!}
                      onDisplayNameResolved={handleDisplayNameResolved}
                      disabled={isDisabled}
                    />
                  </ContextPopover>
                )}

                {showSkills && (
                  <ContextPopover
                    trigger={
                      <ContextTriggerButton
                        icon={<SkillIcon />}
                        label="Skills"
                        count={skillCount}
                        disabled={isDisabled}
                      />
                    }
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
            disabled={!composer.canSubmit}
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
  trigger,
  children,
  disabled,
}: {
  trigger: React.ReactNode;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <Popover.Root>
      <Popover.Trigger
        disabled={disabled}
        render={(props) => <span {...props}>{trigger}</span>}
      />
      <Popover.Portal>
          <Popover.Positioner sideOffset={8} align="start">
          <Popover.Popup
            className={[
              "z-popover overflow-hidden rounded-lg border border-border",
              "bg-popover p-3 shadow-md text-popover-foreground",
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
// Context trigger button
// ---------------------------------------------------------------------------

function ContextTriggerButton({
  icon,
  label,
  count,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
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
    </button>
  );
}

// ---------------------------------------------------------------------------
// Context chip
// ---------------------------------------------------------------------------

interface ChipItem {
  key: string;
  label: string;
  type: "workspace" | "mcp" | "skill";
  onRemove: () => void;
}

const CHIP_TYPE_LABELS: Record<ChipItem["type"], string> = {
  workspace: "WS",
  mcp: "MCP",
  skill: "Skill",
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
// Icons
// ---------------------------------------------------------------------------

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
