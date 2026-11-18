"use client";

import { useCallback, useState } from "react";
import { cn } from "@stigmer/design-tokens";
import { getUserMessage } from "@stigmer/client";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { Memory } from "@stigmer/apis/ai/stigmer/agentic/memory/v1/api_pb";
import { MemoryLifecycleState } from "@stigmer/apis/ai/stigmer/agentic/memory/v1/enum_pb";
import { formatRelativeTime } from "../activity/format-relative-time.js";
import { Button } from "../button/Button.js";
import { IconButton } from "../button/IconButton.js";
import { SpinnerIcon } from "../internal/SpinnerIcon.js";
import { formatMemoryProvenance, groupMemoriesByLifecycle } from "./memoryGroups.js";
import { useConfirmMemory } from "./useConfirmMemory.js";
import { useDeleteMemory } from "./useDeleteMemory.js";
import { useMemories } from "./useMemories.js";
import { useRejectMemory } from "./useRejectMemory.js";
import { useUpdateMemoryContent } from "./useUpdateMemoryContent.js";
import { SettingsSkeleton } from "../settings/SettingsSkeleton.js";
import { ErrorMessage } from "../error/ErrorMessage.js";
import { EmptyState } from "../empty-state/EmptyState.js";
import { FieldError, TextArea } from "../internal/form/index.js";
import { List, ListRow } from "../internal/surface/List.js";
import { ConfirmDialog } from "../resource-detail/ConfirmDialog.js";
import { Section } from "../resource-detail/Section.js";
import { useConfirmAction } from "../resource-detail/useConfirmAction.js";

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
 * organization, grouped pending-proposals-first: proposals
 * awaiting a decision, then confirmed facts, then rejected proposals
 * kept for audit.
 *
 * Every fact is shown VERBATIM — the exact stored text is what future
 * prompts inject, byte for byte, so the review surface never paraphrases.
 * Provenance renders beside each agent-proposed fact.
 * Actions per state: confirm/reject/delete on proposals (reject is
 * one-click — no confirmation dialog), edit/delete on confirmed facts,
 * delete on rejected ones. Delete asks in a confirm dialog that does the
 * delete and says a refusal there; it works in any state. Each group is a
 * card of list rows.
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
  // At most one row is being edited at a time.
  const [editingId, setEditingId] = useState<string | null>(null);
  const { deleteMemory } = useDeleteMemory();
  const { confirmState, confirm, handleConfirm, handleCancel } = useConfirmAction();

  const stopEditing = useCallback(() => setEditingId(null), []);
  const handleChanged = useCallback(() => {
    setEditingId(null);
    refetch();
  }, [refetch]);

  const askToDelete = useCallback(
    async (memory: Memory) => {
      const id = memory.metadata?.id ?? "";
      const content = memory.spec?.content ?? "";
      const deleted = await confirm({
        title: "Delete this memory?",
        description:
          memory.status?.lifecycleState === MemoryLifecycleState.lifecycle_state_confirmed
            ? `\u201c${content}\u201d stops being shared with agents. It can't be brought back.`
            : `\u201c${content}\u201d is deleted. It can't be brought back.`,
        confirmLabel: "Delete",
        variant: "destructive",
        action: async () => {
          await deleteMemory(id);
        },
        failureTitle: "Couldn't delete the memory.",
      });
      if (deleted) handleChanged();
    },
    [confirm, deleteMemory, handleChanged],
  );

  if (isLoading) {
    return <SettingsSkeleton label="Loading memories" rows={3} className={className} />;
  }

  if (error) {
    return <ErrorMessage error={error} title="Couldn't load your memories." retry={refetch} className={className} />;
  }

  if (memories.length === 0) {
    return (
      <EmptyState
        variant="first-use"
        title="Nothing remembered yet"
        description="When an agent proposes a fact worth keeping, it shows here for you to confirm or reject."
        className={className}
      />
    );
  }

  const groups = groupMemoriesByLifecycle(memories);
  const shared = {
    editingId,
    onStartEdit: setEditingId,
    onStopEdit: stopEditing,
    onDelete: askToDelete,
    onChanged: handleChanged,
    now,
  };

  return (
    <div className={cn("stg:space-y-4", className)}>
      {groups.proposed.length > 0 && (
        <MemoryGroup
          heading="Waiting for you"
          description="Nothing is kept until you confirm it."
          memories={groups.proposed}
          {...shared}
        />
      )}
      {groups.confirmed.length > 0 && (
        <MemoryGroup
          heading="Remembered"
          description="Shared with agents in your future sessions."
          memories={groups.confirmed}
          {...shared}
        />
      )}
      {groups.rejected.length > 0 && (
        <MemoryGroup
          heading="Rejected"
          description="Kept so an agent doesn't propose them again. Delete one to clear it."
          memories={groups.rejected}
          {...shared}
        />
      )}
      <ConfirmDialog state={confirmState} onConfirm={handleConfirm} onCancel={handleCancel} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Group + row (internal)
// ---------------------------------------------------------------------------

interface RowActions {
  readonly editingId: string | null;
  readonly onStartEdit: (id: string) => void;
  readonly onStopEdit: () => void;
  readonly onDelete: (memory: Memory) => void;
  readonly onChanged: () => void;
  readonly now?: Date;
}

function MemoryGroup({
  heading,
  description,
  memories,
  editingId,
  ...actions
}: RowActions & {
  heading: string;
  description: string;
  memories: readonly Memory[];
}) {
  return (
    <Section title={heading} count={memories.length}>
      <p className="stg:m-0 stg:border-b stg:border-border-muted stg:px-3.5 stg:py-2 stg:text-xs stg:text-muted-foreground">
        {description}
      </p>
      <List bare aria-label={heading}>
        {memories.map((memory) => {
          const id = memory.metadata?.id ?? "";
          return editingId === id ? (
            <MemoryEditRow key={id} memory={memory} onCancel={actions.onStopEdit} onSaved={actions.onChanged} />
          ) : (
            <MemoryRow key={id} memory={memory} editingId={editingId} {...actions} />
          );
        })}
      </List>
    </Section>
  );
}

function MemoryRow({
  memory,
  now,
  onStartEdit,
  onDelete,
  onChanged,
}: RowActions & { memory: Memory }) {
  const id = memory.metadata?.id ?? "";
  const content = memory.spec?.content ?? "";
  const state = memory.status?.lifecycleState;
  const provenance = formatMemoryProvenance(memory);
  const stateChangedAt = memory.status?.stateChangedAt;

  const { confirmMemory, isConfirming, error: confirmError } = useConfirmMemory();
  const { rejectMemory, isRejecting, error: rejectError } = useRejectMemory();

  const actionError = confirmError ?? rejectError;
  const isBusy = isConfirming || isRejecting;

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

  return (
    <ListRow
      // The exact stored text, verbatim: what is confirmed is what future
      // prompts inject, byte for byte, so it wraps rather than truncates.
      name={<span className="stg:whitespace-pre-wrap stg:font-normal">{content}</span>}
      description={`${provenance ? `${provenance} · ` : ""}${formatStateStamp(state, stateChangedAt ? timestampDate(stateChangedAt) : undefined, now)}`}
      open={actionError != null}
      expanded={actionError ? <FieldError>{getUserMessage(actionError)}</FieldError> : undefined}
      trailing={
        <div className="stg:flex stg:shrink-0 stg:items-center stg:gap-1.5">
          {isProposed(state) && (
            <>
              <Button
                variant="ghost"
                size="xs"
                aria-label={`Reject memory: ${content}`}
                onClick={() => void act(rejectMemory)}
                disabled={isBusy}
                icon={isRejecting ? <SpinnerIcon size={12} /> : undefined}
              >
                Reject
              </Button>
              <Button
                variant="outline"
                size="xs"
                aria-label={`Confirm memory: ${content}`}
                onClick={() => void act(confirmMemory)}
                disabled={isBusy}
                icon={isConfirming ? <SpinnerIcon size={12} /> : undefined}
              >
                Confirm
              </Button>
            </>
          )}
          {state === MemoryLifecycleState.lifecycle_state_confirmed && (
            <IconButton
              label={`Edit memory: ${content}`}
              size="xs"
              icon={<PencilIcon />}
              onClick={() => onStartEdit(id)}
              disabled={isBusy}
            />
          )}
          <IconButton
            label={`Delete memory: ${content}`}
            size="xs"
            icon={<TrashIcon />}
            onClick={() => onDelete(memory)}
            disabled={isBusy}
            className="stg:hover:text-destructive stg:hover:bg-destructive-subtle"
          />
        </div>
      }
    />
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
    <li className="stg:px-3.5 stg:py-2.5">
      <TextArea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={2}
        maxLength={500}
        aria-label="Edit memory text"
        className="stg:w-full stg:resize-y"
      />
      <div className="stg:mt-1.5 stg:flex stg:items-center stg:justify-between">
        <span className="stg:text-2xs stg:text-muted-foreground">
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
        <FieldError className="stg:mt-1">
          {getUserMessage(error)}
        </FieldError>
      )}
    </li>
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
    <Button variant={emphasis === "primary" ? "primary" : "outline"} size="xs" aria-label={label} onClick={onClick} disabled={disabled}>
      {children}
    </Button>
  );
}

function PencilIcon() {
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
      <path d="M11 2.5l2.5 2.5L5 13.5H2.5V11L11 2.5z" />
    </svg>
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
