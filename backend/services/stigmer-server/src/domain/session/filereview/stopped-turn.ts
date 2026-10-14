/**
 * A turn that is stopped while it waits puts back its undone files at
 * once.
 *
 * An undo decided on a turn still unfinished is restored by that turn's
 * next start (decide.ts). A turn that waits for an answer or is paused and
 * then ends without running again (stopped by an interrupt or a cancel, or
 * failed by its workflow once its approval cycles or its repairs of an
 * empty gate run out) never starts again, so its undo would otherwise wait
 * for the conversation's next message. This status observer, composed
 * beside the grading observer, sees every way such a turn ends at the one
 * seam all phase writes reach (run/status-observers.ts): a run that leaves
 * WAITING_FOR_APPROVAL or PAUSED for a terminal phase while its change
 * sets carry an undo starts its reconcile turn, as the person who decided
 * the newest undo. A turn that resumed before it was stopped already put
 * the undo back at its start; the reconcile turn then finds nothing owed
 * and simply completes. A refused or failed start is logged, never thrown:
 * the next turn restores what is owed before its agent runs.
 *
 * Who decided is the newest undo's `stigmer.file_review.decided` event in
 * the session's log, its decided_by. An undo decided before the event
 * named its decider names nobody, and nobody is acted as: the observer
 * starts no turn and logs it, never falling back to an older undo's
 * decider, who may be another person, and the next turn restores the
 * files. So does an undo whose decider names nobody this server knows.
 *
 * Proven by __tests__/stopped-turn.test.ts.
 */
import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";

import type { Logger } from "../../../boot/logger.js";
import type { CallerIdentity } from "../../../extensions/identity.js";
import { accountAsCaller } from "../../identityaccount/actor.js";
import { accountForStamp } from "../../identityaccount/resolve.js";
import type { AccountsByCaller } from "../../identityaccount/resolve.js";
import type { RunStatusObserver } from "../../../extensions/status-hooks.js";
import type { Store } from "../../../store/interface.js";
import { FILE_REVIEW_DECIDED_TYPE, loggedDecisionOf } from "../../run/filereview/logged.js";
import { isTerminalExecutionPhase } from "../../run/phases.js";
import { eventOf } from "../events/codec.js";
import { sessionIdOfRun } from "../events/transitions.js";
import { startReconcileTurn } from "./decide.js";
import type { FileDecisionDeps } from "./decide.js";

export interface StoppedTurnObserverDeps
  extends Pick<FileDecisionDeps, "logger" | "reconcileTurns"> {
  readonly logger: Logger;
  /** The session's log, where the run's undos and their deciders are read. */
  readonly store: Store;
  /** The caller an undo's decider stands for; undefined when it names nobody this server knows. */
  readonly callerOf: (deciderId: string) => Promise<CallerIdentity | undefined>;
}

/**
 * Who an undo's decider stands for: under sign-in, the account the decider's
 * id names (undefined when it names none); on a laptop with no sign-in, the
 * one operator every decision there was made by.
 */
export function undoDeciderCaller(
  personAccounts: AccountsByCaller | undefined,
  operator: () => CallerIdentity,
): (deciderId: string) => Promise<CallerIdentity | undefined> {
  return async (deciderId) => {
    if (personAccounts === undefined) {
      return operator();
    }
    const account = await accountForStamp(personAccounts, deciderId);
    return account === undefined ? undefined : accountAsCaller(account);
  };
}

/** One page of the run's decided events, newest first; a turn holds far fewer. */
const DECIDED_PAGE_SIZE = 500;

/**
 * The decider of the run's newest undo, read from the session's log:
 * undefined when the run holds no undo, "" when the newest undo names no
 * decider (module header).
 */
export async function newestUndoDecider(store: Store, run: Run): Promise<string | undefined> {
  const sessionId = sessionIdOfRun(run);
  if (sessionId === "") {
    return undefined;
  }
  const runId = run.metadata?.id ?? "";
  let afterSeq: number | undefined;
  for (;;) {
    const page = await store.sessionEvents.list(sessionId, {
      order: "desc",
      runId,
      types: [FILE_REVIEW_DECIDED_TYPE],
      limit: DECIDED_PAGE_SIZE,
      ...(afterSeq === undefined ? {} : { afterSeq }),
    });
    for (const record of page) {
      const decision = loggedDecisionOf(eventOf(record));
      if (decision?.action === "undo") {
        return decision.decidedBy;
      }
    }
    if (page.length < DECIDED_PAGE_SIZE) {
      return undefined;
    }
    afterSeq = page[page.length - 1]!.seq;
  }
}

/** The observer (module header). */
export function newStoppedTurnObserver(deps: StoppedTurnObserverDeps): RunStatusObserver {
  return async ({ run, oldPhase, newPhase }) => {
    const stoppedWhileHeld =
      (oldPhase === RunPhase.RUN_WAITING_FOR_APPROVAL || oldPhase === RunPhase.RUN_PAUSED) &&
      isTerminalExecutionPhase(newPhase);
    if (!stoppedWhileHeld) {
      return;
    }
    const runId = run.metadata?.id ?? "";
    let decider: string | undefined;
    try {
      decider = await newestUndoDecider(deps.store, run);
    } catch (error) {
      deps.logger.warn("a stopped turn's undos could not be read; the next turn restores them", {
        executionId: runId,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    if (decider === undefined) {
      return;
    }
    if (decider === "") {
      deps.logger.warn("a stopped turn's newest undo names no decider; the next turn restores it", {
        executionId: runId,
      });
      return;
    }
    const caller = await deps.callerOf(decider);
    if (caller === undefined) {
      deps.logger.warn("a stopped turn's undo names nobody to act as; the next turn restores it", {
        executionId: runId,
      });
      return;
    }
    await startReconcileTurn(deps, run, caller);
  };
}
