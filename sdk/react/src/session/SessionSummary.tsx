"use client";

// A conversation opens on its summary: what was asked, and how it stands
// in a status pill (Working · 1m 30s, Waiting for you, Done, Didn't
// finish, Stopped) from `sessionStatus`. While a turn works, the pill's time
// ticks and beside it reads how far the turn has got (the agent's to-do
// list, else the steps it took). Once it ended: who or what started it, how
// long it took, what came out (the Files made, then the plans a Plan-mode
// turn wrote, which are not counted as files), and (for the audiences that
// review runs) its estimated cost.
//
// The routine that started a session is read by the session's routine id;
// a reader the server refuses it to sees "Started by a routine" and no link,
// and a chat link's guest is never sent the read (its credential is refused
// it). A Slack or WhatsApp conversation says it came from a channel.
// The cost is the runner's display-only estimate summed over the turns, said
// as an estimate because it is not a bill; one that rounds to nothing reads
// "under $0.01", never "$0.00".

import type { File as StigmerFile } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import type { Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import type { Routine } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/api_pb";
import type { Session } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import { useEffect, useState, type ReactNode } from "react";
import { describeTurnActivity, formatElapsed, type Turn } from "@stigmer/client";
import { cn } from "@stigmer/design-tokens";
import { useStigmer } from "@stigmer/react-core";
import { useFetch } from "@stigmer/react-core/internal";
import { standingChanges, turnOutcome } from "./turn-outcome.js";
import { isChannelOriginSession } from "./channelOrigin.js";
import { sessionStatus } from "./session-status.js";
import { StatusBadge } from "../status/StatusBadge.js";

/** Props for {@link SessionSummary}. */
export interface SessionSummaryProps {
  readonly session: Session;
  readonly turns: readonly Turn[];
  readonly runs: readonly Run[];
  readonly files: readonly StigmerFile[];
  /** Whether the estimated cost is shown (the audiences that review runs). */
  readonly showCost: boolean;
  /** A routine's page, from the host; no link when omitted. */
  readonly routineHref?: (routine: Routine) => string;
  /** Whether the reader may be sent the routine read; false for a guest. */
  readonly readsRoutine?: boolean;
  /** Controls drawn at the end of the title's row (the session view's header actions). */
  readonly actions?: ReactNode;
  /**
   * Whether this reader answers what the turn waits on; false for an
   * observer or a participant, who read that it waits for an answer.
   * Defaults to true.
   */
  readonly decides?: boolean;
  readonly className?: string;
}

/** The clock, ticking each second while `running`. */
function useNow(running: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);
  return now;
}

function useRoutine(id: string): Routine | null | undefined {
  const stigmer = useStigmer();
  const { data, error } = useFetch<Routine | undefined>(id === "" ? null : () => stigmer.routine.get(id), [id, stigmer], undefined);
  if (id === "") return undefined;
  return error ? null : data;
}

