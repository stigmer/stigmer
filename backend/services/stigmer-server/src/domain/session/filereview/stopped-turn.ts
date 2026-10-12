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
 * Proven by __tests__/stopped-turn.test.ts.
 */
import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import {
  FileDecisionAction,
  FileReviewEventType,
  RunPhase,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";

import type { Logger } from "../../../boot/logger.js";
import type { CallerIdentity } from "../../../extensions/identity.js";
import { accountAsCaller } from "../../identityaccount/actor.js";
import { accountForStamp } from "../../identityaccount/resolve.js";
import type { AccountsByCaller } from "../../identityaccount/resolve.js";
import type { RunStatusObserver } from "../../../extensions/status-hooks.js";
import { isTerminalExecutionPhase } from "../../run/phases.js";
import { startReconcileTurn } from "./decide.js";
import type { FileDecisionDeps } from "./decide.js";

export interface StoppedTurnObserverDeps
  extends Pick<FileDecisionDeps, "logger" | "reconcileTurns"> {
  readonly logger: Logger;
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

/** The decider of the run's newest undo; undefined when its turn holds none. */
export function newestUndoDecider(run: Run): string | undefined {
  let decider: string | undefined;
  for (const event of run.status?.fileReviewEventStream?.events ?? []) {
    if (
      event.eventType === FileReviewEventType.FILE_DECIDED &&
      event.payload.case === "fileDecided" &&
      event.payload.value.action === FileDecisionAction.REJECT
    ) {
      decider = event.payload.value.reviewerId;
    }
  }
  return decider;
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
    const decider = newestUndoDecider(run);
    if (decider === undefined) {
      return;
    }
    const runId = run.metadata?.id ?? "";
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
