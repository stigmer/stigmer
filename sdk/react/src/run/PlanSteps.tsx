"use client";

// A turn's steps as the agent's own plan: its to-do list in its words, each
// item opening to the steps the agent took while that item was in progress
// (`turnSteps`, @stigmer/client), and the steps taken outside any item at
// the foot. While the turn works, the item in progress is open to what is
// running right now; a finished item opens on a click to the steps it took.
//
// A step that waits for a person is never drawn here: a closed item would
// bury its decision, so the thread draws its ask as its own card after the
// plan, and the item it belongs to says it waits.
//
// Quiet, as the session page draws it (S33, S46): every item on the step's
// own layout, a finished item's tick in the ready hue and its words muted,
// what is still to do muted, and only the item worked on now at medium
// weight, on the running band with the steps it is taking. An item's steps
// hang in its words' column off a rail, nothing between them. Black and
// white but for status.

import { useId } from "react";
import { isBackgroundRunning, stepTense, type PlanItem, type ToolUse, type TurnEndingTone, type TurnSteps } from "@stigmer/client";
import { cn } from "@stigmer/design-tokens";
import { useAutoDisclosure } from "../internal/useAutoDisclosure.js";
import { DoneTick, FailedGlyph, SpinnerIcon, ThreadCardStep } from "../internal/thread-card/index.js";
import { ToolCallGroup } from "./ToolCallGroup.js";
import { useWaitingWords } from "./ApprovalContext.js";
import { SettledStepsRow } from "./SettledStepsRow.js";
import { UNSTYLED_LIST } from "../internal/element-resets.js";

/** Props for {@link PlanSteps}. */
export interface PlanStepsProps {
  /** The turn's plan and its loose steps. */
  readonly steps: TurnSteps;
  /** Whether the turn still works: its item in progress runs, and is open. */
  readonly working: boolean;
  /**
   * What the item in progress reads once the turn stopped on it, from the
   * turn's ending ("Paused here", "Stalled here").
   *
   * @default "Stopped here"
   */
  readonly stoppedNote?: string;
  /**
   * How the item an ended turn stopped on is marked, from the ending's tone:
   * a red alert where the turn failed, an amber ring where it paused, a grey
   * ring where it was stopped.
   *
   * @default "stopped"
   */
  readonly stoppedTone?: PlanStoppedTone;
  readonly className?: string;
}

/** The tone of the ending a turn stopped its plan on: the turn ending's own tones. */
export type PlanStoppedTone = TurnEndingTone;

/** Whether a step may sit in a folded stretch: it returned, runs nothing on, and did not fail. */
function folds(tool: ToolUse): boolean {
  return tool.result !== undefined && !isBackgroundRunning(tool) && stepTense(tool) !== "failed";
}

/** Whether a step waits for a person (its ask is drawn as its own card). */
function waits(tool: ToolUse): boolean {
  return tool.state === "waiting";
}

/** A turn's plan card (module header). */
export function PlanSteps({ steps, working, stoppedNote = "Stopped here", stoppedTone = "stopped", className }: PlanStepsProps) {
  const counted = steps.plan.filter((item) => item.todo.status !== "cancelled");
  const done = counted.filter((item) => item.todo.status === "completed").length;
  const loose = steps.loose.filter((tool) => !waits(tool));
  // Only a quiet stretch of two or more folds: a step still running (a
  // background command runs on past its call) or one that failed stays in
  // view, and a single step stays its own row.
  const quiet = loose.filter((tool) => folds(tool));
  const settledLoose = quiet.length > 1 ? quiet : [];
  const openLoose = quiet.length > 1 ? loose.filter((tool) => !folds(tool)) : loose;
  return (
    <section
      aria-label="Plan"
      data-cursor-target="plan-steps"
      className={cn("stg:overflow-hidden stg:rounded-lg stg:border stg:border-border stg:bg-card", className)}
    >
      <header className="stg:flex stg:items-center stg:justify-between stg:gap-2 stg:border-b stg:border-border-muted stg:px-3 stg:py-2 stg:text-xs stg:font-medium stg:text-muted-foreground">
        <span>Plan</span>
        <span className="stg:tabular-nums">
          {done} of {counted.length} done
        </span>
      </header>
      <ul role="list" className={UNSTYLED_LIST}>
        {steps.plan.map((item) => (
          <PlanItemRow key={item.todo.id} item={item} working={working} stoppedNote={stoppedNote} stoppedTone={stoppedTone} />
        ))}
      </ul>
      {settledLoose.length > 0 && (
        <SettledStepsRow toolUses={settledLoose} prefix="Steps so far" framed={false}>
          <ToolCallGroup toolUses={settledLoose} framed={false} />
        </SettledStepsRow>
      )}
      {openLoose.length > 0 && <ToolCallGroup toolUses={openLoose} framed={false} className="stg:border-t stg:border-border-muted" />}
    </section>
  );
}

