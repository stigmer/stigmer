/**
 * SessionQueryController.streamAttention: what needs the caller, one
 * Attention each time a conversation they created in the organization
 * stops working.
 *
 * The stream is a cursor over the stored log, as streamEvents is
 * (stream.ts): it reads the organization's `session.status_idle` events
 * after its cursor (accepted time, then event id; the store's `listByOrg`),
 * sends the ones that need the caller, and advances, one page at a time,
 * so a read holds one page however far back it starts. Between reads it
 * waits for the client leaving, the organization's idle bell (a write on
 * this server committed an idle in it, broker.ts), or the tail timer,
 * which finds what another server process committed, with the event
 * stream's bounds. A cursor older than `ATTENTION_RESUME_LIMIT_MS`
 * resumes from that far back: a client away longer is not told of every
 * conversation that stopped while it was gone.
 *
 * An idle's accepted time is its writer's clock, and two writers commit in
 * their own order, so a read starts `ATTENTION_OVERLAP_MS` before the
 * cursor and passes over the ids it already handled: an idle committed a
 * little after a later one is still sent. Without `after_cursor` the
 * stream marks that window handled, so it sends only what comes after it
 * opens; with one, it reads the window again, and a client keeps the ids
 * it showed (the RPC's contract).
 *
 * An idle needs the caller when its conversation is theirs (the session's
 * creator, `status.audit.spec_audit.created_by`) and its reason asks for
 * them: `end_turn` is "finished", `retries_exhausted` and `budget_reached`
 * are "failed", `requires_action` is "needs_answer". An idle the person's
 * own stop caused sends nothing: the newest of its session's turn statuses
 * and interrupts before it is an interrupt, or a status whose stop cause is
 * `user`. Every other idle is passed over.
 *
 * A direct handler, as streamEvents: an authorizeDirect of the method's
 * annotation (can_view on the organization) at the start and again before
 * the next attention once SESSION_EVENT_STREAM_REAUTHORIZE_MS has passed.
 * The serving chain resolves an organization's name to its id on unary
 * requests only, so this handler resolves `org` itself, by the same rule
 * (pipeline/interceptors/organization-names.ts), before it authorizes.
 *
 * Proven by __tests__/attention.test.ts and the attention conformance arm.
 */
