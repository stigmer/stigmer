// Session-event builders for the thread tests: the events `samples` does
// not build (subagent threads, file reviews, memory recall, notes,
// compaction, answers), short spellings of the ones it does, a run record
// carrying only what a turn's run holds (spec, phase, stamps, artifacts,
// captured file changes), and the fold that turns events into the turns
// `buildThreadItems` and `MessageThread` read. Ids follow the runner's
// shapes (`<run>.<call>`, `<run>.root.m<n>`) so a turn's items key stably.
import { create, type JsonObject, type MessageInitShape } from "@bufbuild/protobuf";
import { RunSchema, RunStatusSchema, type Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunSpecSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/spec_pb";
import { InteractionMode, RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { SessionEventSchema, type SessionEvent } from "@stigmer/apis/ai/stigmer/agentic/session/v1/event_pb";
import {
  StreamSessionEventsResponseSchema,
  type StreamSessionEventsResponse,
} from "@stigmer/apis/ai/stigmer/agentic/session/v1/io_pb";
import type { Turn, TurnPhase } from "@stigmer/client";
import { SAMPLE_INSTANT, samples } from "../../../test/samples";

type EventInit = MessageInitShape<typeof SessionEventSchema>["event"];

/** One stored event of run `runId` on `threadId` ("" for the primary thread). */
export function ev(runId: string, event: EventInit, threadId = ""): SessionEvent {
  return create(SessionEventSchema, { sessionId: "ses_1", runId, threadId, event });
}

/** The folded turns of a log given as events or groups of events, in order. */
export function turnsOf(...events: ReadonlyArray<SessionEvent | readonly SessionEvent[]>): readonly Turn[] {
  return samples.fold(events.flat()).turns;
}

const text = (t: string) => (t === "" ? [] : [{ type: "text", text: t }]);

/** The person's message that starts a turn. */
export function user(runId: string, message: string): SessionEvent {
  return samples.userMessageEvent(message, { runId });
}

/**
 * An agent message, the `index`-th of its thread: `<run>.root.m<index>` on
 * the primary thread, `<thread>.m<index>` on a subagent's.
 */
export function said(runId: string, index: number, message: string, threadId = ""): SessionEvent {
  const id = threadId === "" ? `${runId}.root.m${index}` : `${threadId}.m${index}`;
  return samples.agentMessageEvent(message, { runId, id, threadId });
}

/** A thinking with its text, the `index`-th of its turn. */
export function thought(runId: string, index: number, thinking: string): SessionEvent[] {
  return samples.thinkingEvents(thinking, { runId, id: `${runId}.root.t${index}` });
}

/** A turn's phase. */
export function status(runId: string, phase: TurnPhase, extra: { error?: string; stopCause?: string } = {}): SessionEvent {
  return samples.runStatusEvent(phase, { runId, id: `${runId}.status.${phase}`, ...extra });
}

/** The id of call `call` of run `runId`. */
export const toolId = (runId: string, call: string): string => `${runId}.${call}`;

/** A tool call `call` of run `runId`. */
export function use(
  runId: string,
  call: string,
  name: string,
  input: JsonObject = {},
  extra: { ask?: boolean; threadId?: string; mcpServerName?: string } = {},
): SessionEvent {
  return samples.toolUseEvent(name, input, {
    runId,
    id: toolId(runId, call),
    threadId: extra.threadId ?? "",
    evaluatedPermission: extra.ask ? "ask" : "",
    ...(extra.mcpServerName === undefined ? {} : { mcpServerName: extra.mcpServerName }),
  });
}

/** Call `call`'s result. */
export function result(runId: string, call: string, output: string, extra: { isError?: boolean; threadId?: string } = {}): SessionEvent {
  return samples.toolResultEvent(toolId(runId, call), output, {
    runId,
    threadId: extra.threadId ?? "",
    isError: extra.isError ?? false,
  });
}

/** Why call `call` waits for a person. */
export function asked(runId: string, call: string, extra: { threadId?: string } = {}): SessionEvent {
  return samples.permissionAskedEvent(toolId(runId, call), { runId, argsPreview: "{}", threadId: extra.threadId ?? "" });
}

/** A person's answer to call `call`. */
export function confirmed(runId: string, call: string, answer: "allow" | "deny"): SessionEvent {
  return ev(runId, {
    case: "userToolConfirmation",
    value: { id: `${toolId(runId, call)}.confirm`, toolUseId: toolId(runId, call), result: answer, denyMessage: "" },
  });
}

/**
 * A subagent's thread opened by `task` call `call`: created, running, the
 * message it was sent, its `items`, and — once it finished — its reply and
 * idle. The thread's id is the call's id.
 */
export function subagent(
  runId: string,
  call: string,
  opts: { agentName?: string; input?: string; items?: readonly SessionEvent[]; finished?: "completed" | "failed"; reply?: string } = {},
): SessionEvent[] {
  const threadId = toolId(runId, call);
  const agentName = opts.agentName ?? "researcher";
  const events = [
    ev(runId, { case: "sessionThreadCreated", value: { id: `${threadId}.created`, agentName, sessionThreadId: threadId } }),
    ev(runId, { case: "sessionThreadStatusRunning", value: { id: `${threadId}.running`, agentName, sessionThreadId: threadId } }),
    ev(runId, {
      case: "agentThreadMessageSent",
      value: { id: `${threadId}.sent`, content: text(opts.input ?? ""), toSessionThreadId: threadId, toAgentName: agentName },
    }),
    ...(opts.items ?? []),
  ];
  if (opts.finished !== undefined) {
    events.push(
      ev(runId, {
        case: "agentThreadMessageReceived",
        value: { id: `${threadId}.received`, content: text(opts.reply ?? ""), fromSessionThreadId: threadId, fromAgentName: agentName },
      }),
      ev(runId, {
        case: "sessionThreadStatusIdle",
        value: {
          id: `${threadId}.idle`,
          agentName,
          sessionThreadId: threadId,
          stopReason: { type: opts.finished === "completed" ? "end_turn" : "retries_exhausted" },
        },
      }),
    );
  }
  return events;
}

/** One file of a change set: its id, path and how reviewable it is. */
export interface ChangedFile {
  readonly id: string;
  readonly path: string;
  readonly reviewable?: string;
}

/** A turn's captured changes, offered for review (`stigmer.file_review.changes`). */
export function changes(runId: string, changeSetId: string, files: readonly ChangedFile[]): SessionEvent {
  return ev(runId, {
    case: "stigmerFileReviewChanges",
    value: {
      id: `${changeSetId}.changes`,
      changeSetId,
      aggregateDigest: `agg-${changeSetId}`,
      files: files.map((file) => ({
        fileChangeId: file.id,
        path: file.path,
        change: "modified",
        digest: `d-${file.id}`,
        linesAdded: 1,
        linesRemoved: 1,
        reviewable: file.reviewable ?? "complete",
      })),
    },
  });
}

/** A whole-set decision on a change set. */
export function decided(runId: string, changeSetId: string, action: "keep" | "undo"): SessionEvent {
  return ev(runId, {
    case: "stigmerFileReviewDecided",
    value: {
      id: `${changeSetId}.decided.${action}`,
      changeSetId,
      scope: "change_set",
      action,
      expectedDigest: `agg-${changeSetId}`,
      origin: "person",
    },
  });
}

/** Which memories a turn recalled. */
export function recalled(runId: string, injectedMemoryIds: readonly string[], selectionActive = true): SessionEvent {
  return ev(runId, {
    case: "stigmerMemoryRecalled",
    value: { id: `${runId}.memory`, selectionActive, injectedMemoryIds: [...injectedMemoryIds], embeddingModel: "text-embedding-3-small" },
  });
}

/** A line the platform added to a turn. */
export function note(runId: string, index: number, line: string): SessionEvent {
  return ev(runId, { case: "stigmerHarnessNote", value: { id: `${runId}.root.n${index}`, text: line } });
}

/** A compaction of a turn's context. */
export function compaction(runId: string, id: string): SessionEvent {
  return ev(runId, { case: "agentThreadContextCompacted", value: { id, processedAt: SAMPLE_INSTANT } });
}

/** A turn's run record: its spec, phase, stamps and files, completed by default. */
export function runOf(
  id: string,
  init: { readonly spec?: MessageInitShape<typeof RunSpecSchema>; readonly status?: MessageInitShape<typeof RunStatusSchema> } = {},
): Run {
  return create(RunSchema, {
    metadata: { id },
    spec: create(RunSpecSchema, { target: { case: "sessionId", value: "ses_1" }, message: `message ${id}`, ...init.spec }),
    status: create(RunStatusSchema, { phase: RunPhase.RUN_COMPLETED, ...init.status }),
  });
}

/** A live preview opening: an agent message (or thinking) still being produced, under its stored id. */
export function previewStart(id: string, type: "agent.message" | "agent.thinking" = "agent.message"): StreamSessionEventsResponse {
  return create(StreamSessionEventsResponseSchema, { frame: { case: "eventStart", value: { event: { id, type } } } });
}

/** A live preview's next fragment of text. */
export function previewDelta(eventId: string, fragment: string): StreamSessionEventsResponse {
  return create(StreamSessionEventsResponseSchema, {
    frame: { case: "eventDelta", value: { eventId, delta: { type: "content_delta", content: { type: "text", text: fragment } } } },
  });
}

/** One turn of a {@link conversation}: its message, mode, reply, phase, and events between. */
export interface TurnFixture {
  readonly id: string;
  /** The person's message (`spec.message` too). Defaults to "Hello". */
  readonly message?: string;
  /** The turn's phase. Defaults to `completed`; `running` writes no end. */
  readonly phase?: TurnPhase;
  readonly mode?: InteractionMode;
  /** The agent's first message; "" for none. Defaults to "Hi there!". */
  readonly reply?: string;
  readonly error?: string;
  /** Events between the reply and the turn's phase. */
  readonly extra?: readonly SessionEvent[];
}

/** A turn's events, in log order. */
export function turnEventsOf(t: TurnFixture): SessionEvent[] {
  const phase = t.phase ?? "completed";
  return [
    user(t.id, t.message ?? "Hello"),
    status(t.id, "running"),
    ...(t.reply === "" ? [] : [said(t.id, 0, t.reply ?? "Hi there!")]),
    ...(t.extra ?? []),
    ...(phase === "running" ? [] : [status(t.id, phase, { error: t.error ?? "" })]),
  ];
}

/** A turn's run record. */
export function runFor(t: TurnFixture): Run {
  return runOf(t.id, {
    spec: { message: t.message ?? "Hello", interactionMode: t.mode ?? InteractionMode.UNSPECIFIED },
    status: { error: t.error ?? "" },
  });
}

/** The turns and runs of a conversation of `fixtures`, in order. */
export function conversation(...fixtures: TurnFixture[]): { turns: readonly Turn[]; runs: Run[] } {
  return { turns: turnsOf(...fixtures.map(turnEventsOf)), runs: fixtures.map(runFor) };
}
