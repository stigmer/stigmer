"use client";

import { useCallback, useState } from "react";
import { cn } from "@stigmer/theme";
import { getUserMessage } from "@stigmer/sdk";
import type { Memory } from "@stigmer/protos/ai/stigmer/agentic/memory/v1/api_pb";
import { MemoryLifecycleState } from "@stigmer/protos/ai/stigmer/agentic/memory/v1/enum_pb";
import { SpinnerIcon } from "../internal/SpinnerIcon.js";
import { formatMemoryProvenance } from "./memoryGroups.js";
import { useConfirmMemory } from "./useConfirmMemory.js";
import { useMemory } from "./useMemory.js";
import { useRejectMemory } from "./useRejectMemory.js";

/** Props for {@link MemoryProposalCardBody}. */
export interface MemoryProposalCardBodyProps {
  /** The proposed memory's resource id (from the remember tool's answer). */
  readonly memoryId: string;
  /**
   * The proposed fact as frozen in the tool result — shown VERBATIM
   * (DD-005 D6: what you confirm is what future prompts inject, byte for
   * byte). The live record's text supersedes it once fetched, so an edit
   * made on the memory page is reflected here too.
   */
  readonly fact: string;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * The in-session consent surface for a memory proposal (DD-005 D4): the
 * body of a `remember` tool call's row in the message thread, rendering
 * the proposed fact verbatim with one-click Confirm / Reject actions.
 *
 * Lifecycle honesty across surfaces and reloads: the tool result this
 * renders from is FROZEN at capture time, so the card fetches the
 * record's current state ({@link useMemory}) — a proposal decided from
 * the memory settings page (or another device) shows its decided state
 * here instead of stale action buttons, and a deleted record reads
 * "no longer stored" rather than failing. Rejection is one click, no
 * confirmation dialog (the T04 Cursor lesson: expensive review teaches
 * users to ignore the queue); deletion-with-confirmation lives on the
 * memory page, the catch-up surface.
 *
 * Borderless by design (the {@link ApprovalCardBody} posture): the tool
 * row's card owns the chrome, this component owns only the body. All
 * visual properties flow through `--stgm-*` design tokens.
 */
export function MemoryProposalCardBody({
  memoryId,
  fact,
  className,
}: MemoryProposalCardBodyProps) {
  const { memory, isLoading, notFound, error: fetchError } = useMemory(memoryId);
  const { confirmMemory, isConfirming, error: confirmError } = useConfirmMemory();
  const { rejectMemory, isRejecting, error: rejectError } = useRejectMemory();

  // The card's own decision lands here so the settled state renders
  // immediately — the fetch stays the authority for every OTHER writer
  // (the memory page, another device), read once on mount.
  const [decided, setDecided] = useState<Memory | null>(null);

  const act = useCallback(
    async (action: (id: string) => Promise<Memory>) => {
      try {
        setDecided(await action(memoryId));
      } catch {
        // Error state is surfaced via the hooks.
      }
    },
    [memoryId],
  );

  const record = decided ?? memory;
  const state = record?.status?.lifecycleState;
  // The live record's text supersedes the frozen tool result (the subject
  // may have edited the fact on the memory page before deciding).
  const displayFact = record?.spec?.content || fact;
  const provenance = record ? formatMemoryProvenance(record) : null;
  const actionError = confirmError ?? rejectError;
  const isBusy = isConfirming || isRejecting;

  const showActions =
    !notFound &&
    fetchError == null &&
    (state === undefined ||
      state === MemoryLifecycleState.lifecycle_state_unspecified ||
      state === MemoryLifecycleState.lifecycle_state_proposed);

  return (
    <div className={cn("stg:space-y-2", className)} data-cursor-target="memory-proposal">
      <p className="stg:text-sm stg:text-foreground stg:whitespace-pre-wrap">
        {displayFact}
      </p>

      <p className="stg:text-xs stg:text-muted-foreground">
        {provenance ? `${provenance} · ` : ""}
        Proposed to remember — nothing is stored in your sessions until you
        confirm it.
      </p>

      {notFound ? (
        <p className="stg:text-xs stg:text-muted-foreground" role="status">
          No longer stored.
        </p>
      ) : fetchError ? (
        // The fact stays visible (it is frozen in the tool result); only
        // the actionable state is unavailable. Decide from the memory
        // page instead — the catch-up surface.
        <p className="stg:text-xs stg:text-muted-foreground" role="status">
          Couldn&apos;t load this proposal&apos;s current state — review it in
          Settings → Memory.
        </p>
      ) : showActions ? (
        <div className="stg:flex stg:items-center stg:gap-1.5">
          <ChipButton
            label={`Confirm memory: ${displayFact}`}
            onClick={() => void act(confirmMemory)}
            disabled={isBusy || isLoading}
            emphasis="primary"
          >
            {isConfirming && <SpinnerIcon size={12} />}
            Confirm
          </ChipButton>
          <ChipButton
            label={`Reject memory: ${displayFact}`}
            onClick={() => void act(rejectMemory)}
            disabled={isBusy || isLoading}
          >
            {isRejecting && <SpinnerIcon size={12} />}
            Reject
          </ChipButton>
        </div>
      ) : (
        <p className="stg:text-xs stg:text-muted-foreground" role="status">
          {state === MemoryLifecycleState.lifecycle_state_confirmed
            ? "Confirmed — recalled in your future sessions."
            : "Rejected — not stored."}
        </p>
      )}

      {actionError && (
        <p className="stg:text-[0.65rem] stg:text-destructive" role="alert">
          {getUserMessage(actionError)}
        </p>
      )}
    </div>
  );
}

function ChipButton({
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
        "stg:inline-flex stg:items-center stg:gap-1 stg:rounded-md stg:px-2.5 stg:py-1 stg:text-xs stg:font-medium",
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