/** One item of the plan: its mark, its words, and the steps it took when opened. */
function PlanItemRow({
  item,
  working,
  stoppedNote,
  stoppedTone,
}: {
  readonly item: PlanItem;
  readonly working: boolean;
  readonly stoppedNote: string;
  readonly stoppedTone: PlanStoppedTone;
}) {
  const regionId = useId();
  const calls = item.calls.filter((tool) => !waits(tool));
  const waiting = item.calls.some(waits);
  const waitingWords = useWaitingWords();
  const status = item.todo.status;
  const live = status === "in_progress" && working;
  const [open, toggle] = useAutoDisclosure(live && calls.length > 0, { initialOpen: live && calls.length > 0 });
  const mark = <PlanMark status={status} live={live} stoppedTone={stoppedTone} />;
  // The item in hand sits on a band of the running hue, the drawing's one
  // tint in the plan, with the steps it is taking: the band token keeps
  // their muted second lines readable on it (theme contract). Not while it
  // waits: its line says whom it waits on.
  const band = live && !waiting;
  const words = (
    <span
      className={cn(
        // Done and still to do read quiet, at the muted tone a person can
        // still read (the fainter token is for marks, never words: theme
        // contract); only the item in hand reads bright.
        status === "completed" && "stg:text-muted-foreground",
        status === "pending" && "stg:text-muted-foreground",
        status === "cancelled" && "stg:text-muted-foreground stg:line-through",
        live && "stg:text-foreground",
        // Where an ended turn stopped: the words at rest, the mark and the
        // note under them saying how it ended.
        status === "in_progress" && !working && "stg:text-foreground",
      )}
    >
      {item.todo.content}
    </span>
  );
  const detail = waiting ? waitingWords : status === "in_progress" && !working ? stoppedNote : null;
  return (
    <li className="stg:border-b stg:border-border-muted stg:last:border-b-0">
      <ThreadCardStep
        gesture={calls.length === 0 ? { kind: "none" } : { kind: "expand", expanded: open, onToggle: toggle, label: item.todo.content }}
        mark={mark}
        title={words}
        titleClassName={live ? "stg:font-medium" : undefined}
        detail={detail}
        band={band}
        bodySpan="rail"
        bodyId={regionId}
        body={
          open && calls.length > 0 ? (
            // The item's steps hang in its words' column off a rail, no box
            // and no hairline of their own.
            <div className="stg:border-l-2 stg:border-border stg:pl-3">
              <ToolCallGroup toolUses={calls} framed={false} divided={false} />
            </div>
          ) : undefined
        }
      />
    </li>
  );
}

/**
 * An item's mark: a ready tick once done, a spinner while it runs, an empty
 * ring before, and on the item an ended turn left unfinished the ending's
 * own mark (a red alert where it failed, an amber ring where it paused, a
 * grey ring where it was stopped).
 */
function PlanMark({ status, live, stoppedTone }: { readonly status: PlanItem["todo"]["status"]; readonly live: boolean; readonly stoppedTone: PlanStoppedTone }) {
  if (status === "completed") return <DoneTick label="Done" />;
  if (live) {
    return (
      <span aria-label="In progress" role="img" className="stg:flex stg:h-4 stg:w-4 stg:shrink-0 stg:items-center stg:justify-center stg:text-status-running">
        <SpinnerIcon size={12} />
      </span>
    );
  }
  if (status === "in_progress" && stoppedTone === "failed") {
    return (
      <span aria-label="Failed here" role="img" className="stg:flex stg:h-4 stg:w-4 stg:shrink-0 stg:items-center stg:justify-center stg:text-status-failed">
        <FailedGlyph />
      </span>
    );
  }
  const paused = stoppedTone === "paused";
  const ring = status !== "in_progress" ? "stg:border-border" : paused ? "stg:border-status-degraded" : "stg:border-muted-foreground";
  return (
    <span
      aria-label={status === "in_progress" ? (paused ? "Paused" : "Stopped") : status === "cancelled" ? "Dropped" : "To do"}
      role="img"
      className={cn("stg:h-4 stg:w-4 stg:shrink-0 stg:rounded-full stg:border", ring)}
    />
  );
}
