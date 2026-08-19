"use client";

import { useCallback, useState } from "react";
import { cn } from "@stigmer/theme";
import { getUserMessage } from "@stigmer/sdk";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { Memory } from "@stigmer/protos/ai/stigmer/agentic/memory/v1/api_pb";
import { MemoryLifecycleState } from "@stigmer/protos/ai/stigmer/agentic/memory/v1/enum_pb";
import { formatRelativeTime } from "../activity/format-relative-time.js";
import { SpinnerIcon } from "../internal/SpinnerIcon.js";
import { formatMemoryProvenance, groupMemoriesByLifecycle } from "./memoryGroups.js";
import { useConfirmMemory } from "./useConfirmMemory.js";
import { useDeleteMemory } from "./useDeleteMemory.js";
import { useMemories } from "./useMemories.js";
import { useRejectMemory } from "./useRejectMemory.js";
import { useUpdateMemoryContent } from "./useUpdateMemoryContent.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Props for {@link MemoryListPanel}. */
export interface MemoryListPanelProps {
  /** Organization whose memories to show. */
  readonly org: string;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
  /**
   * Reference instant for relative timestamps. Defaults to the live
   * clock. **Deterministic hosts (documentation embeds, video export)
   * must pass a frozen instant.**
   */
  readonly now?: Date;
}

/**
 * Lists everything the platform remembers about the caller in an
 * organization, grouped pending-proposals-first (DD-005 D4): proposals
 * awaiting a decision, then confirmed facts, then rejected proposals
 * kept for audit.
 *
 * Every fact is shown VERBATIM — the exact stored text is what future
 * prompts inject, byte for byte, so the review surface never paraphrases
 * (DD-005 D6). Provenance renders beside each agent-proposed fact.
 * Actions per state: confirm/reject/delete on proposals (reject is
 * one-click — no confirmation dialog), edit/delete on confirmed facts,
 * delete on rejected ones. Delete asks inline; it works in any state.
 *
 * All visual properties flow through `--stgm-*` design tokens.
 *
 * @example
 * ```tsx
 * <MemoryListPanel org="acme" />
 * ```
 */