/** The session's summary header (module header). */
export function SessionSummary({ session, turns, runs, files, showCost, routineHref, readsRoutine = true, actions, decides = true, className }: SessionSummaryProps) {
  const routineId = session.status?.routineId ?? "";
  const routine = useRoutine(readsRoutine ? routineId : "");
  const last = turns.at(-1);
  const working = last !== undefined && !last.ended;
  const status = sessionStatus(last, decides);
  const now = useNow(working);
  const progress = working && last !== undefined ? describeTurnActivity(last, now) : undefined;
  // An ended turn that kept a to-do list says how far it got, as a working one does.
  const endedTodos = !working && last !== undefined ? describeTurnActivity(last, now).todos : undefined;
  const outcomes = turns.map((turn) => turnOutcome(turn, files, runs.find((run) => run.metadata?.id === turn.runId)));
  const elapsedMs = outcomes.reduce((sum, outcome) => sum + outcome.elapsedMs, 0);
  const made = outcomes.reduce((sum, outcome) => sum + outcome.files.length, 0);
  const plans = outcomes.reduce((sum, outcome) => sum + outcome.plans.length, 0);
  // An undone file was put back, so the count is what still stands.
  const changed = new Set(outcomes.flatMap((outcome) => standingChanges(outcome).map((change) => change.path))).size;
  const cost = outcomes.reduce((sum, outcome) => sum + (outcome.estimatedCostUsd ?? 0), 0);
  const asked = session.spec?.subject || turns[0]?.userMessage?.text || "";

  const origin =
    routineId === "" ? (isChannelOriginSession(session) ? "From a channel conversation" : undefined) : routine ? (
      <>
        Started by routine{" "}
        {routineHref ? (
          <a className="stg:font-medium stg:text-foreground stg:underline" href={routineHref(routine)}>
            {routine.metadata?.name}
          </a>
        ) : (
          <span className="stg:font-medium stg:text-foreground">{routine.metadata?.name}</span>
        )}
      </>
    ) : (
      "Started by a routine"
    );

  // How far a working turn has got: its to-do list's count, else the steps
  // it settled once it has, never "0 steps".
  const howFar =
    progress === undefined
      ? undefined
      : progress.todos !== undefined
        ? `${progress.todos.done} of ${progress.todos.total} to-dos done`
        : progress.stepsSettled > 0
          ? `${progress.stepsSettled} ${progress.stepsSettled === 1 ? "step" : "steps"}`
          : undefined;
  const facts = [
    formatElapsed(elapsedMs),
    endedTodos !== undefined ? `${endedTodos.done} of ${endedTodos.total} to-dos done` : undefined,
    made > 0 ? `${made} ${made === 1 ? "file" : "files"} made` : undefined,
    plans > 0 ? `${plans} ${plans === 1 ? "plan" : "plans"}` : undefined,
    changed > 0 ? `${changed} ${changed === 1 ? "change" : "changes"}` : undefined,
    showCost && cost > 0 ? (cost < 0.005 ? "under $0.01, estimated" : `about $${cost.toFixed(2)}, estimated`) : undefined,
  ].filter((fact): fact is string => fact !== undefined);

  return (
    <header className={cn("stg:space-y-1 stg:border-b stg:border-border stg:pb-3 stg:pt-4", className)}>
      <div className="stg:flex stg:items-center stg:gap-2">
        <h1 className="stg:min-w-0 stg:flex-1 stg:truncate stg:text-lg stg:font-semibold">{asked}</h1>
        {actions != null && <div className="stg:-my-1 stg:flex stg:shrink-0 stg:items-center stg:gap-2">{actions}</div>}
      </div>
      <div className="stg:flex stg:flex-wrap stg:items-center stg:gap-x-2 stg:gap-y-1 stg:text-xs stg:text-muted-foreground">
        {status !== undefined && (
          <StatusBadge
            phase={status.phase}
            label={
              status.timed && progress !== undefined && progress.elapsedMs >= 1000 ? `${status.label} · ${formatElapsed(progress.elapsedMs)}` : status.label
            }
          />
        )}
        {/* The dot and the facts after it wrap together, so a dot never ends
            the pill's line alone. */}
        {working ? (
          howFar !== undefined && (
            <span className="stg:inline-flex stg:min-w-0 stg:gap-x-2">
              {status !== undefined && <Separator />}
              <span>{howFar}</span>
            </span>
          )
        ) : (
          <span className="stg:inline-flex stg:min-w-0 stg:gap-x-2">
            {status !== undefined && <Separator />}
            <span>
              {origin}
              {origin !== undefined && " · "}
              {facts.join(" · ")}
            </span>
          </span>
        )}
      </div>
    </header>
  );
}

/** The dot between the pill and the facts after it, as between the facts themselves; a sibling, so the facts keep their own text. */
function Separator() {
  return <span aria-hidden="true">·</span>;
}
