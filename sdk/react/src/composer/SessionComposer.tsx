"use client";

import { useCallback, useState } from "react";
import { cn } from "@stigmer/theme";
import { useComposer } from "./useComposer";
import { ModelSelector } from "../models/ModelSelector";
import { WorkspaceEditor } from "../workspace/WorkspaceEditor";
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
   * When provided, renders workspace entry chips and source buttons
   * in the toolbar.
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
 * Combines a self-resizing textarea, model selector, and optional
 * workspace editor into a single input card. Used for both new session
 * creation (launcher) and follow-up messages within an existing session.
 *
 * Layout positioning (centered vs bottom-pinned) is the consumer's
 * responsibility -- this component renders the card only, not the
 * surrounding layout.
 *
 * Uses `<div role="form">` instead of `<form>` so it can be embedded
 * inside host application forms without nesting violations.
 *
 * All visual properties flow through `--stgm-*` tokens.
 *
 * @example
 * ```tsx
 * // Launcher (centered, larger textarea)
 * <SessionComposer
 *   onSubmit={handleCreate}
 *   workspace={workspace}
 *   enableGitHub
 *   initialRows={3}
 *   placeholder="Describe what you need help with..."
 *   autoFocus
 * />
 *
 * // Follow-up (bottom-pinned, compact)
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
  placeholder = "Reply\u2026",
  initialRows = 1,
  autoFocus = false,
  ariaLabel = "Send message",
  className,
}: SessionComposerProps) {
  const [modelId, setModelId] = useState<string | undefined>(defaultModelId);

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

  const showWorkspace = workspace != null;

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
        <textarea
          {...composer.textareaProps}
          placeholder={placeholder}
          rows={initialRows}
          autoFocus={autoFocus}
          className="block w-full resize-none bg-transparent px-4 pt-3 pb-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none disabled:cursor-not-allowed"
        />

        <div className="flex items-center justify-between gap-2 border-t border-border/50 px-3 py-2">
          <div className="flex items-center gap-2">
            {showModelSelector && (
              <ModelSelector
                value={modelId}
                onValueChange={handleModelChange}
                disabled={isDisabled}
              />
            )}
            {showWorkspace && workspace.hasEntries && (
              <span className="rounded-md bg-muted px-2 py-1 text-[0.65rem] text-muted-foreground">
                {workspace.entries.length} workspace
                {workspace.entries.length !== 1 ? "s" : ""}
              </span>
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

      {showWorkspace && (
        <div className="mt-2">
          <WorkspaceEditor
            workspace={workspace}
            disabled={isDisabled}
            gitHubConnection={gitHubConnection}
            enableGitHub={enableGitHub}
            enableLocal={enableLocal}
            enableFolderBrowser={enableFolderBrowser}
          />
        </div>
      )}
    </div>
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
