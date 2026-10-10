/**
 * SessionCommandController.appendEvents: the runner writes what the agent
 * did into its run's session log, with the live previews of what it is
 * still producing.
 *
 * The gate. The method is skip-authorization because a permission cannot
 * tell a runner from the person it acts for: `can_edit` on the run would
 * let any editor, a share participant included, write the agent's words.
 * The authority is the runner credential presented as a Bearer header,
 * decided as the values fetch decides (domain/vault/values.ts): the
 * composed `authorizeRunEventsAppend` capability owns the decision when
 * present (an edition whose runner credential serves a whole session),
 * else the open-source one, an execution-scoped credential bound to
 * exactly this run. Either way the run must exist and not be finished,
 * checked again under the session's lock as the events are stored. Every
 * refusal of the credential is the same PERMISSION_DENIED.
 *
 * What it accepts. Only what a runner produces (catalog.ts
 * `RUNNER_EVENT_TYPES`): agent.*, session.thread_* and session.error. The
 * session's status and the user's turn have one writer, the server. The
 * session comes from the run, never from the request. Each event carries
 * its own id, unique in the session: a resent id with the same event is
 * accepted again without a second entry, the same id with another event is
 * ALREADY_EXISTS, and the batch is stored whole or not at all. An encoded
 * event and an encoded preview are each at most 256 KiB, the runner's own
 * per-tool-output cap (a larger preview would pass the stream's own
 * message limit as one frame); the request as a whole is bounded by the
 * transport's message limit.
 *
 * Previews are streamed to the session's watchers before the batch's
 * stored events (a stored event replaces its preview), and never stored.
 * The reply names each event by identity only (codec.ts `identityOf`), so
 * a request near the transport's limit never answers past it. Ids starting
 * with the server's prefix (`sevt_`) are refused: they are the server's.
 *
 * Proven by __tests__/append.test.ts and the session-events conformance
 * suite.
 */
import { clone, create, toBinary } from "@bufbuild/protobuf";
import type { HandlerContext } from "@connectrpc/connect";
import { Code, ConnectError } from "@connectrpc/connect";

