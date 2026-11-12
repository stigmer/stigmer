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
// Black and white but for status: a finished item's mark is the ready hue,
// the running one's spinner the running hue, a waiting item's words the
// degraded one; everything else is weight and the muted foreground.

import { useId, type ReactNode } from "react";
import { isBackgroundRunning, stepTense, type PlanItem, type ToolUse, type TurnSteps } from "@stigmer/client";
import { cn } from "@stigmer/design-tokens";
import { useAutoDisclosure } from "../internal/useAutoDisclosure.js";
import { SpinnerIcon } from "../internal/thread-card/index.js";
import { ToolCallGroup } from "./ToolCallGroup.js";
import { SettledStepsRow } from "./SettledStepsRow.js";
import { UNSTYLED_LIST } from "../internal/element-resets.js";

/** Props for {@link PlanSteps}. */
export interface PlanStepsProps {
  /** The turn's plan and its loose steps. */
  readonly steps: TurnSteps;
  /** Whether the turn still works: its item in progress runs, and is open. */
  readonly working: boolean;
  readonly className?: string;
}

/** Whether a step may sit in a folded stretch: it returned, runs nothing on, and did not fail. */
function folds(tool: ToolUse): boolean {
  return tool.result !== undefined && !isBackgroundRunning(tool) && stepTense(tool) !== "failed";
}

/** Whether a step waits for a person (its ask is drawn as its own card). */
function waits(tool: ToolUse): boolean {
  return tool.state === "waiting";
}

/** A turn's plan card (module header). */
export function PlanSteps({ steps, working, className }: PlanStepsProps) {
  const counted = steps.plan.filter((item) => item.todo.status !== "cancelled");
  const done = counted.filter((item) => item.todo.status === "completed").length;
  const loose = steps.loose.filter((tool) => !waits(tool));
  // Only a quiet stretch folds: a step still running (a background command
  // runs on past its call) or one that failed stays in view.
  const settledLoose = loose.filter((tool) => folds(tool));
  const openLoose = loose.filter((tool) => !folds(tool));
  return (
    <section
      aria-label="Plan"
      data-cursor-target="plan-steps"
      className={cn("stg:mx-4 stg:overflow-hidden stg:rounded-lg stg:border stg:border-border stg:bg-card", className)}
    >
      <header className="stg:flex stg:items-center stg:justify-between stg:gap-2 stg:border-b stg:border-border-muted stg:px-3 stg:py-2 stg:text-xs stg:font-medium stg:text-muted-foreground">
        <span>Plan</span>
        <span className="stg:tabular-nums">
          {done} of {counted.length} done
        </span>
      </header>
      <ul role="list" className={UNSTYLED_LIST}>
        {steps.plan.map((item) => (
          <PlanItemRow key={item.todo.id} item={item} working={working} />
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
function PlanItemRow({ item, working }: { readonly item: PlanItem; readonly working: boolean }) {
  const regionId = useId();
  const calls = item.calls.filter((tool) => !waits(tool));
  const waiting = item.calls.some(waits);
  const status = item.todo.status;
  const live = status === "in_progress" && working;
  const [open, toggle] = useAutoDisclosure(live && calls.length > 0, { initialOpen: live && calls.length > 0 });
  const mark = <PlanMark status={status} live={live} />;
  const words: ReactNode = (
    <span className="stg:min-w-0 stg:flex-1">
      <span
        className={cn(
          "stg:block stg:truncate",
          status === "completed" && "stg:text-muted-foreground",
          status === "pending" && "stg:text-muted-foreground",
          status === "cancelled" && "stg:text-muted-foreground stg:line-through",
          live && "stg:font-medium stg:text-foreground",
          status === "in_progress" && !working && "stg:text-foreground",
        )}
      >
        {item.todo.content}
      </span>
      {waiting && <span className="stg:block stg:text-xs stg:text-status-degraded">Waiting for you</span>}
      {status === "in_progress" && !working && <span className="stg:block stg:text-xs stg:text-muted-foreground">Not finished</span>}
    </span>
  );
  return (
    <li className="stg:border-b stg:border-border-muted stg:last:border-b-0">
      {calls.length === 0 ? (
        <div className="stg:flex stg:items-start stg:gap-2 stg:px-3 stg:py-2 stg:text-sm">
          {mark}
          {words}
        </div>
      ) : (
        <>
          <button
            type="button"
            aria-expanded={open}
            aria-controls={regionId}
            onClick={toggle}
            className="stg:flex stg:w-full stg:items-start stg:gap-2 stg:px-3 stg:py-2 stg:text-left stg:text-sm stg:hover:bg-muted-subtle stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-inset stg:focus-visible:ring-ring"
          >
            {mark}
            {words}
            <span className="stg:shrink-0 stg:pt-0.5 stg:text-xs stg:tabular-nums stg:text-muted-foreground">
              {calls.length} {calls.length === 1 ? "step" : "steps"}
            </span>
            <svg aria-hidden="true" viewBox="0 0 16 16" className={cn("stg:mt-1 stg:h-3 stg:w-3 stg:shrink-0 stg:text-muted-foreground stg:transition-transform", open && "stg:rotate-90")}>
              <path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          {open && (
            <div id={regionId} className="stg:ml-8 stg:mr-3 stg:mb-2 stg:overflow-hidden stg:rounded-md stg:border stg:border-border-muted stg:bg-card">
              <ToolCallGroup toolUses={calls} framed={false} />
            </div>
          )}
        </>
      )}
    </li>
  );
}

/** An item's mark: a ready tick once done, a spinner while it runs, an empty ring before, a muted ring once its turn left it unfinished. */
function PlanMark({ status, live }: { readonly status: PlanItem["todo"]["status"]; readonly live: boolean }) {
  if (status === "completed") {
    return (
      <span aria-label="Done" role="img" className="stg:mt-0.5 stg:flex stg:h-4 stg:w-4 stg:shrink-0 stg:items-center stg:justify-center stg:rounded-full stg:bg-status-ready stg:text-background">
        <svg viewBox="0 0 12 12" className="stg:h-2.5 stg:w-2.5" aria-hidden="true">
          <path d="M2.5 6.5 5 9l4.5-5.5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    );
  }
  if (live) {
    return (
      <span aria-label="In progress" role="img" className="stg:mt-0.5 stg:flex stg:h-4 stg:w-4 stg:shrink-0 stg:items-center stg:justify-center stg:text-status-running">
        <SpinnerIcon />
      </span>
    );
  }
  return (
    <span
      aria-label={status === "in_progress" ? "Not finished" : status === "cancelled" ? "Dropped" : "To do"}
      role="img"
      className={cn(
        "stg:mt-0.5 stg:h-4 stg:w-4 stg:shrink-0 stg:rounded-full stg:border",
        status === "in_progress" ? "stg:border-muted-foreground" : "stg:border-border",
      )}
    />
  );
}
