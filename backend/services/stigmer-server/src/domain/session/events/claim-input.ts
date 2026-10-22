/**
 * SessionCommandController.claimInput: the runner takes the messages
 * queued in its run's session (queue.ts) for the run to read.
 *
 * The gate is appendEvents' (append.ts): skip-authorization, a runner
 * credential for this run (runnerauth/runner-for-run.ts), every refusal of
 * it the same PERMISSION_DENIED. The run must work (pending or in
 * progress): a turn that waits for an answer or is paused reads nothing
 * new, and a finished one is over.
 *
 * The take is one run write (run-writes.ts `updateRunAppendingEvents`,
 * under the session's lock): every message still queued with the run's own
 * authority (its sender and the person it records, queue.ts) is taken, its
 * queued row and side row removed, and listed again at the head of the log
 * as this run's, accepted now, in the order sent. The run's row is
 * written unchanged, so its phase writes no status event. A runner claims
 * where its engine delivers what it takes, so a message sits in the log
 * where the agent read it. A message sent with another authority waits
 * for a turn of its own (run/queued-turn.ts). Nothing to take answers
 * nothing, and writes nothing.
 *
 * Proven by __tests__/claim-input.test.ts and the session-queue
 * conformance suite.
 */
import { create } from "@bufbuild/protobuf";
import type { HandlerContext } from "@connectrpc/connect";

import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import type { Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import {
  ClaimSessionInputResponseSchema,
  type ClaimSessionInputInput,
  type ClaimSessionInputResponse,
} from "@stigmer/apis/ai/stigmer/agentic/session/v1/io_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ConnectError } from "@connectrpc/connect";

import {
  failedPreconditionError,
  internalError,
  invalidArgumentError,
  permissionDeniedError,
} from "../../../pipeline/errors.js";
import { parseBearerToken } from "../../../pipeline/interceptors/auth.js";
import { isRunnerForRun } from "../../../runnerauth/runner-for-run.js";
import { ResourceNotFoundError } from "../../../store/interface.js";
import { isWorkingPhase } from "../../run/phases.js";
import type { AppendSessionEventsDeps } from "./append.js";
import { NOT_THE_RUNS_RUNNER_MESSAGE } from "./append.js";
import { eventOf } from "./codec.js";
import { authorityOfQueued, authorityOfRun, sameAuthority } from "./queue.js";
import { updateRunAppendingEvents } from "./run-writes.js";
import { sessionIdOfRun, takenMessage } from "./transitions.js";

export async function claimSessionInput(
  deps: AppendSessionEventsDeps,
  input: ClaimSessionInputInput,
  ctx: HandlerContext,
): Promise<ClaimSessionInputResponse> {
  const runId = input.runId;
  if (runId === "") {
    throw invalidArgumentError("run_id is required");
  }
  const token = parseBearerToken(ctx.requestHeader.get("authorization") ?? "");
  if (token === "" || !(await isRunnerForRun(deps, token, runId))) {
    throw permissionDeniedError(NOT_THE_RUNS_RUNNER_MESSAGE);
  }
  const run = await loadRun(deps, runId);
  admitWorking(run);
  const sessionId = sessionIdOfRun(run);
  // The common answer, read without the lock: nothing waits for this run,
  // nothing is written.
  const authority = authorityOfRun(run);
  if (
    sessionId === "" ||
    !(await deps.store.sessionEvents.queued(sessionId)).some((queued) => sameAuthority(authorityOfQueued(queued), authority))
  ) {
    return create(ClaimSessionInputResponseSchema);
  }
  let taken;
  try {
    taken = await updateRunAppendingEvents(
      deps,
      runId,
      (row, session) => {
        admitWorking(row);
        const own = session.queued.filter((queued) => sameAuthority(authorityOfQueued(queued), authorityOfRun(row)));
        return {
          last: own.map((queued) => takenMessage(eventOf(queued.record), runId)),
          takeQueued: own.map((queued) => queued.record.eventId),
        };
      },
      { queued: true },
    );
  } catch (error) {
    if (error instanceof ConnectError) {
      throw error;
    }
    if (error instanceof ResourceNotFoundError) {
      throw permissionDeniedError(NOT_THE_RUNS_RUNNER_MESSAGE);
    }
    throw internalError(error, "failed to take the session's queued messages");
  }
  const events = taken.events.filter((event) => event.event.case === "userMessage" && event.runId === runId);
  if (events.length > 0) {
    deps.logger.info("the run took its session's queued messages", { runId, messages: events.length });
  }
  return create(ClaimSessionInputResponseSchema, { events });
}

async function loadRun(deps: AppendSessionEventsDeps, runId: string): Promise<Run> {
  try {
    return await deps.store.getResource(ApiResourceKind.run, runId, RunSchema);
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      throw permissionDeniedError(NOT_THE_RUNS_RUNNER_MESSAGE);
    }
    throw internalError(error, "failed to load the run");
  }
}

/** Refuses a run that does not work: one waiting, paused or finished reads nothing new. */
function admitWorking(run: Run): void {
  const phase = run.status?.phase ?? RunPhase.RUN_PHASE_UNSPECIFIED;
  if (!isWorkingPhase(phase)) {
    throw failedPreconditionError(`run '${run.metadata?.id ?? ""}' is not working; it takes no queued messages`);
  }
}