import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { SessionEventSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/event_pb";
import {
  AppendSessionEventsResponseSchema,
  SessionEventPreviewSchema,
  type AppendSessionEventsInput,
  type AppendSessionEventsResponse,
} from "@stigmer/protos/ai/stigmer/agentic/session/v1/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Logger } from "../../../boot/logger.js";
import {
  failedPreconditionError,
  internalError,
  invalidArgumentError,
  permissionDeniedError,
} from "../../../pipeline/errors.js";
import { parseBearerToken } from "../../../pipeline/interceptors/auth.js";
import type { RunnerCredentialProvider } from "../../../runnerauth/runner-credential-provider.js";
import { TOKEN_TYPE_EXECUTION_SCOPED } from "../../../runnerauth/runnerauth.js";
import { ResourceNotFoundError } from "../../../store/interface.js";
import type { Store } from "../../../store/interface.js";
import { SessionEventConflictError } from "../../../store/session-events.js";
import type { SessionEventAppend } from "../../../store/session-events.js";
import { isTerminalExecutionPhase } from "../../run/phases.js";
import type { SessionEventBroker } from "./broker.js";
import { RUNNER_EVENT_TYPES, SESSION_EVENT_ID_PREFIX, eventTypeOf } from "./catalog.js";
import { draftOf, eventOf, identityOf } from "./codec.js";
import { sessionIdOfRun } from "./transitions.js";

export interface AppendSessionEventsDeps {
  readonly store: Store;
  readonly logger: Logger;
  /** Verifies the runner credential; may compose the whole decision. */
  readonly runnerAuth: RunnerCredentialProvider;
  readonly sessionEventBroker: SessionEventBroker;
}

/** The most bytes one encoded event may hold: the runner's per-tool-output cap. */
export const SESSION_EVENT_MAX_BYTES = 256 * 1024;

/** The one refusal every caller outside the gate gets, whatever the reason. */
export const NOT_THE_RUNS_RUNNER_MESSAGE =
  "only the runner acting for this run may append its events";

export async function appendSessionEvents(
  deps: AppendSessionEventsDeps,
  input: AppendSessionEventsInput,
  ctx: HandlerContext,
): Promise<AppendSessionEventsResponse> {
  const runId = input.runId;
  if (runId === "") {
    throw invalidArgumentError("run_id is required");
  }
  const token = parseBearerToken(ctx.requestHeader.get("authorization") ?? "");
  if (token === "" || !(await mayAppend(deps, token, runId))) {
    throw permissionDeniedError(NOT_THE_RUNS_RUNNER_MESSAGE);
  }

  const run = await loadRun(deps.store, runId);
  admitLive(run);
  const sessionId = sessionIdOfRun(run);
  if (sessionId === "") {
    throw failedPreconditionError(`run '${runId}' is in no session; it has no event log`);
  }

  const drafts = input.events.map((event, index) => {
    if (event.event.case === undefined) {
      throw invalidArgumentError(`events[${index}] holds no event`);
    }
    const type = eventTypeOf(event);
    if (!RUNNER_EVENT_TYPES.has(type)) {
      throw invalidArgumentError(`events[${index}]: a runner may not append ${type} events`);
    }
    if (event.event.value.id === "") {
      throw invalidArgumentError(`events[${index}]: the event's id is required`);
    }
    if (event.event.value.id.startsWith(`${SESSION_EVENT_ID_PREFIX}_`)) {
      throw invalidArgumentError(
        `events[${index}]: ids starting with '${SESSION_EVENT_ID_PREFIX}_' are the server's`,
      );
    }
    const own = clone(SessionEventSchema, event);
    own.runId = runId;
    const draft = draftOf(own);
    if (draft.data.length > SESSION_EVENT_MAX_BYTES) {
      throw invalidArgumentError(
        `events[${index}] is ${draft.data.length} bytes; an event holds at most ${SESSION_EVENT_MAX_BYTES}`,
      );
    }
    return draft;
  });

  input.previews.forEach((preview, index) => {
    const size = toBinary(SessionEventPreviewSchema, preview).length;
    if (size > SESSION_EVENT_MAX_BYTES) {
      throw invalidArgumentError(
        `previews[${index}] is ${size} bytes; a preview holds at most ${SESSION_EVENT_MAX_BYTES}`,
      );
    }
  });

  let stored: SessionEventAppend = { records: [], appended: [] };
  if (drafts.length > 0) {
    try {
      stored = await deps.store.sessionEvents.append(sessionId, run.metadata?.org ?? "", drafts, {
        kind: ApiResourceKind.run,
        id: runId,
        schema: RunSchema,
        admit: (row) => admitLive(row as Run),
      });
    } catch (error) {
      if (error instanceof ConnectError) {
        throw error;
      }
      if (error instanceof SessionEventConflictError) {
        throw new ConnectError(error.message, Code.AlreadyExists);
      }
      if (error instanceof ResourceNotFoundError) {
        throw permissionDeniedError(NOT_THE_RUNS_RUNNER_MESSAGE);
      }
      throw internalError(error, "failed to append session events");
    }
  }

  deps.sessionEventBroker.publishPreviews(sessionId, input.previews);
  deps.sessionEventBroker.publish(sessionId, stored.appended.map(eventOf));
  return create(AppendSessionEventsResponseSchema, { events: stored.records.map(identityOf) });
}

/**
 * The trust decision: the composed capability when present, the
 * open-source one otherwise (an execution-scoped credential bound to this
 * run). A capability that throws is a composition fault, logged and
 * refused.
 */
async function mayAppend(
  deps: AppendSessionEventsDeps,
  token: string,
  runId: string,
): Promise<boolean> {
  const authorize = deps.runnerAuth.authorizeRunEventsAppend?.bind(deps.runnerAuth);
  if (authorize !== undefined) {
    try {
      return await authorize(token, runId);
    } catch (error) {
      deps.logger.warn("Session event append authorization failed; refusing", {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }
  let bound: string;
  try {
    bound = deps.runnerAuth.verify(TOKEN_TYPE_EXECUTION_SCOPED, token);
  } catch {
    return false;
  }
  if (bound !== runId) {
    deps.logger.warn("A runner credential asked to append another run's events; refusing", {
      tokenExecutionId: bound,
      runId,
    });
    return false;
  }
  return true;
}

async function loadRun(store: Store, runId: string): Promise<Run> {
  try {
    return await store.getResource(ApiResourceKind.run, runId, RunSchema);
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      throw permissionDeniedError(NOT_THE_RUNS_RUNNER_MESSAGE);
    }
    throw internalError(error, "failed to load the run");
  }
}

/** Refuses a finished run: its turn is over and takes no more events. */
function admitLive(run: Run): void {
  const phase = run.status?.phase ?? RunPhase.RUN_PHASE_UNSPECIFIED;
  if (isTerminalExecutionPhase(phase)) {
    throw failedPreconditionError(
      `run '${run.metadata?.id ?? ""}' is finished; it takes no more events`,
    );
  }
}
