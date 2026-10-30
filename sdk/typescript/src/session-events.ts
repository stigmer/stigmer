/**
 * Reading a session's events: follow its log, and send a message and wait
 * for the turn's answer.
 *
 * A session's output is one ordered log of Claude Managed Agents events
 * (`SessionQueryController.listEvents` and `streamEvents`). Every client
 * reads a conversation from it, folded by `@stigmer/session-log`
 * (`SessionLog`, re-exported from this package):
 *
 *   - {@link followSession} is one `streamEvents` call with `after_seq` set:
 *     the server first sends every stored event after that place, then the
 *     live ones, with none missed and none repeated, so a follow needs no
 *     separate list. A stream that drops reconnects from the last place it
 *     delivered, with a backoff; a refusal (not found, permission denied,
 *     an invalid request) ends it. One refusal does not: a server older
 *     than `stigmer.run.liveness` refuses a request that names it, so a
 *     follow that asked for it asks again at once without it, and keeps it
 *     off for the rest of the follow.
 *   - {@link sendAndWait} starts a turn (`run.create`, as every turn
 *     starts) and follows the session until that turn's
 *     `stigmer.run.status` says it ended, or it waits for a person's answer
 *     (the session idles with `requires_action` naming its tool uses). It
 *     returns the turn's answer, structured output and how it ended;
 *     {@link waitForTurn} resumes the wait after the caller answered. Its two
 *     halves are exported for a caller that follows the turn its own way (a
 *     view that renders it): {@link startTurn} creates the run and names its
 *     session and place in the log, and {@link turnOutcomeOf} reads the
 *     outcome from the folded turn, so the default run name, the session
 *     rule and the outcome's fields are written once.
 *   - {@link followAttention} follows what needs the caller in an
 *     organization (`streamAttention`): one Attention each time a
 *     conversation they created stops working. It reconnects from the last
 *     cursor it delivered, and delivers each attention once, though the
 *     server may send one again after a reconnect.
 *
 * Proven by __tests__/session-events.test.ts.
 */
