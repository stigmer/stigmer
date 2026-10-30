"use client";

// A finished conversation opens on its summary: what was asked, who or what
// started it, how it ended, how long it took, what came out, and (for the
// audiences that review runs) its estimated cost. While a turn works it
// keeps only its first line.
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
import type { ReactNode } from "react";
import type { Turn } from "@stigmer/client";
import { cn } from "@stigmer/design-tokens";
import { useStigmer } from "../hooks.js";
import { useFetch } from "../internal/useFetch.js";
import { durationWords } from "./duration-words.js";
import { turnOutcome } from "./turn-outcome.js";
import { isChannelOriginSession } from "./channelOrigin.js";

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
  readonly className?: string;
}

function useRoutine(id: string): Routine | null | undefined {
  const stigmer = useStigmer();
  const { data, error } = useFetch<Routine | undefined>(id === "" ? null : () => stigmer.routine.get(id), [id, stigmer], undefined);
  if (id === "") return undefined;
  return error ? null : data;
}

/** The session's summary header (module header). */
export function SessionSummary({ session, turns, runs, files, showCost, routineHref, readsRoutine = true, actions, className }: SessionSummaryProps) {
  const routineId = session.status?.routineId ?? "";
  const routine = useRoutine(readsRoutine ? routineId : "");
  const last = turns.at(-1);
  const working = last !== undefined && !last.ended;
  const outcomes = turns.map((turn) => turnOutcome(turn, files, runs.find((run) => run.metadata?.id === turn.runId)));
  const elapsedMs = outcomes.reduce((sum, outcome) => sum + outcome.elapsedMs, 0);
  const made = outcomes.reduce((sum, outcome) => sum + outcome.files.length, 0);
  const changed = new Set(outcomes.flatMap((outcome) => outcome.changes.map((change) => change.path))).size;
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

  const facts = [
    working ? "Working" : last?.status?.phase === "completed" ? "Finished" : last?.status?.phase === "failed" ? "Failed" : "Ended",
    durationWords(elapsedMs),
    made > 0 ? `${made} ${made === 1 ? "file" : "files"} made` : undefined,
    changed > 0 ? `${changed} ${changed === 1 ? "change" : "changes"}` : undefined,
    showCost && cost > 0 ? (cost < 0.005 ? "under $0.01, estimated" : `about $${cost.toFixed(2)}, estimated`) : undefined,
  ].filter((fact): fact is string => fact !== undefined);

  return (
    <header className={cn("stg:space-y-1 stg:border-b stg:border-border stg:px-4 stg:pb-3 stg:pt-4", className)}>
      <div className="stg:flex stg:items-center stg:gap-2">
        <h1 className="stg:min-w-0 stg:flex-1 stg:truncate stg:text-base stg:font-semibold">{asked}</h1>
        {actions != null && <div className="stg:-my-1 stg:flex stg:shrink-0 stg:items-center stg:gap-2">{actions}</div>}
      </div>
      {!working && (
        <p className="stg:text-xs stg:text-muted-foreground">
          {origin}
          {origin !== undefined && " · "}
          {facts.join(" · ")}
        </p>
      )}
    </header>
  );
}