import { clone, create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import type { HandlerContext } from "@connectrpc/connect";

import { SessionSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import {
  AttentionSchema,
  StreamAttentionRequestSchema,
  type Attention,
  type StreamAttentionRequest,
} from "@stigmer/apis/ai/stigmer/agentic/session/v1/io_pb";
import { SessionQueryController } from "@stigmer/apis/ai/stigmer/agentic/session/v1/query_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Authorizer } from "../../../extensions/authorizer.js";
import { internalError, invalidArgumentError } from "../../../pipeline/errors.js";
import { resolveOrganizationNames } from "../../../pipeline/interceptors/organization-names.js";
import { newOrganizationNameResolver } from "../../organization/names.js";
import { callerIdentityOf } from "../../../pipeline/interceptors/auth.js";
import { authorizeDirect } from "../../../pipeline/steps/authorize.js";
import { ResourceNotFoundError, type Store } from "../../../store/interface.js";
import type { SessionEventRecord } from "../../../store/session-events.js";
import { SESSION_EVENT_BROKER_CLOSED_MESSAGE, sessionIdleBellOf, type SessionEventBroker } from "./broker.js";
import { eventOf } from "./codec.js";
import {
  SESSION_EVENT_REPLAY_BATCH,
  SESSION_EVENT_STREAM_REAUTHORIZE_MS,
  SESSION_EVENT_TAIL_MAX_MS,
  SESSION_EVENT_TAIL_MIN_MS,
} from "./stream.js";

export interface StreamAttentionDeps {
  readonly store: Store;
  readonly authorizer: Authorizer;
  readonly sessionEventBroker: SessionEventBroker;
  /** Unix milliseconds; injectable for the re-authorization and window arms. */
  readonly now?: () => number;
  /** The tail read's bounds; injectable for the arms that would wait on them. */
  readonly tailMs?: { readonly min: number; readonly max: number };
}

/** How far before its cursor a read starts (the module header says why). */
export const ATTENTION_OVERLAP_MS = 30_000;

/** How far back a resumed stream reads at most: a day. */
export const ATTENTION_RESUME_LIMIT_MS = 24 * 60 * 60_000;

/** The accepted time as the stream writes it in a cursor (`Date.prototype.toISOString`). */
const CURSOR_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const IDLE_TYPE = "session.status_idle";

/** The events that say who stopped a session's turn: its turn statuses and its interrupts. */
const STOPPED_BY_TYPES = ["stigmer.run.status", "user.interrupt"];

/** Why an idle needs the person, by its stop reason; a reason not here needs no one. */
const REASONS: Readonly<Record<string, string>> = {
  end_turn: "finished",
  retries_exhausted: "failed",
  budget_reached: "failed",
  requires_action: "needs_answer",
};

/** What the stream needs of a conversation: whose it is, and its title. */
interface Conversation {
  readonly creator: string;
  readonly title: string;
}

/** A cursor as the stream writes it: the accepted time, then the event id. */
interface Position {
  readonly processedAt: string;
  readonly eventId: string;
}

export function attentionCursorOf(position: Position): string {
  return `${position.processedAt}|${position.eventId}`;
}

/** The position a cursor names; throws INVALID_ARGUMENT for one the stream never wrote. */
export function positionOfCursor(cursor: string): Position {
  const at = cursor.indexOf("|");
  const processedAt = at < 0 ? "" : cursor.slice(0, at);
  if (!CURSOR_TIME.test(processedAt) || Number.isNaN(Date.parse(processedAt))) {
    throw invalidArgumentError(`after_cursor '${cursor}' is not a cursor this stream sent`);
  }
  return { processedAt, eventId: cursor.slice(at + 1) };
}

export async function* streamAttention(
  deps: StreamAttentionDeps,
  req: StreamAttentionRequest,
  context: HandlerContext,
): AsyncGenerator<Attention> {
  if (req.org === "") {
    throw invalidArgumentError("org is required");
  }
  const request = clone(StreamAttentionRequestSchema, req);
  await resolveOrganizationNames(StreamAttentionRequestSchema, request, newOrganizationNameResolver(deps.store));
  const now = deps.now ?? Date.now;
  const tail = deps.tailMs ?? { min: SESSION_EVENT_TAIL_MIN_MS, max: SESSION_EVENT_TAIL_MAX_MS };
  const caller = callerIdentityOf(context);
  const authorize = () => authorizeDirect(SessionQueryController.method.streamAttention, deps.authorizer, caller, request);
  await authorize();
  let authorizedAt = now();

  const broker = deps.sessionEventBroker;
  const bell = sessionIdleBellOf(request.org);
  const subscription = broker.subscribe(bell, []);
  const abort = new Promise<void>((resolve) => {
    context.signal.addEventListener("abort", () => resolve(), { once: true });
  });
  const conversations = new Map<string, Conversation | undefined>();
  /** The ids handled within the window, by their accepted time. */
  const handled = new Map<string, string>();
  const endIfClosed = (): void => {
    if (subscription.closed) {
      throw new ConnectError(subscription.closedBecause ?? SESSION_EVENT_BROKER_CLOSED_MESSAGE, Code.Unavailable);
    }
  };
  try {
    endIfClosed();
    let cursor: Position =
      req.afterCursor === "" ? { processedAt: new Date(now()).toISOString(), eventId: "" } : positionOfCursor(req.afterCursor);
    const oldest = new Date(now() - ATTENTION_RESUME_LIMIT_MS).toISOString();
    if (cursor.processedAt < oldest) {
      cursor = { processedAt: oldest, eventId: "" };
    }
    // A new stream sends nothing from before it opened: the window it
    // would read again is handled as it opens.
    if (req.afterCursor === "") {
      for await (const page of windowPages(deps, request.org, cursor)) {
        for (const record of page) {
          handled.set(record.eventId, record.processedAt);
        }
      }
    }
    let tailMs = tail.min;
    let readDue = true;
    let tailFired = false;
    while (!context.signal.aborted) {
      endIfClosed();
      if (subscription.dirty || readDue) {
        subscription.dirty = false;
        readDue = false;
        let delivered = false;
        // A conversation is read once per read, so a rename shows on its
        // next idle and the stream keeps no conversation it is not reading.
        conversations.clear();
        for await (const page of windowPages(deps, request.org, cursor)) {
          for (const record of page) {
            if (handled.has(record.eventId)) {
              continue;
            }
            handled.set(record.eventId, record.processedAt);
            if (record.processedAt > cursor.processedAt) {
              cursor = { processedAt: record.processedAt, eventId: record.eventId };
            }
            const attention = await attentionOf(deps, record, caller.identityId, conversations);
            if (attention === undefined) {
              continue;
            }
            if (now() - authorizedAt >= SESSION_EVENT_STREAM_REAUTHORIZE_MS) {
              await authorize();
              authorizedAt = now();
            }
            yield attention;
            delivered = true;
          }
          forgetBefore(handled, cursor);
        }
        if (delivered) {
          tailMs = tail.min;
        } else if (tailFired) {
          tailMs = Math.min(tailMs * 2, tail.max);
        }
        tailFired = false;
        continue;
      }
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        abort,
        new Promise<void>((resolve) => (subscription.notify = resolve)),
        new Promise<void>((resolve) => {
          timer = setTimeout(() => {
            readDue = true;
            tailFired = true;
            resolve();
          }, tailMs);
        }),
      ]);
      clearTimeout(timer);
      subscription.notify = undefined;
    }
  } finally {
    broker.unsubscribe(bell, subscription);
  }
}