import { create, type JsonObject } from "@bufbuild/protobuf";
import type { Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import type {
  Attention,
  ListSessionEventsRequest,
  SessionEventList,
  StreamAttentionRequest,
  StreamSessionEventsRequest,
  StreamSessionEventsResponse,
} from "@stigmer/apis/ai/stigmer/agentic/session/v1/io_pb";
import {
  ListSessionEventsRequestSchema,
  StreamAttentionRequestSchema,
  StreamSessionEventsRequestSchema,
} from "@stigmer/apis/ai/stigmer/agentic/session/v1/io_pb";
import { SessionLog, type ToolUse, type Turn, type TurnPhase } from "@stigmer/session-log";

import { StigmerError, wrapError } from "./gen/errors.js";
import type { RunInput } from "./gen/run.js";

/**
 * The place before the first event: a follow from it replays the whole log.
 * Written as a call, not a literal, because consumers compile this source
 * for targets older than BigInt literals (the docs site's ES2017).
 */
const NO_PLACE = BigInt(0);

/** The preview types a follow can ask for (`StreamSessionEventsRequest.event_deltas`). */
export type SessionPreviewType =
  | "agent.message"
  | "agent.thinking"
  | "stigmer.tool_output_delta"
  | "stigmer.run.liveness";

/**
 * Every preview type: a message as it is written, a thinking as it starts,
 * a running tool's output, and what a working turn has open.
 */
export const ALL_SESSION_PREVIEWS: ReadonlyArray<SessionPreviewType> = [
  "agent.message",
  "agent.thinking",
  "stigmer.tool_output_delta",
  "stigmer.run.liveness",
];

/** The slice of the client a follow reads through. */
export interface SessionEventsClient {
  readonly session: {
    streamEvents(input: StreamSessionEventsRequest, signal?: AbortSignal): AsyncIterable<StreamSessionEventsResponse>;
    listEvents(input: ListSessionEventsRequest): Promise<SessionEventList>;
  };
}

/** The slice of the client {@link sendAndWait} needs beyond a follow. */
export interface SendAndWaitClient extends SessionEventsClient {
  readonly run: { create(input: RunInput): Promise<Run> };
}

export interface FollowSessionOptions {
  /** Ends the follow. */
  readonly signal?: AbortSignal;
  /** The previews to stream while events are produced; none by default. */
  readonly previews?: ReadonlyArray<SessionPreviewType>;
  /** The place to resume after: every stored event after it comes first. 0 (the default) replays the whole log. */
  readonly afterSeq?: bigint;
  /** The first reconnect's wait, doubled per failure up to {@link maxBackoffMs}; 500 ms by default. */
  readonly backoffMs?: number;
  /** The longest wait between reconnects; 5 s by default. */
  readonly maxBackoffMs?: number;
  /** Waits; a test replaces it. */
  readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

/** The preview a server older than it refuses: a follow drops it on that refusal (module header). */
const LIVENESS_PREVIEW: SessionPreviewType = "stigmer.run.liveness";

/** The codes a reconnect cannot fix: the follow ends with the error. */
const FINAL_CODES: ReadonlySet<StigmerError["code"]> = new Set([
  "not-found",
  "permission-denied",
  "unauthenticated",
  "invalid-argument",
  "failed-precondition",
]);

/**
 * Follows a session's log: every stored event after `afterSeq` (the whole
 * log by default), then each new event as it is appended, and the previews
 * asked for. Reconnects from the last delivered place when the stream drops
 * or ends; ends when `signal` aborts, or throws on a refusal (module
 * header).
 */
export async function* followSession(
  client: SessionEventsClient,
  sessionId: string,
  options: FollowSessionOptions = {},
): AsyncGenerator<StreamSessionEventsResponse> {
  const { signal } = options;
  const sleep = options.sleep ?? sleepFor;
  const base = options.backoffMs ?? 500;
  const max = options.maxBackoffMs ?? 5_000;
  let afterSeq = options.afterSeq ?? NO_PLACE;
  let previews = [...(options.previews ?? [])];
  let failures = 0;
  while (!isAborted(signal)) {
    const request = create(StreamSessionEventsRequestSchema, {
      sessionId,
      eventDeltas: previews,
      afterSeq,
    });
    try {
      for await (const frame of client.session.streamEvents(request, signal)) {
        failures = 0;
        if (frame.frame.case === "event" && frame.frame.value.seq > afterSeq) {
          afterSeq = frame.frame.value.seq;
        }
        yield frame;
      }
    } catch (err) {
      if (isAborted(signal)) {
        return;
      }
      const error = wrapError(err);
      if (error.code === "invalid-argument" && previews.includes(LIVENESS_PREVIEW)) {
        // A server older than the liveness preview refuses the request that
        // names it; the follow asks again at once without it, and for good.
        previews = previews.filter((type) => type !== LIVENESS_PREVIEW);
        continue;
      }
      if (FINAL_CODES.has(error.code)) {
        throw error;
      }
    }
    if (isAborted(signal)) {
      return;
    }
    await sleep(Math.min(max, base * 2 ** failures), signal);
    failures += 1;
  }
}

/** The slice of the client {@link followAttention} reads through. */
export interface AttentionClient {
  readonly session: {
    streamAttention(input: StreamAttentionRequest, signal?: AbortSignal): AsyncIterable<Attention>;
  };
}

/** Options for {@link followAttention}. */
export interface FollowAttentionOptions {
  /** Ends the follow. */
  readonly signal?: AbortSignal;
  /** The cursor of the last attention already shown; none follows only what comes after the follow opens. */
  readonly afterCursor?: string;
  /** The first reconnect's wait, doubled per failure up to {@link maxBackoffMs}; 500 ms by default. */
  readonly backoffMs?: number;
  /** The longest wait between reconnects; 5 s by default. */
  readonly maxBackoffMs?: number;
  /** Waits; a test replaces it. */
  readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

/** How many delivered attention ids a follow remembers, to deliver each once. */
const ATTENTION_IDS_KEPT = 1024;

/**
 * Follows what needs the caller in `org`: each conversation they created
 * that stops working, once (module header). Reconnects from the last
 * cursor it delivered when the stream drops; until it has delivered one, a
 * reconnect follows only what comes after it reopens, so pass
 * `afterCursor` to resume a follow across a gap. Ends when `signal`
 * aborts, or throws on a refusal.
 */
export async function* followAttention(
  client: AttentionClient,
  org: string,
  options: FollowAttentionOptions = {},
): AsyncGenerator<Attention> {
  const { signal } = options;
  const sleep = options.sleep ?? sleepFor;
  const base = options.backoffMs ?? 500;
  const max = options.maxBackoffMs ?? 5_000;
  let afterCursor = options.afterCursor ?? "";
  const delivered = new Set<string>();
  let failures = 0;
  while (!isAborted(signal)) {
    try {
      for await (const attention of client.session.streamAttention(create(StreamAttentionRequestSchema, { org, afterCursor }), signal)) {
        failures = 0;
        afterCursor = attention.cursor;
        if (delivered.has(attention.id)) {
          continue;
        }
        delivered.add(attention.id);
        if (delivered.size > ATTENTION_IDS_KEPT) {
          delivered.delete(delivered.values().next().value as string);
        }
        yield attention;
      }
    } catch (err) {
      if (isAborted(signal)) {
        return;
      }
      const error = wrapError(err);
      if (FINAL_CODES.has(error.code)) {
        throw error;
      }
    }
    if (isAborted(signal)) {
      return;
    }
    await sleep(Math.min(max, base * 2 ** failures), signal);
    failures += 1;
  }
}

/** The newest event's place in a session's log; 0 for an empty log. */
export async function newestSeq(client: SessionEventsClient, sessionId: string): Promise<bigint> {
  const page = await client.session.listEvents(
    create(ListSessionEventsRequestSchema, { sessionId, order: "desc", pageSize: 1 }),
  );
  return page.events[0]?.seq ?? NO_PLACE;
}

/** How a waited-for turn stands when the wait returns. */
export interface TurnOutcome {
  /** The run that is the turn, as `run.create` returned it ({@link sendAndWait} only). */
  readonly run: Run | undefined;
  readonly runId: string;
  readonly sessionId: string;
  /**
   * The turn's phase: one that ends it (completed, failed, cancelled,
   * terminated), or `waiting` when it waits for a person's answer (see
   * {@link asks}). The wait returns on nothing else.
   */
  readonly phase: TurnPhase;
  /** The text of the turn's last message on its primary thread; "" when it wrote none. */
  readonly answer: string;
  readonly structuredOutput: JsonObject | undefined;
  /** Why it ended (RunStatus.stop_cause), once it has; "" otherwise. */
  readonly stopCause: string;
  /** What went wrong, when it failed or was stopped with a reason. */
  readonly error: string;
  /** The tool uses that wait for an answer, when `phase` is waiting. */
  readonly asks: ReadonlyArray<ToolUse>;
  /** The whole turn, folded. */
  readonly turn: Turn;
  /** The log's place when the wait returned: pass it to {@link waitForTurn} to resume. */
  readonly lastSeq: bigint;
}

export interface WaitOptions {
  readonly signal?: AbortSignal;
  /** Where in the log the turn's events begin, or later: the wait reads only after it. */
  readonly afterSeq?: bigint;
  /** Passed through to the follow (tests). */
  readonly sleep?: FollowSessionOptions["sleep"];
}

/**
 * Waits for one turn of a session: until its status says it ended, or it
 * waits for an answer. Answer each of {@link TurnOutcome.asks} (the
 * session's `confirmToolUse` or `grantPermission`), then call it again
 * with the outcome's `lastSeq`.
 */
export async function waitForTurn(
  client: SessionEventsClient,
  sessionId: string,
  runId: string,
  options: WaitOptions = {},
): Promise<TurnOutcome> {
  return waitIn(client, sessionId, runId, undefined, options);
}

/** What {@link sendAndWait} sends: the message, and where. */
export type SendAndWaitInput = Omit<RunInput, "message" | "name" | "org"> & {
  readonly message: string;
  /** The organization the turn runs in. */
  readonly org: string;
  /** The run's name; `run-<epoch ms>` when absent, as the console names its turns. */
  readonly name?: string;
};

/** A turn {@link startTurn} started: its run, its session, and where its events begin. */
export interface StartedTurn {
  /** The run that is the turn, as `run.create` returned it. */
  readonly run: Run;
  readonly runId: string;
  /** The session the turn runs in: the one named, or the one its `sessionSpec` bootstrapped. */
  readonly sessionId: string;
  /** The session log's place before the turn: its events come after it. */
  readonly afterSeq: bigint;
}

/**
 * Starts a turn: sends the message as a new run (in `sessionId`, or a session
 * bootstrapped from `sessionSpec`), named `run-<epoch ms>` unless `name` says
 * otherwise. For an existing session it first reads the log's newest place,
 * so a follow from `afterSeq` sees only this turn's events.
 */
export async function startTurn(client: SendAndWaitClient, input: SendAndWaitInput): Promise<StartedTurn> {
  const existing = input.sessionId ?? "";
  // A new session's log is empty; an existing one is read from its newest place.
  const afterSeq = existing === "" ? NO_PLACE : await newestSeq(client, existing);
  const run = await client.run.create({ ...input, name: input.name ?? `run-${Date.now()}` });
  const runId = run.metadata?.id ?? "";
  const sessionId = run.spec?.target.case === "sessionId" ? run.spec.target.value : existing;
  if (sessionId === "") {
    throw new StigmerError("internal", "the created run names no session", 13);
  }
  return { run, runId, sessionId, afterSeq };
}

/** Which turn an outcome is for: {@link StartedTurn}'s first three fields, the run when known. */
export interface TurnPlace {
  readonly run: Run | undefined;
  readonly runId: string;
  readonly sessionId: string;
}

/**
 * The outcome of a folded turn: its answer, output and how it stands. Its
 * phase is the status's once the turn ended, `waiting` when `waiting` says
 * the session waits on its asks, and otherwise the phase it reports now
 * (`pending` before its first status); its asks are empty once it ended.
 */
export function turnOutcomeOf(turn: Turn, place: TurnPlace, lastSeq: bigint, waiting = false): TurnOutcome {
  const ended = turn.status !== undefined && turn.ended;
  return {
    ...place,
    phase: ended ? turn.status!.phase : waiting ? "waiting" : (turn.status?.phase ?? "pending"),
    answer: turn.answer,
    structuredOutput: turn.structuredOutput,
    stopCause: turn.status?.stopCause ?? "",
    error: turn.status?.error ?? "",
    asks: ended ? [] : turn.asks,
    turn,
    lastSeq,
  };
}

/**
 * Sends a message as a new turn (in `sessionId`, or a session bootstrapped
 * from `sessionSpec`) and waits for its answer (module header).
 */
export async function sendAndWait(
  client: SendAndWaitClient,
  input: SendAndWaitInput,
  options: Omit<WaitOptions, "afterSeq"> = {},
): Promise<TurnOutcome> {
  const { run, runId, sessionId, afterSeq } = await startTurn(client, input);
  return waitIn(client, sessionId, runId, run, { ...options, afterSeq });
}

async function waitIn(
  client: SessionEventsClient,
  sessionId: string,
  runId: string,
  run: Run | undefined,
  options: WaitOptions,
): Promise<TurnOutcome> {
  const controller = new AbortController();
  const stop = () => controller.abort();
  options.signal?.addEventListener("abort", stop, { once: true });
  const log = new SessionLog();
  try {
    for await (const frame of followSession(client, sessionId, {
      signal: controller.signal,
      afterSeq: options.afterSeq ?? NO_PLACE,
      ...(options.sleep === undefined ? {} : { sleep: options.sleep }),
    })) {
      if (!log.applyFrame(frame)) {
        continue;
      }
      const fold = log.snapshot();
      const turn = fold.turns.find((t) => t.runId === runId);
      if (turn === undefined) {
        continue;
      }
      const ended = turn.status !== undefined && turn.ended;
      const waiting =
        fold.status.state === "idle" &&
        fold.status.stopReason === "requires_action" &&
        turn.asks.some((ask) => fold.status.waitingOn.includes(ask.id));
      if (ended || waiting) {
        return turnOutcomeOf(turn, { run, runId, sessionId }, fold.lastSeq, waiting);
      }
    }
    throw new StigmerError("cancelled", "the wait for the turn was stopped", 1);
  } finally {
    options.signal?.removeEventListener("abort", stop);
    controller.abort();
  }
}

/** Whether the follow was stopped (a function, so a check is never narrowed away between awaits). */
function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function sleepFor(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done(): void {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}
