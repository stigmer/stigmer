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
 *     an invalid request) ends it.
 *   - {@link sendAndWait} starts a turn (`run.create`, as every turn
 *     starts) and follows the session until that turn's
 *     `stigmer.run.status` says it ended, or it waits for a person's answer
 *     (the session idles with `requires_action` naming its tool uses). It
 *     returns the turn's answer, structured output and how it ended;
 *     {@link waitForTurn} resumes the wait after the caller answered.
 *
 * Proven by __tests__/session-events.test.ts.
 */
import { create, type JsonObject } from "@bufbuild/protobuf";
import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import type {
  ListSessionEventsRequest,
  SessionEventList,
  StreamSessionEventsRequest,
  StreamSessionEventsResponse,
} from "@stigmer/protos/ai/stigmer/agentic/session/v1/io_pb";
import {
  ListSessionEventsRequestSchema,
  StreamSessionEventsRequestSchema,
} from "@stigmer/protos/ai/stigmer/agentic/session/v1/io_pb";
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
export type SessionPreviewType = "agent.message" | "agent.thinking" | "stigmer.tool_output_delta";

/** Every preview type: a message as it is written, a thinking as it starts, a running tool's output. */
export const ALL_SESSION_PREVIEWS: ReadonlyArray<SessionPreviewType> = [
  "agent.message",
  "agent.thinking",
  "stigmer.tool_output_delta",
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
  let failures = 0;
  while (!isAborted(signal)) {
    const request = create(StreamSessionEventsRequestSchema, {
      sessionId,
      eventDeltas: [...(options.previews ?? [])],
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

/**
 * Sends a message as a new turn (in `sessionId`, or a session bootstrapped
 * from `sessionSpec`) and waits for its answer (module header).
 */
export async function sendAndWait(
  client: SendAndWaitClient,
  input: SendAndWaitInput,
  options: Omit<WaitOptions, "afterSeq"> = {},
): Promise<TurnOutcome> {
  const existing = input.sessionId ?? "";
  // A new session's log is empty; an existing one is read from its newest place.
  const afterSeq = existing === "" ? NO_PLACE : await newestSeq(client, existing);
  const run = await client.run.create({ ...input, name: input.name ?? `run-${Date.now()}` });
  const runId = run.metadata?.id ?? "";
  const sessionId = run.spec?.target.case === "sessionId" ? run.spec.target.value : existing;
  if (sessionId === "") {
    throw new StigmerError("internal", "the created run names no session", 13);
  }
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
        return {
          run,
          runId,
          sessionId,
          phase: ended ? turn.status!.phase : "waiting",
          answer: turn.answer,
          structuredOutput: turn.structuredOutput,
          stopCause: turn.status?.stopCause ?? "",
          error: turn.status?.error ?? "",
          asks: ended ? [] : turn.asks,
          turn,
          lastSeq: fold.lastSeq,
        };
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
