"use client";

import { useState } from "react";
import { cn } from "@stigmer/design-tokens";
import type { Routine } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/api_pb";
import { useCheckPermission } from "../grant/useCheckPermission.js";
import { deriveRoutineState } from "./routineState.js";
import { RunRoutineDialog } from "./RunRoutineDialog.js";
import { useResumeRoutine } from "./useResumeRoutine.js";
import { useFireRoutine } from "./useFireRoutine.js";

/** Props for {@link RoutineRowActions}. */
export interface RoutineRowActionsProps {
  /** The routine this row represents. */
  readonly routine: Routine;
  /** Called after a successful action so the list can refetch. */
  readonly onChanged?: () => void;
}

/**
 * Compact per-row actions for a routine list: **Run now** on an active
 * routine (through {@link RunRoutineDialog}, with an optional note — it
 * starts a real, billable run) and **Resume** on a platform-paused one.
 * Exactly one action renders at a time — the one that is currently
 * meaningful; an owner-disabled routine renders neither (its remedy lives
 * on the detail page).
 *
 * Run now shows only to those who may fire the routine (`can_fire`), as on
 * the detail page: one cached check per active row, nothing rendered while
 * it is in flight, and the hook's fail-open answer after that.
 *
 * Shared by every console's routine workbench via `renderItemAction`
 * so row behavior never diverges between apps.
 */
export function RoutineRowActions({
  routine,
  onChanged,
}: RoutineRowActionsProps) {
  const { resumeRoutine, isResuming } = useResumeRoutine();
  const { fireRoutine, isFiring } = useFireRoutine();
  const [runOpen, setRunOpen] = useState(false);

  const info = deriveRoutineState(routine.spec, routine.status);
  const routineId = routine.metadata?.id ?? "";
  const name = routine.metadata?.name || routine.metadata?.slug || "routine";

  const fireCheck = useCheckPermission(
    info.state === "active" && routineId ? { kind: "routine", id: routineId } : null,
    "can_fire",
  );
  const canFire = !fireCheck.isLoading && fireCheck.allowed;

  const handleStart = async (text: string | undefined) => {
    await fireRoutine(routineId, text);
    onChanged?.();
  };

  const handleResume = async () => {
    await resumeRoutine(routineId);
    onChanged?.();
  };

  if (info.state === "disabled") return null;

  return (
    // Row actions must never bubble into the row's navigate-to-detail
    // click handler. The span is a non-interactive event fence — the
    // real interactive element (with keyboard support) is the button.
    <span onClick={(e) => e.stopPropagation()}>
      {info.state === "active" ? (
        canFire && (
          <RowActionButton
            label={`Run ${name} now`}
            busy={isFiring}
            onClick={() => setRunOpen(true)}
          >
            Run now
          </RowActionButton>
        )
      ) : (
        <RowActionButton
          label={`Resume ${name}`}
          busy={isResuming}
          onClick={() => void handleResume()}
        >
          Resume
        </RowActionButton>
      )}

      {runOpen && (
        <RunRoutineDialog
          open={runOpen}
          onOpenChange={setRunOpen}
          routineName={name}
          onStart={handleStart}
        />
      )}
    </span>
  );
}

function RowActionButton({
  label,
  busy,
  onClick,
  children,
}: {
  readonly label: string;
  readonly busy: boolean;
  readonly onClick: () => void;
  readonly children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={busy}
      className={cn(
        "stg:rounded-md stg:border stg:border-input stg:bg-background stg:px-2 stg:py-1 stg:text-xs stg:font-medium stg:text-foreground",
        "stg:hover:bg-accent stg:hover:text-accent-foreground",
        "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
        "stg:disabled:pointer-events-none stg:disabled:opacity-50",
      )}
    >
      {children}
    </button>
  );
}