/** The start of the window a read covers: `ATTENTION_OVERLAP_MS` before the cursor. */
function windowStart(cursor: Position): Position {
  return { processedAt: new Date(Date.parse(cursor.processedAt) - ATTENTION_OVERLAP_MS).toISOString(), eventId: "" };
}

/** Every idle of the organization from the window's start on, one page at a time. */
async function* windowPages(deps: StreamAttentionDeps, org: string, cursor: Position): AsyncGenerator<SessionEventRecord[]> {
  let after = windowStart(cursor);
  for (;;) {
    let page: SessionEventRecord[];
    try {
      page = await deps.store.sessionEvents.listByOrg(org, { types: [IDLE_TYPE], after, limit: SESSION_EVENT_REPLAY_BATCH });
    } catch (error) {
      throw internalError(error, "failed to read the organization's events");
    }
    yield page;
    const last = page.at(-1);
    if (last === undefined || page.length < SESSION_EVENT_REPLAY_BATCH) {
      return;
    }
    after = { processedAt: last.processedAt, eventId: last.eventId };
  }
}

/** Drops the handled ids the next window starts after. */
function forgetBefore(handled: Map<string, string>, cursor: Position): void {
  const start = windowStart(cursor).processedAt;
  for (const [eventId, processedAt] of handled) {
    if (processedAt < start) {
      handled.delete(eventId);
    }
  }
}

/** The Attention an idle makes for `caller`, or undefined when it needs no one, or not them (the module header). */
async function attentionOf(
  deps: StreamAttentionDeps,
  record: SessionEventRecord,
  caller: string,
  conversations: Map<string, Conversation | undefined>,
): Promise<Attention | undefined> {
  // The read takes idles only (readWindow): any other reads as no reason.
  const event = eventOf(record).event;
  const reason = REASONS[(event.case === "sessionStatusIdle" && event.value.stopReason?.type) || ""];
  if (reason === undefined) {
    return undefined;
  }
  if (!conversations.has(record.sessionId)) {
    conversations.set(record.sessionId, await conversationOf(deps.store, record.sessionId));
  }
  const conversation = conversations.get(record.sessionId);
  if (conversation === undefined || conversation.creator === "" || conversation.creator !== caller) {
    return undefined;
  }
  if (reason === "finished" && (await stoppedByThePerson(deps.store, record))) {
    return undefined;
  }
  return create(AttentionSchema, {
    id: record.eventId,
    sessionId: record.sessionId,
    title: conversation.title,
    runId: record.runId,
    reason,
    at: record.processedAt,
    cursor: attentionCursorOf({ processedAt: record.processedAt, eventId: record.eventId }),
  });
}

/** A conversation's creator and title; undefined once it is gone. */
async function conversationOf(store: Store, sessionId: string): Promise<Conversation | undefined> {
  try {
    const session = await store.getResource(ApiResourceKind.session, sessionId, SessionSchema);
    return {
      creator: session.status?.audit?.specAudit?.createdBy?.id ?? "",
      title: session.spec?.subject || session.metadata?.name || "",
    };
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      return undefined;
    }
    throw internalError(error, "failed to read the session");
  }
}

/** Whether the person's own stop ended the session's turn before this idle (the module header). */
async function stoppedByThePerson(store: Store, idle: SessionEventRecord): Promise<boolean> {
  let before: SessionEventRecord[];
  try {
    before = await store.sessionEvents.list(idle.sessionId, { order: "desc", afterSeq: idle.seq, types: STOPPED_BY_TYPES, limit: 1 });
  } catch (error) {
    throw internalError(error, "failed to read the session's events");
  }
  const newest = before[0];
  if (newest === undefined) {
    return false;
  }
  const event = eventOf(newest);
  return event.event.case === "userInterrupt" || (event.event.case === "stigmerRunStatus" && event.event.value.stopCause === "user");
}
