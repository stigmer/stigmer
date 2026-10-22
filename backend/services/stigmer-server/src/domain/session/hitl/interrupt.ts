/**
 * SessionCommandController.interrupt: a person stops the session's
 * unfinished work. The chain:
 *
 *   Authorize ....... can_edit on the session, once for every run it stops
 *   ValidateProto
 *   RefuseThread .... a session_thread_id is INVALID_ARGUMENT: a sub-agent
 *                     cannot be stopped alone
 *   RequireEngine ... FAILED_PRECONDITION when the execution engine is not
 *                     connected, as every lifecycle verb refuses, before
 *                     anything is written
 *   AppendInterrupt . the user.interrupt, a session-level event (no run),
 *                     guarded by the session row
 *   DropQueue ....... the messages still waiting in the session's queue
 *                     are dropped (events/queue.ts): they stay listed,
 *                     never accepted, and no turn the stop ends starts
 *                     them. Before the runs stop, so a stopped turn's end
 *                     finds nothing to start (run/queued-turn.ts)
 *   StopRuns ........ every run of the session that is pending, in
 *                     progress, waiting for an answer or paused (the run
 *                     index's `session` key) goes through the cancel
 *                     steps (run/lifecycle.ts `cancelSteps`), in a chain
 *                     of the interrupt's own, one per run, already
 *                     authorized above: each ends CANCELLED
 *                     with stop cause `user`, its workflow cancelled at its
 *                     wait, and the session goes idle with end_turn. A run
 *                     that finished meanwhile is left as it is.
 *
 * A turn stopped while it waited puts back its undone files at once
 * (../filereview/stopped-turn.ts).
 *
 * Proven by __tests__/interrupt.test.ts, and end to end by the
 * run-approval conformance suite.
 */
import { create, fromBinary } from "@bufbuild/protobuf";
import { ConnectError } from "@connectrpc/connect";

