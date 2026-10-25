/**
 * SessionCommandController.stopBackgroundCommand: a person stops one
 * command the agent runs in the background. The chain:
 *
 *   Authorize ........ can_edit on the session, the posture of every
 *                      answer a person gives a conversation
 *   ValidateProto
 *   LoadCommand ...... the run is the text before the first `.` of the
 *                      tool use id (session/events/ids.ts) and must be one
 *                      of the session's runs; the command is the run's
 *                      stigmer.background_command.status events for that
 *                      tool use. A tool use with no `running` status is
 *                      NOT_FOUND.
 *   StopReplay ....... a stop already recorded for the tool use (its
 *                      stigmer.background_command.stop_requested, by its
 *                      derived id) ends the chain with that event.
 *   ValidateStop ..... the run is working (`isWorkingPhase`) and the
 *                      command has no `ended` status.
 *   RecordStop ....... one run write (updateRunAppendingEvents) appending
 *                      the stop request in the command's thread. Under the
 *                      session's lock it reads the run's background events
 *                      again and checks what ValidateStop checked, so a
 *                      stop racing the command's end or the turn's stop is
 *                      refused, and one racing an identical stop is
 *                      answered as the replay.
 *
 * The log is the one source: the runner writes the status events, this
 * chain the request, and the turn's runner reads the request
 * (backend/services/runner/src/harness/background-stops.ts) and stops the
 * command, whose status then ends with stopped_by `person`. No gate slot:
 * no extension point acts on a stop.
 *
 * The request's id is `sevt_bs_` and the first 40 hex digits of the sha256
 * of the tool use id, so the log holds at most one per command.
 *
 * Proven by __tests__/stop-background-command.test.ts, and end to end by
 * the session-events and background-command conformance suites.
 */
import { createHash } from "node:crypto";

import { create, enumToJson } from "@bufbuild/protobuf";

