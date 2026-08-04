"use client";

import { cn } from "@stigmer/theme";
import type { Schedule } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";
import { ConfirmDialog } from "../resource-detail/ConfirmDialog.js";
import { useConfirmAction } from "../resource-detail/useConfirmAction.js";
import { deriveScheduleState } from "./scheduleState.js";
import { useResumeSchedule } from "./useResumeSchedule.js";
import { useTriggerSchedule } from "./useTriggerSchedule.js";

/** Props for {@link ScheduleRowActions}. */
export interface ScheduleRowActionsProps {
  /** The schedule this row represents. */
  readonly schedule: Schedule;
  /** Called after a successful action so the list can refetch. */
  readonly onChanged?: () => void;
}

/**
 * Compact per-row actions for a schedule list: **Run now** on an active
 * schedule (confirmation-gated — it starts a real, billable execution)
 * and **Resume** on a platform-paused one. Exactly one action renders
 * at a time — the one that is currently meaningful; an owner-disabled
 * schedule renders neither (its remedy lives on the detail page).
 *
 * Shared by every console's schedule workbench via `renderItemAction`
 * so row behavior never diverges between apps (DD-016).
 */
export function ScheduleRowActions({
  schedule,
  onChanged,
}: ScheduleRowActionsProps) {
  const { resumeSchedule, isResuming } = useResumeSchedule();
  const { triggerSchedule, isTriggering } = useTriggerSchedule();
  const { confirmState, confirm, handleConfirm, handleCancel } =
    useConfirmAction();

  const info = deriveScheduleState(schedule.spec, schedule.status);
  const scheduleId = schedule.metadata?.id ?? "";
  const name = schedule.metadata?.name || schedule.metadata?.slug || "schedule";

  const handleTrigger = async () => {
    const confirmed = await confirm({
      title: "Run this schedule now?",
      description:
        `"${name}" starts a real agent execution immediately, outside ` +
        "the cron cadence.",
      confirmLabel: "Start run",
      variant: "default",
    });
    if (!confirmed) return;
    await triggerSchedule(scheduleId);
    onChanged?.();
  };

  const handleResume = async () => {
    await resumeSchedule(scheduleId);
    onChanged?.();
  };

  if (info.state === "disabled") return null;

  return (
    // Row actions must never bubble into the row's navigate-to-detail
    // click handler. The span is a non-interactive event fence — the
    // real interactive element (with keyboard support) is the button.
    <span onClick={(e) => e.stopPropagation()}>
      {info.state === "active" ? (
        <RowActionButton
          label={`Run ${name} now`}
          busy={isTriggering}
          onClick={() => void handleTrigger()}
        >
          Run now
        </RowActionButton>
      ) : (
        <RowActionButton
          label={`Resume ${name}`}
          busy={isResuming}
          onClick={() => void handleResume()}
        >
          Resume
        </RowActionButton>
      )}

      {confirmState && (
        <ConfirmDialog
          state={confirmState}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
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
        "rounded-md border border-input bg-background px-2 py-1 text-xs font-medium text-foreground",
        "hover:bg-accent hover:text-accent-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "disabled:pointer-events-none disabled:opacity-50",
      )}
    >
      {children}
    </button>
  );
}