import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import type { Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { SessionSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import { SessionCommandController } from "@stigmer/apis/ai/stigmer/agentic/session/v1/command_pb";
import {
  SessionEventSchema,
  type SessionEvent,
} from "@stigmer/apis/ai/stigmer/agentic/session/v1/event_pb";
import {
  InterruptSessionResponseSchema,
  type InterruptSessionInput,
  type InterruptSessionResponse,
} from "@stigmer/apis/ai/stigmer/agentic/session/v1/io_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Authorizer } from "../../../extensions/authorizer.js";
import type { CallerIdentity } from "../../../extensions/identity.js";
import {
  failedPreconditionError,
  internalError,
  invalidArgumentError,
  notFoundError,
} from "../../../pipeline/errors.js";
import { newPipeline } from "../../../pipeline/pipeline.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import { newAuthorizeStep } from "../../../pipeline/steps/authorize.js";
import { generateId } from "../../../pipeline/steps/defaults.js";
import { newValidateProtoStep } from "../../../pipeline/steps/validation.js";
import { ResourceNotFoundError } from "../../../store/interface.js";
import { CANCELLABLE_PHASES, TEMPORAL_UNAVAILABLE_MESSAGE, cancelSteps } from "../../run/lifecycle.js";
import type { CancelDeps } from "../../run/lifecycle.js";
import { agentExecutionListIndex } from "../../run/list-index.js";
import { SESSION_EVENT_ID_PREFIX } from "../events/catalog.js";
import { draftOf, eventOf } from "../events/codec.js";
import { dropQueuedMessages } from "../events/queue.js";

export interface InterruptDeps extends CancelDeps {
  /** The composed authorization seam: the chain's Authorize step calls it. */
  readonly authorizer: Authorizer;
}

type InterruptDesc = typeof SessionCommandController.method.interrupt.input;

const EVENT_KEY = "interruptEvent";
const STOPPED_KEY = "interruptStoppedRunIds";
const ORG_KEY = "interruptSessionOrg";

export async function interrupt(
  deps: InterruptDeps,
  input: InterruptSessionInput,
  identity: CallerIdentity,
): Promise<InterruptSessionResponse> {
  const reqCtx = new RequestContext(
    SessionCommandController.method.interrupt.input,
    input,
    identity,
    ApiResourceKind.session,
  );
  await newPipeline<InterruptDesc>("session-interrupt", deps.logger)
    .addStep(newAuthorizeStep(SessionCommandController.method.interrupt, deps.authorizer))
    .addStep(newValidateProtoStep())
    .addStep({
      name: "RefuseThread",
      execute(ctx) {
        if (ctx.input.sessionThreadId !== "") {
          throw invalidArgumentError("interrupting one thread is not supported; interrupt the session");
        }
      },
    })
    .addStep({
      name: "RequireEngine",
      execute() {
        if (!deps.engineState().connected) {
          throw failedPreconditionError(TEMPORAL_UNAVAILABLE_MESSAGE);
        }
      },
    })
    .addStep({
      name: "AppendInterrupt",
      async execute(ctx) {
        const sessionId = ctx.input.sessionId;
        let org: string;
        try {
          const session = await deps.store.getResource(ApiResourceKind.session, sessionId, SessionSchema);
          org = session.metadata?.org ?? "";
        } catch (error) {
          if (error instanceof ResourceNotFoundError) {
            throw notFoundError("Session", sessionId);
          }
          throw internalError(error, "failed to load session");
        }
        const event = create(SessionEventSchema, {
          event: { case: "userInterrupt", value: { id: generateId(SESSION_EVENT_ID_PREFIX) } },
        });
        let stored: SessionEvent;
        try {
          const appended = await deps.store.sessionEvents.append(sessionId, org, [draftOf(event)], {
            kind: ApiResourceKind.session,
            id: sessionId,
            schema: SessionSchema,
            admit: () => undefined,
          });
          stored = eventOf(appended.records[0]!);
          deps.sessionEventBroker.publish(sessionId, appended.appended.map(eventOf));
        } catch (error) {
          if (error instanceof ResourceNotFoundError) {
            throw notFoundError("Session", sessionId);
          }
          throw internalError(error, "failed to record the interrupt");
        }
        ctx.set(EVENT_KEY, stored);
        ctx.set(ORG_KEY, org);
      },
    })
    .addStep({
      name: "DropQueue",
      async execute(ctx) {
        try {
          const dropped = await dropQueuedMessages(deps, ctx.input.sessionId, ctx.get(ORG_KEY) as string);
          if (dropped.length > 0) {
            deps.logger.info("the interrupt dropped the session's queued messages", {
              sessionId: ctx.input.sessionId,
              dropped: dropped.length,
            });
          }
        } catch (error) {
          throw internalError(error, "failed to drop the session's queued messages");
        }
      },
    })
    .addStep({
      name: "StopRuns",
      async execute(ctx) {
        ctx.set(STOPPED_KEY, await stopUnfinishedRuns(deps, ctx.input, ctx.callerIdentity));
      },
    })
    .build()
    .execute(reqCtx);

  return create(InterruptSessionResponseSchema, {
    event: reqCtx.get(EVENT_KEY) as SessionEvent,
    stoppedRunIds: reqCtx.get(STOPPED_KEY) as string[],
  });
}

/** Whether the run is gone or finished now. */
async function finishedSince(deps: InterruptDeps, runId: string): Promise<boolean> {
  try {
    const run = await deps.store.getResource(ApiResourceKind.run, runId, RunSchema);
    return !CANCELLABLE_PHASES.includes(run.status?.phase ?? RunPhase.RUN_PHASE_UNSPECIFIED);
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      return true;
    }
    throw error;
  }
}

/** Cancels every unfinished run of the session; returns the ids it stopped. */
async function stopUnfinishedRuns(
  deps: InterruptDeps,
  input: InterruptSessionInput,
  identity: CallerIdentity,
): Promise<string[]> {
  const sessionId = input.sessionId;
  let rows;
  try {
    rows = await deps.store.queryResources(agentExecutionListIndex, {
      anyKey: [{ name: "session", value: sessionId }],
    });
  } catch (error) {
    throw internalError(error, "failed to list the session's runs");
  }
  const unfinished: Run[] = [];
  for (const row of rows) {
    const run = fromBinary(RunSchema, row.data);
    if (CANCELLABLE_PHASES.includes(run.status?.phase ?? RunPhase.RUN_PHASE_UNSPECIFIED)) {
      unfinished.push(run);
    }
  }
  const stopped: string[] = [];
  for (const run of unfinished) {
    const runId = run.metadata?.id ?? "";
    // The interrupt's own chain per run: its input is the interrupt's, and
    // the run it stops is named to the steps directly.
    const cancelCtx = new RequestContext(
      SessionCommandController.method.interrupt.input,
      input,
      identity,
      ApiResourceKind.run,
    );
    const builder = newPipeline<InterruptDesc>("agentexecution-cancel", deps.logger);
    for (const step of cancelSteps<InterruptDesc>(deps, () => runId)) {
      builder.addStep(step);
    }
    try {
      await builder.build().execute(cancelCtx);
    } catch (error) {
      // A run that finished (or was removed) since the list is not stopped;
      // any other refusal (the engine gone since the check) is the
      // interrupt's failure, never a turn reported stopped that still runs.
      if (error instanceof ConnectError && (await finishedSince(deps, runId))) {
        deps.logger.info("a run finished before the interrupt reached it", { runId, sessionId });
        continue;
      }
      throw error;
    }
    stopped.push(runId);
  }
  deps.logger.info("AUDIT: session interrupted", {
    sessionId,
    stoppedRuns: stopped,
    interruptedBy: identity.identityId,
  });
  return stopped;
}