export function MemoryListPanel({ org, className, now }: MemoryListPanelProps) {
  const { memories, isLoading, error, refetch } = useMemories(org);
  // At most one row is mid-interaction at a time — the ApiKeyListPanel
  // single-confirmation posture, extended with an editing mode.
  const [rowState, setRowState] = useState<
    | { mode: "idle" }
    | { mode: "confirming-delete"; id: string }
    | { mode: "editing"; id: string }
  >({ mode: "idle" });

  const resetRow = useCallback(() => setRowState({ mode: "idle" }), []);
  const handleChanged = useCallback(() => {
    setRowState({ mode: "idle" });
    refetch();
  }, [refetch]);

  if (isLoading) {
    return (
      <div
        className={cn("stg:space-y-2", className)}
        aria-busy="true"
        aria-label="Loading memories"
      >
        {Array.from({ length: 2 }, (_, i) => (
          <div
            key={i}
            className="stg:bg-muted-subtle stg:h-14 stg:animate-pulse stg:rounded-lg"
          />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <p className={cn("stg:text-destructive stg:text-xs", className)} role="alert">
        {getUserMessage(error)}
      </p>
    );
  }

  if (memories.length === 0) {
    return (
      <p
        className={cn(
          "stg:text-muted-foreground stg:py-4 stg:text-center stg:text-xs",
          className,
        )}
      >
        Nothing remembered yet. When an agent proposes a fact worth
        keeping, it appears here for your decision.
      </p>
    );
  }

  const groups = groupMemoriesByLifecycle(memories);

  return (
    <div className={cn("stg:space-y-6", className)}>
      {groups.proposed.length > 0 && (
        <MemoryGroup
          heading="Pending proposals"
          description="Facts agents proposed to remember. Nothing is stored in your sessions until you confirm it."
          memories={groups.proposed}
          rowState={rowState}
          setRowState={setRowState}
          onChanged={handleChanged}
          onCancel={resetRow}
          now={now}
        />
      )}
      {groups.confirmed.length > 0 && (
        <MemoryGroup
          heading="Remembered"
          description="Confirmed facts, shared with agents in your future sessions."
          memories={groups.confirmed}
          rowState={rowState}
          setRowState={setRowState}
          onChanged={handleChanged}
          onCancel={resetRow}
          now={now}
        />
      )}
      {groups.rejected.length > 0 && (
        <MemoryGroup
          heading="Rejected"
          description="Proposals you declined, kept for reference. Delete them to clear the record."
          memories={groups.rejected}
          rowState={rowState}
          setRowState={setRowState}
          onChanged={handleChanged}
          onCancel={resetRow}
          now={now}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Group + row (internal)
// ---------------------------------------------------------------------------

type RowState =
  | { mode: "idle" }
  | { mode: "confirming-delete"; id: string }
  | { mode: "editing"; id: string };

function MemoryGroup({
  heading,
  description,
  memories,
  rowState,
  setRowState,
  onChanged,
  onCancel,
  now,
}: {
  heading: string;
  description: string;
  memories: readonly Memory[];
  rowState: RowState;
  setRowState: (state: RowState) => void;
  onChanged: () => void;
  onCancel: () => void;
  now?: Date;
}) {
  return (
    <div>
      <h3 className="stg:text-foreground stg:text-xs stg:font-semibold">
        {heading}
      </h3>
      <p className="stg:text-muted-foreground stg:mb-2 stg:text-xs">
        {description}
      </p>
      <div className="stg:space-y-2" role="list" aria-label={heading}>
        {memories.map((memory) => {
          const id = memory.metadata?.id ?? "";
          return (
            <MemoryRow
              key={id}
              memory={memory}
              now={now}
              mode={
                rowState.mode !== "idle" && rowState.id === id
                  ? rowState.mode
                  : "idle"
              }
              onStartDelete={() => setRowState({ mode: "confirming-delete", id })}
              onStartEdit={() => setRowState({ mode: "editing", id })}
              onCancel={onCancel}
              onChanged={onChanged}
            />
          );
        })}
      </div>
    </div>
  );
}

function MemoryRow({
  memory,
  now,
  mode,
  onStartDelete,
  onStartEdit,
  onCancel,
  onChanged,
}: {
  memory: Memory;
  now?: Date;
  mode: "idle" | "confirming-delete" | "editing";
  onStartDelete: () => void;
  onStartEdit: () => void;
  onCancel: () => void;
  onChanged: () => void;
}) {
  const id = memory.metadata?.id ?? "";
  const content = memory.spec?.content ?? "";
  const state = memory.status?.lifecycleState;
  const provenance = formatMemoryProvenance(memory);
  const stateChangedAt = memory.status?.stateChangedAt;

  const { confirmMemory, isConfirming, error: confirmError } = useConfirmMemory();
  const { rejectMemory, isRejecting, error: rejectError } = useRejectMemory();
  const { deleteMemory, isDeleting, error: deleteError } = useDeleteMemory();

  const actionError = confirmError ?? rejectError ?? deleteError;
  const isBusy = isConfirming || isRejecting || isDeleting;

  const act = useCallback(
    async (action: (id: string) => Promise<Memory>) => {
      try {
        await action(id);
        onChanged();
      } catch {
        // error state is surfaced via the hooks
      }
    },
    [id, onChanged],
  );

  if (mode === "editing") {
    return (
      <MemoryEditRow memory={memory} onCancel={onCancel} onSaved={onChanged} />
    );
  }

  if (mode === "confirming-delete") {
    return (
      <div
        role="listitem"
        className="stg:flex stg:items-center stg:justify-between stg:gap-3 stg:rounded-lg stg:border stg:border-destructive/30 stg:bg-destructive-subtle stg:px-3 stg:py-2.5"
      >
        <div className="stg:min-w-0 stg:flex-1">
          <p className="stg:text-xs stg:text-foreground">
            Forget this permanently? <q className="stg:italic">{content}</q>
          </p>
          {deleteError && (
            <p className="stg:mt-0.5 stg:text-[0.65rem] stg:text-destructive">
              {getUserMessage(deleteError)}
            </p>
          )}
        </div>
        <div className="stg:flex stg:shrink-0 stg:items-center stg:gap-1.5">
          <button
            type="button"
            onClick={() => void act(deleteMemory)}
            disabled={isDeleting}
            className={cn(
              "stg:inline-flex stg:items-center stg:gap-1 stg:rounded-md stg:px-2.5 stg:py-1 stg:text-xs stg:font-medium",
              "stg:bg-destructive stg:text-destructive-foreground stg:hover:bg-destructive-hover",
              "stg:disabled:pointer-events-none stg:disabled:opacity-50",
            )}
          >
            {isDeleting && <SpinnerIcon size={12} />}
            Delete
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={isDeleting}
            className={cn(
              "stg:rounded-md stg:px-2.5 stg:py-1 stg:text-xs",
              "stg:text-muted-foreground stg:hover:text-foreground stg:hover:bg-accent-hover",
              "stg:disabled:pointer-events-none stg:disabled:opacity-50",
            )}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      role="listitem"
      className="stg:rounded-lg stg:border stg:border-border-muted stg:px-3 stg:py-2.5 stg:hover:border-border stg:transition-colors"
    >
      <div className="stg:flex stg:items-start stg:justify-between stg:gap-3">
        <div className="stg:min-w-0 stg:flex-1">
          {/* The exact stored text, verbatim — what is confirmed is what
              future prompts inject, byte for byte (DD-005 D6). */}
          <p className="stg:text-sm stg:text-foreground stg:whitespace-pre-wrap">
            {content}
          </p>
          <p className="stg:mt-1 stg:text-xs stg:text-muted-foreground">
            {provenance ? `${provenance} · ` : ""}
            {formatStateStamp(state, stateChangedAt ? timestampDate(stateChangedAt) : undefined, now)}
          </p>
          {actionError && (
            <p className="stg:mt-0.5 stg:text-[0.65rem] stg:text-destructive" role="alert">
              {getUserMessage(actionError)}
            </p>
          )}
        </div>

        <div className="stg:flex stg:shrink-0 stg:items-center stg:gap-1.5">
          {state === MemoryLifecycleState.lifecycle_state_confirmed && (
            <RowButton label={`Edit memory: ${content}`} onClick={onStartEdit} disabled={isBusy}>
              Edit
            </RowButton>
          )}
          {isProposed(state) && (
            <>
              <RowButton
                label={`Confirm memory: ${content}`}
                onClick={() => void act(confirmMemory)}
                disabled={isBusy}
                emphasis="primary"
              >
                {isConfirming && <SpinnerIcon size={12} />}
                Confirm
              </RowButton>
              <RowButton
                label={`Reject memory: ${content}`}
                onClick={() => void act(rejectMemory)}
                disabled={isBusy}
              >
                {isRejecting && <SpinnerIcon size={12} />}
                Reject
              </RowButton>
            </>
          )}
          <button
            type="button"
            onClick={onStartDelete}
            disabled={isBusy}
            aria-label={`Delete memory: ${content}`}
            className={cn(
              "stg:shrink-0 stg:rounded stg:p-1",
              "stg:text-muted-foreground stg:hover:text-destructive stg:hover:bg-destructive-subtle",
              "stg:transition-colors stg:disabled:pointer-events-none stg:disabled:opacity-50",
            )}
          >
            <TrashIcon />
          </button>
        </div>
      </div>
    </div>
  );
}

// MemoryEditRow edits the fact text in place — the one field the
// subject owns. Saving maps the loaded record through the generated
// update mapper (wipe-safe) and overrides only content.
function MemoryEditRow({
  memory,
  onCancel,
  onSaved,
}: {
  memory: Memory;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState(memory.spec?.content ?? "");
  const { updateContent, isUpdating, error } = useUpdateMemoryContent();

  const trimmed = draft.trim();
  const canSave = trimmed.length > 0 && trimmed.length <= 500 && !isUpdating;

  const handleSave = async () => {
    try {
      await updateContent(memory, trimmed);
      onSaved();
    } catch {
      // error state is surfaced via the hook
    }
  };

  return (
    <div
      role="listitem"
      className="stg:rounded-lg stg:border stg:border-border stg:px-3 stg:py-2.5"
    >
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={2}
        maxLength={500}
        aria-label="Edit memory text"
        className={cn(
          "stg:w-full stg:resize-y stg:rounded-md stg:border stg:border-input stg:bg-background stg:px-2 stg:py-1.5 stg:text-sm stg:text-foreground",
          "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
        )}
      />
      <div className="stg:mt-1.5 stg:flex stg:items-center stg:justify-between">
        <span className="stg:text-[0.65rem] stg:text-muted-foreground">
          {trimmed.length}/500
        </span>
        <div className="stg:flex stg:items-center stg:gap-1.5">
          <RowButton
            label="Save memory text"
            onClick={() => void handleSave()}
            disabled={!canSave}
            emphasis="primary"
          >
            {isUpdating && <SpinnerIcon size={12} />}
            Save
          </RowButton>
          <RowButton label="Cancel editing" onClick={onCancel} disabled={isUpdating}>
            Cancel
          </RowButton>
        </div>
      </div>
      {error && (
        <p className="stg:mt-1 stg:text-[0.65rem] stg:text-destructive" role="alert">
          {getUserMessage(error)}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Presentation helpers (internal)
// ---------------------------------------------------------------------------

function isProposed(state: MemoryLifecycleState | undefined): boolean {
  // The zero unspecified state should not exist (create stamps
  // proposed); offering the decision actions is the safe rendering.
  return (
    state === undefined ||
    state === MemoryLifecycleState.lifecycle_state_unspecified ||
    state === MemoryLifecycleState.lifecycle_state_proposed
  );
}

function formatStateStamp(
  state: MemoryLifecycleState | undefined,
  changedAt: Date | undefined,
  now: Date | undefined,
): string {
  const verb =
    state === MemoryLifecycleState.lifecycle_state_confirmed
      ? "Confirmed"
      : state === MemoryLifecycleState.lifecycle_state_rejected
        ? "Rejected"
        : "Proposed";
  if (!changedAt) return verb;
  return `${verb} ${formatRelativeTime(changedAt, now)}`;
}

function RowButton({
  label,
  onClick,
  disabled,
  emphasis,
  children,
}: {
  readonly label: string;
  readonly onClick: () => void;
  readonly disabled?: boolean;
  readonly emphasis?: "primary";
  readonly children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "stg:inline-flex stg:items-center stg:gap-1 stg:rounded-md stg:px-2 stg:py-1 stg:text-xs stg:font-medium",
        emphasis === "primary"
          ? "stg:bg-primary stg:text-primary-foreground stg:hover:bg-primary-hover"
          : "stg:border stg:border-input stg:bg-background stg:text-foreground stg:hover:bg-accent stg:hover:text-accent-foreground",
        "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
        "stg:disabled:pointer-events-none stg:disabled:opacity-50",
      )}
    >
      {children}
    </button>
  );
}

function TrashIcon() {
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
      <path d="M2.5 4h11M5.5 4V2.5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V4" />
      <path d="M12.5 4v9a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1V4" />
      <line x1="6.5" y1="7" x2="6.5" y2="11" />
      <line x1="9.5" y1="7" x2="9.5" y2="11" />
    </svg>
  );
}
