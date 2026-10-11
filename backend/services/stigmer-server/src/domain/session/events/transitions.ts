/**
 * What the server writes into a session's log when one of its runs is
 * created, changes phase, or is removed: the turn's user message, and the
 * session's status.
 *
 * A status event says what the whole session is doing, never one run. A
 * session can have more than one turn unfinished at once (a channel user
 * who sends two messages quickly has two runs, the second queued behind
 * the first's workspace lock), and Managed Agents has one status per
 * session: running while any of its work is unfinished.
 *
 * So each write compares two facts the store reads under the session's
 * lock (store/session-events.ts): whether the session works after this
 * write (this run is working, or `othersWorking` > 0), and what the
 * session's newest status event says (`state`). A status event is written
 * exactly when they differ, so the newest status event always equals the
 * session's state. Comparing states rather than reacting to one run's
 * transition also repairs a log that drifted: runs that were working when
 * the log was introduced, or a phase an older binary wrote during a roll,
 * are put right by the next write in their session.
 *
 * A run is working while pending, in progress or waiting for approval
 * (run/phases.ts `isWorkingPhase`). Waiting for approval writes nothing of
 * its own yet: the requires_action idle names the tool uses that wait, and
 * those events come from the runner.
 *
 *   created .................. user.message; then running if the session
 *                              did not read running
 *   the session stops working  session.status_idle (end_turn), or, when
 *                              this run just FAILED, retries_exhausted
 *   this run just FAILED ..... session.error (unknown_error, terminal)
 *                              first, whether or not others still work
 *   the session works again .. session.status_running (resume, recover)
 *   removed while working .... as stopping (end_turn)
 *
 * PAUSED and TERMINATED end the turn as end_turn: a Stigmer client reads
 * the pause and the precise cause from the run. session.status_terminated
 * is never written: in Managed Agents it is a session that can no longer
 * be used, and a Stigmer conversation always takes another message.
 *
 * Proven by __tests__/transitions.test.ts.
 */
import { create } from "@bufbuild/protobuf";
import type { MessageInitShape } from "@bufbuild/protobuf";

import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import {
  SessionEventSchema,
  type SessionEvent,
} from "@stigmer/protos/ai/stigmer/agentic/session/v1/event_pb";

import { generateId } from "../../../pipeline/steps/defaults.js";
import { isWorkingPhase } from "../../run/phases.js";
import { SESSION_EVENT_ID_PREFIX } from "./catalog.js";

/** What happened to the run. */
export type RunTransition =
  | { readonly kind: "create"; readonly run: Run }
  | { readonly kind: "update"; readonly previousPhase: RunPhase; readonly run: Run }
  | { readonly kind: "remove"; readonly previousPhase: RunPhase; readonly runId: string };

/** The run's session id; "" for a run in none. */
export function sessionIdOfRun(run: Run): string {
  return run.spec?.target.case === "sessionId" ? run.spec.target.value : "";
}

/** The session's state as its newest status event states it; a session with none reads idle. */
export type SessionStateNow = "running" | "idle";

/**
 * The events a run transition appends, in order, given the session as
 * committed: how many of its other runs work, and its stated state.
 */
export function sessionEventsForTransition(
  transition: RunTransition,
  session: { readonly othersWorking: number; readonly state: SessionStateNow },
): SessionEvent[] {
  const runId =
    transition.kind === "remove" ? transition.runId : (transition.run.metadata?.id ?? "");
  const event = (value: MessageInitShape<typeof SessionEventSchema>["event"]): SessionEvent =>
    create(SessionEventSchema, { runId, event: value });
  const id = (): string => generateId(SESSION_EVENT_ID_PREFIX);

  const events: SessionEvent[] = [];
  if (transition.kind === "create") {
    events.push(
      event({
        case: "userMessage",
        value: { id: id(), content: [{ type: "text", text: transition.run.spec?.message ?? "" }] },
      }),
    );
  }

  const wasWorking = transition.kind !== "create" && isWorkingPhase(transition.previousPhase);
  const nextPhase =
    transition.kind === "remove"
      ? RunPhase.RUN_PHASE_UNSPECIFIED
      : (transition.run.status?.phase ?? RunPhase.RUN_PHASE_UNSPECIFIED);
  const isWorking = transition.kind !== "remove" && isWorkingPhase(nextPhase);
  const failed = wasWorking && nextPhase === RunPhase.RUN_FAILED;
  if (failed && transition.kind !== "remove") {
    events.push(
      event({
        case: "sessionError",
        value: {
          id: id(),
          error: {
            type: "unknown_error",
            message: transition.run.status?.error ?? "",
            retryStatus: { type: "terminal" },
          },
        },
      }),
    );
  }

  const sessionWorks = isWorking || session.othersWorking > 0;
  if (sessionWorks && session.state !== "running") {
    events.push(event({ case: "sessionStatusRunning", value: { id: id() } }));
  } else if (!sessionWorks && session.state === "running") {
    events.push(
      event({
        case: "sessionStatusIdle",
        value: { id: id(), stopReason: { type: failed ? "retries_exhausted" : "end_turn" } },
      }),
    );
  }
  return events;
}