import type { Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase, RunPhaseSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { SessionCommandController } from "@stigmer/apis/ai/stigmer/agentic/session/v1/command_pb";
import { SessionEventSchema, type SessionEvent } from "@stigmer/apis/ai/stigmer/agentic/session/v1/event_pb";
import type { StopBackgroundCommandInput } from "@stigmer/apis/ai/stigmer/agentic/session/v1/io_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Logger } from "../../../boot/logger.js";
import type { Authorizer } from "../../../extensions/authorizer.js";
import type { CallerIdentity } from "../../../extensions/identity.js";
import { failedPreconditionError, internalError, notFoundError } from "../../../pipeline/errors.js";
import { newPipeline } from "../../../pipeline/pipeline.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import { newAuthorizeStep } from "../../../pipeline/steps/authorize.js";
import { newValidateProtoStep } from "../../../pipeline/steps/validation.js";
import { ResourceNotFoundError } from "../../../store/interface.js";
import type { Store } from "../../../store/interface.js";
import type { SessionEventRecord } from "../../../store/session-events.js";
import { isWorkingPhase } from "../../run/phases.js";
import type { SessionEventBroker } from "../events/broker.js";
import { SESSION_EVENT_ID_PREFIX } from "../events/catalog.js";
import { eventOf } from "../events/codec.js";
import { runIdOfToolUse } from "../events/ids.js";
import { updateRunAppendingEvents } from "../events/run-writes.js";
import { sessionIdOfRun } from "../events/transitions.js";

export interface StopBackgroundCommandDeps {
  readonly store: Store;
  readonly logger: Logger;
  /** The request reaches the session's live streams. */
  readonly sessionEventBroker: SessionEventBroker;
  /** The composed authorization seam: the chain's Authorize step calls it. */
  readonly authorizer: Authorizer;
}

type StopBackgroundCommandDesc = typeof SessionCommandController.method.stopBackgroundCommand.input;

/** The runner's report of a background command's life. */
const STATUS_TYPE = "stigmer.background_command.status";
/** A person's stop. */
const STOP_REQUESTED_TYPE = "stigmer.background_command.stop_requested";
/** Every type the chain decides from. */
const BACKGROUND_TYPES: ReadonlyArray<string> = [STATUS_TYPE, STOP_REQUESTED_TYPE];

/** One page of a run's background events; a run starts far fewer commands. */
const BACKGROUND_PAGE_SIZE = 1000;

/** The id prefix of a stigmer.background_command.stop_requested. */
const STOP_REQUEST_ID_PREFIX = `${SESSION_EVENT_ID_PREFIX}_bs_`;

/** The stop request id for the command a tool use started (module header). */
export function backgroundStopRequestEventId(toolUseId: string): string {
  return `${STOP_REQUEST_ID_PREFIX}${createHash("sha256").update(toolUseId).digest("hex").slice(0, 40)}`;
}

/** What the log says of one command. */
interface LoggedCommand {
  /** The thread that started it: the running status's. */
  readonly threadId: string;
  readonly ended: boolean;
  /** The stop already recorded for it. */
  readonly stopRequest: SessionEvent | undefined;
}

/** The command `toolUseId` started, as `records` (the run's background events) state it; undefined when none ran. */
function commandIn(records: ReadonlyArray<SessionEventRecord>, toolUseId: string): LoggedCommand | undefined {
  let running: string | undefined;
  let ended = false;
  let stopRequest: SessionEvent | undefined;
  for (const record of records) {
    const event = eventOf(record);
    if (event.event.case === "stigmerBackgroundCommandStatus" && event.event.value.toolUseId === toolUseId) {
      if (event.event.value.phase === "running") {
        running ??= event.event.value.sessionThreadId;
      } else {
        ended = true;
      }
    } else if (
      event.event.case === "stigmerBackgroundCommandStopRequested" &&
      event.event.value.toolUseId === toolUseId
    ) {
      stopRequest ??= event;
    }
  }
  return running === undefined ? undefined : { threadId: running, ended, stopRequest };
}

/** Every background event of the run, oldest first. */
async function backgroundEventsOf(store: Store, sessionId: string, runId: string): Promise<SessionEventRecord[]> {
  const records: SessionEventRecord[] = [];
  let afterSeq: number | undefined;
  for (;;) {
    const page = await store.sessionEvents.list(sessionId, {
      order: "asc",
      runId,
      types: [...BACKGROUND_TYPES],
      limit: BACKGROUND_PAGE_SIZE,
      ...(afterSeq === undefined ? {} : { afterSeq }),
    });
    records.push(...page);
    if (page.length < BACKGROUND_PAGE_SIZE) {
      return records;
    }
    afterSeq = page[page.length - 1]!.seq;
  }
}

function phaseName(phase: RunPhase): string {
  return enumToJson(RunPhaseSchema, phase) as string;
}

function alreadyEnded(toolUseId: string): Error {
  return failedPreconditionError(`the background command of tool use ${toolUseId} already ended`);
}

function turnNotWorking(phase: RunPhase): Error {
  return failedPreconditionError(`the turn is not working: it is ${phaseName(phase)}`);
}

/** The stop found under the lock: recorded since, or refused. */
class StopSettledError extends Error {
  constructor(
    readonly replay: SessionEvent | undefined,
    readonly refusal: Error | undefined,
  ) {
    super("the command's stop was settled under the lock");
    this.name = "StopSettledError";
  }
}

const RUN_KEY = "stopBackgroundRun";
const COMMAND_KEY = "stopBackgroundCommand";
const RESULT_KEY = "stopBackgroundResult";

export async function stopBackgroundCommand(
  deps: StopBackgroundCommandDeps,
  input: StopBackgroundCommandInput,
  identity: CallerIdentity,
): Promise<SessionEvent> {
  const reqCtx = new RequestContext(
    SessionCommandController.method.stopBackgroundCommand.input,
    input,
    identity,
    ApiResourceKind.session,
  );
  const runIn = (ctx: RequestContext<StopBackgroundCommandDesc>): Run => ctx.get(RUN_KEY) as Run;
  const commandOf = (ctx: RequestContext<StopBackgroundCommandDesc>): LoggedCommand =>
    ctx.get(COMMAND_KEY) as LoggedCommand;
  const settled = (ctx: RequestContext<StopBackgroundCommandDesc>): boolean => ctx.get(RESULT_KEY) !== undefined;

  await newPipeline<StopBackgroundCommandDesc>("session-stop-background-command", deps.logger)
    .addStep(newAuthorizeStep(SessionCommandController.method.stopBackgroundCommand, deps.authorizer))
    .addStep(newValidateProtoStep())
    .addStep({
      name: "LoadCommand",
      async execute(ctx) {
        const { sessionId, toolUseId } = ctx.input;
        const missing = (): Error => notFoundError("background command", toolUseId);
        const runId = runIdOfToolUse(toolUseId);
        if (runId === "") {
          throw missing();
        }
        let run: Run;
        try {
          run = await deps.store.getResource(ApiResourceKind.run, runId, RunSchema);
        } catch (error) {
          if (error instanceof ResourceNotFoundError) {
            throw missing();
          }
          throw internalError(error, "failed to load the background command's run");
        }
        if (sessionIdOfRun(run) !== sessionId) {
          throw missing();
        }
        let command: LoggedCommand | undefined;
        try {
          command = commandIn(await backgroundEventsOf(deps.store, sessionId, runId), toolUseId);
        } catch (error) {
          throw internalError(error, "failed to read the background command");
        }
        if (command === undefined) {
          throw missing();
        }
        ctx.set(RUN_KEY, run);
        ctx.set(COMMAND_KEY, command);
      },
    })
    .addStep({
      name: "StopReplay",
      execute(ctx) {
        const recorded = commandOf(ctx).stopRequest;
        if (recorded !== undefined) {
          ctx.set(RESULT_KEY, recorded);
        }
      },
    })
    .addStep({
      name: "ValidateStop",
      execute(ctx) {
        if (settled(ctx)) {
          return;
        }
        const phase = runIn(ctx).status?.phase ?? RunPhase.RUN_PHASE_UNSPECIFIED;
        if (!isWorkingPhase(phase)) {
          throw turnNotWorking(phase);
        }
        if (commandOf(ctx).ended) {
          throw alreadyEnded(ctx.input.toolUseId);
        }
      },
    })
    .addStep({
      name: "RecordStop",
      async execute(ctx) {
        if (settled(ctx)) {
          return;
        }
        ctx.set(RESULT_KEY, await recordStop(deps, runIn(ctx), ctx.input, commandOf(ctx), ctx.callerIdentity.identityId));
      },
    })
    .build()
    .execute(reqCtx);

  return reqCtx.get(RESULT_KEY) as SessionEvent;
}

/** The locked write (module header, RecordStop); the stored request, or the one recorded first. */
async function recordStop(
  deps: StopBackgroundCommandDeps,
  loaded: Run,
  input: StopBackgroundCommandInput,
  command: LoggedCommand,
  requestedBy: string,
): Promise<SessionEvent> {
  const runId = loaded.metadata?.id ?? "";
  const request = create(SessionEventSchema, {
    runId,
    threadId: command.threadId,
    event: {
      case: "stigmerBackgroundCommandStopRequested",
      value: {
        id: backgroundStopRequestEventId(input.toolUseId),
        toolUseId: input.toolUseId,
        sessionThreadId: command.threadId,
      },
    },
  });
  let written: { readonly run: Run; readonly events: ReadonlyArray<SessionEvent> };
  try {
    written = await updateRunAppendingEvents(
      deps,
      runId,
      (current, session) => {
        // Everything ValidateStop checked, again under the lock: the
        // command's end, the turn's stop or another stop may have landed.
        const now = commandIn(session.runEvents, input.toolUseId);
        if (now?.stopRequest !== undefined) {
          throw new StopSettledError(now.stopRequest, undefined);
        }
        const phase = current.status?.phase ?? RunPhase.RUN_PHASE_UNSPECIFIED;
        if (!isWorkingPhase(phase)) {
          throw new StopSettledError(undefined, turnNotWorking(phase));
        }
        if (now === undefined || now.ended) {
          throw new StopSettledError(undefined, alreadyEnded(input.toolUseId));
        }
        return { last: [request] };
      },
      { runEventTypes: BACKGROUND_TYPES },
    );
  } catch (error) {
    if (error instanceof StopSettledError) {
      if (error.replay !== undefined) {
        return error.replay;
      }
      throw error.refusal ?? error;
    }
    if (error instanceof ResourceNotFoundError) {
      // The run was removed between the load and the locked write.
      throw notFoundError("background command", input.toolUseId);
    }
    throw internalError(error, "failed to record the stop");
  }
  deps.logger.info("AUDIT: background command stop requested", {
    runId,
    org: written.run.metadata?.org ?? "",
    toolUseId: input.toolUseId,
    requestedBy,
  });
  const id = request.event.value?.id ?? "";
  /* v8 ignore next -- @preserve: the write appends the request it was handed, so the stored copy is always among its events */
  return written.events.find((event) => event.event.value?.id === id) ?? request;
}
