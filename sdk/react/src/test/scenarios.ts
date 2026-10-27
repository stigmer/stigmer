// The scenario catalogue: the everyday states a conversation passes through,
// each named and complete, so every surface that draws a conversation (the
// terminal kit's frames, the CLI's run renderers, the browser views) is
// pinned against the same states instead of each suite inventing its own.
//
// Two layers. A scenario is headless data: its session events, numbered in
// log order, and their `foldSession` result, which the CLI's renderers take
// as they are. `conversationOf` adapts one to the conversation hook's whole
// return shape for the views that read the hook; it is typed against
// `UseSessionConversationReturn` without a cast, so a field the hook gains
// fails here at typecheck rather than reaching a view as `undefined`. Its
// actions are inert: a frame test renders a state, it never drives the hook.
//
// Every event is stamped from SAMPLE_INSTANT (samples.ts), so nothing reads
// the clock; a view that does (a running subagent's duration) is pinned by
// its test's fake clock. The builders here cover what `samples` does not yet
// (a subagent's thread, a review set) with `create(SessionEventSchema)`.
import { create, type MessageInitShape } from "@bufbuild/protobuf";
import type { Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import type { Session } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import {
  SessionEventSchema,
  type SessionEvent,
} from "@stigmer/apis/ai/stigmer/agentic/session/v1/event_pb";
import type { FileChangeSet } from "@stigmer/apis/ai/stigmer/agentic/run/v1/filereview_pb";
import type { FileReviewSet, SessionFold, ToolUse, Turn, TurnPhase } from "@stigmer/client";
import type { UseSessionConversationReturn } from "../session/useSessionConversation.js";
import type { UseSessionUsageReturn } from "../session/useSessionUsage.js";
import { samples, sampleInstant } from "./samples.js";

/** The catalogue's states, in the order a conversation meets them. */
export const SCENARIO_NAMES = [
  "loading",
  "load-failed",
  "empty",
  "streaming",
  "tools",
  "approval",
  "file-review",
  "subagent-running",
  "subagent-finished",
  "failed",
  "completed",
  "markdown",
] as const;

/** One of the catalogue's states. */
export type ScenarioName = (typeof SCENARIO_NAMES)[number];

/** What the session's usage report says, in the few figures the surfaces show. */
export interface ScenarioUsage {
  readonly totalTokens: number;
  readonly llmCallCount: number;
  readonly model: string;
  readonly workingSeconds: number;
}

/** One named state of a conversation: its events, their fold, its runs, and how its load went. */
export interface Scenario {
  readonly name: ScenarioName;
  /** The state in a few words, as a reader of a frame would say it. */
  readonly title: string;
  /** The session, or null while it loads. */
  readonly session: Session | null;
  /** The session's events in log order, numbered from 1. */
  readonly events: readonly SessionEvent[];
  /** The events folded, as the conversation hooks hold them. */
  readonly fold: SessionFold;
  /** One run per turn, in the turn's phase. */
  readonly runs: readonly Run[];
  /** True while the session and its runs load. */
  readonly loading: boolean;
  /** Why the session could not load, or null. */
  readonly loadError: Error | null;
  /** The session's usage report, or undefined when it has none. */
  readonly usage: ScenarioUsage | undefined;
}

const RUN_ID = samples.run().metadata!.id;
const SESSION_ID = samples.session().metadata!.id;

type EventInit = MessageInitShape<typeof SessionEventSchema>["event"];

/** An event of the demo session, filed under the demo run and a thread ("" for the primary). */
function event(init: EventInit, threadId = ""): SessionEvent {
  return create(SessionEventSchema, { sessionId: SESSION_ID, runId: RUN_ID, threadId, event: init });
}

/** A tool use that waits for a person: its use, with permission `ask`, and the ask. */
function askEvents(name: string, input: Record<string, string>, argsPreview: string): SessionEvent[] {
  const id = `${RUN_ID}.tc-${name}`;
  return [
    samples.toolUseEvent(name, input, { id, evaluatedPermission: "ask" }),
    samples.permissionAskedEvent(id, { argsPreview }),
  ];
}

/** A subagent's thread, opened by its `task` tool use, with what it did and, unless it runs, its reply. */
function threadEvents(taskId: string, state: "running" | "completed", reply: string): SessionEvent[] {
  const events = [
    event({ case: "sessionThreadCreated", value: { id: `${taskId}.created`, sessionThreadId: taskId, agentName: "researcher" } }),
    event({
      case: "agentThreadMessageSent",
      value: { id: `${taskId}.sent`, toSessionThreadId: taskId, content: [{ type: "text", text: "Find where invoices are rounded" }] },
    }),
    samples.agentMessageEvent("Searching the billing module.", { threadId: taskId, id: `${taskId}.m0` }),
    samples.toolUseEvent("grep", { pattern: "round(" }, { threadId: taskId, id: `${taskId}.grep` }),
  ];
  if (state === "completed") {
    events.push(
      event({
        case: "agentThreadMessageReceived",
        value: { id: `${taskId}.received`, fromSessionThreadId: taskId, content: [{ type: "text", text: reply }] },
      }),
      event({ case: "sessionThreadStatusIdle", value: { id: `${taskId}.idle`, sessionThreadId: taskId, stopReason: { type: "end_turn" } } }),
    );
  }
  return events;
}

/** A review set's `stigmer.file_review.changes`: two edited files, both undecided. */
function reviewEvent(): SessionEvent {
  const file = (id: string, path: string, change: string, linesAdded: number, linesRemoved: number) => ({
    fileChangeId: id,
    path,
    previousPath: "",
    change,
    digest: `fd-${id}`,
    linesAdded,
    linesRemoved,
    reviewable: "complete",
  });
  return event({
    case: "stigmerFileReviewChanges",
    value: {
      id: `${RUN_ID}.review.cs-1`,
      changeSetId: "cs-1",
      aggregateDigest: "agg-1",
      files: [file("f1", "src/billing/invoice.ts", "modified", 12, 4), file("f2", "src/billing/rounding.ts", "added", 30, 0)],
    },
  });
}

/** The events with their log places (`seq`) numbered 1.. in order, as the fold reads them. */
function numbered(events: readonly SessionEvent[]): SessionEvent[] {
  return events.map((e, index) => ({ ...e, seq: BigInt(index + 1) }));
}

const RUN_PHASES: Readonly<Record<TurnPhase, RunPhase>> = {
  pending: RunPhase.RUN_PENDING,
  running: RunPhase.RUN_IN_PROGRESS,
  waiting: RunPhase.RUN_WAITING_FOR_APPROVAL,
  paused: RunPhase.RUN_PAUSED,
  completed: RunPhase.RUN_COMPLETED,
  failed: RunPhase.RUN_FAILED,
  cancelled: RunPhase.RUN_CANCELLED,
  terminated: RunPhase.RUN_TERMINATED,
};

const ASK_MESSAGE = "Rename the rounding helper and update its callers.";
const MARKDOWN_REPLY = [
  "## What changed",
  "",
  "Invoices now round **once**, at the total, instead of per line:",
  "",
  "1. `lineTotal` keeps full precision.",
  "2. `invoiceTotal` rounds half-even to the cent.",
  "   - A credit note uses the same rule.",
  "",
  "```ts",
  "export function invoiceTotal(lines: readonly Line[]): Cents {",
  "  return roundHalfEven(lines.reduce((sum, line) => sum + lineTotal(line), 0));",
  "}",
  "```",
  "",
  "| Case | Before | After |",
  "| --- | --- | --- |",
  "| 3 × 0.335 | 1.02 | 1.01 |",
  "| 1 × 9.995 | 10.00 | 10.00 |",
].join("\n");

/** Builds a loaded scenario from its events, its one turn's run phase and its usage. */
function loaded(
  name: ScenarioName,
  title: string,
  events: readonly SessionEvent[],
  usage?: ScenarioUsage,
): Scenario {
  const ordered = numbered(events);
  const fold = samples.fold(events);
  const runs = fold.turns.map((turn) =>
    samples.run({
      id: turn.runId,
      sessionId: SESSION_ID,
      phase: RUN_PHASES[turn.status?.phase ?? "pending"],
      message: turn.userMessage?.text ?? "",
    }),
  );
  return {
    name,
    title,
    session: samples.session({ subject: "Fix invoice rounding" }),
    events: ordered,
    fold,
    runs,
    loading: false,
    loadError: null,
    usage,
  };
}

function build(name: ScenarioName): Scenario {
  const message = "Invoices are off by a cent. Can you fix the rounding?";
  switch (name) {
    case "loading":
      return {
        name,
        title: "the session is loading",
        session: null,
        events: [],
        fold: samples.fold([]),
        runs: [],
        loading: true,
        loadError: null,
        usage: undefined,
      };
    case "load-failed":
      return {
        name,
        title: "the session could not load: the server refused the connection",
        session: null,
        events: [],
        fold: samples.fold([]),
        runs: [],
        loading: false,
        loadError: new Error("[unavailable] connect ECONNREFUSED 127.0.0.1:7234"),
        usage: undefined,
      };
    case "empty":
      return loaded(name, "a new session with no turns", []);
    case "streaming":
      return loaded(name, "the agent's reply is streaming", samples.turnEvents({ message, phase: "running", reply: "Looking at how invoices are totalled. The rounding happens" }));
    case "tools":
      return loaded(
        name,
        "tool calls: one returned, one still running",
        samples.turnEvents({
          message,
          phase: "running",
          reply: "",
          tools: [
            { name: "read_file", input: { path: "src/billing/invoice.ts" }, result: "export function invoiceTotal(...)" },
            { name: "execute", input: { command: "npm test -- billing" } },
          ],
        }),
      );
    case "approval":
      return loaded(name, "a tool call waits for approval", [
        ...samples.turnEvents({ message: ASK_MESSAGE, phase: "running", reply: "" }),
        ...askEvents("write_file", { path: "src/billing/rounding.ts" }, '{"path":"src/billing/rounding.ts"}'),
        samples.runStatusEvent("waiting"),
      ]);
    case "file-review":
      return loaded(name, "the turn ended and its file edits wait for review", [
        ...samples.turnEvents({ message, phase: "running", reply: "I changed two files; review them before keeping." }),
        reviewEvent(),
        samples.runStatusEvent("completed"),
      ]);
    case "subagent-running": {
      const taskId = `${RUN_ID}.tc-task`;
      return loaded(name, "a subagent is working", [
        ...samples.turnEvents({ message, phase: "running", reply: "" }),
        samples.toolUseEvent("task", { description: "find the rounding code" }, { id: taskId }),
        ...threadEvents(taskId, "running", ""),
      ]);
    }
    case "subagent-finished": {
      const taskId = `${RUN_ID}.tc-task`;
      return loaded(name, "a subagent finished, with no end time recorded", [
        ...samples.turnEvents({ message, phase: "running", reply: "" }),
        samples.toolUseEvent("task", { description: "find the rounding code" }, { id: taskId }),
        ...threadEvents(taskId, "completed", "Rounding happens per line in lineTotal."),
        samples.agentMessageEvent("The researcher found it; fixing lineTotal next.", { id: `${RUN_ID}.root.m1` }),
      ]);
    }
    case "failed":
      return loaded(name, "the turn failed", [
        ...samples.turnEvents({ message, phase: "running", reply: "" }),
        samples.runStatusEvent("failed", { error: "the model provider refused the request: the API key is invalid" }),
      ]);
    case "completed":
      return loaded(
        name,
        "the turn completed, with usage",
        samples.turnEvents({
          message,
          tools: [{ name: "edit_file", input: { path: "src/billing/invoice.ts" }, result: "1 edit applied" }],
          reply: "Fixed: invoices now round once, at the total.",
        }),
        { totalTokens: 18_432, llmCallCount: 3, model: "claude-sonnet-4-5", workingSeconds: 42 },
      );
    case "markdown":
      return loaded(name, "a long reply in markdown: a heading, lists, code and a table", samples.turnEvents({ message, reply: MARKDOWN_REPLY }));
  }
}

/** Every scenario, by name. Built once; treat them as read-only. */
export const scenarios: Readonly<Record<ScenarioName, Scenario>> = {
  loading: build("loading"),
  "load-failed": build("load-failed"),
  empty: build("empty"),
  streaming: build("streaming"),
  tools: build("tools"),
  approval: build("approval"),
  "file-review": build("file-review"),
  "subagent-running": build("subagent-running"),
  "subagent-finished": build("subagent-finished"),
  failed: build("failed"),
  completed: build("completed"),
  markdown: build("markdown"),
};

const NO_IDS: ReadonlySet<string> = new Set();
const NO_ERRORS: ReadonlyMap<string, Error> = new Map();
const NO_CAPTURES: ReadonlyMap<string, FileChangeSet> = new Map();
const NO_ASKS: readonly ToolUse[] = [];
const NO_SETS: readonly FileReviewSet[] = [];

async function inert(): Promise<void> {}
function noop(): void {}

/** The newest turn when it has not ended, as the hook picks its live turn. */
function liveTurnOf(turns: readonly Turn[]): Turn | null {
  const newest = turns.at(-1);
  return newest !== undefined && !newest.ended ? newest : null;
}

/**
 * A scenario as the conversation hook returns it: its turns and runs, the
 * live turn and its asks, the newest turn's undecided review sets, and how
 * the load went. Every action resolves and does nothing.
 */
export function conversationOf(scenario: Scenario): UseSessionConversationReturn {
  const turns = scenario.fold.turns;
  const activeTurn = liveTurnOf(turns);
  const activePhase: TurnPhase | null = activeTurn === null ? null : (activeTurn.status?.phase ?? "pending");
  const activeRun = activeTurn === null ? null : (scenario.runs.find((run) => run.metadata?.id === activeTurn.runId) ?? null);
  const sets = turns.at(-1)?.fileReview ?? NO_SETS;
  return {
    session: scenario.session,
    org: scenario.session?.metadata?.org ?? "demo",
    turns,
    runs: scenario.runs,
    activeTurn,
    activeRun,
    activePhase,
    isStreaming: activeTurn !== null,
    isConnecting: false,
    sendFollowUp: inert,
    canSendFollowUp: activePhase !== "waiting" && activePhase !== "paused",
    isSending: false,
    sendError: null,
    clearSendError: noop,
    retryLastSend: noop,
    moveToCurrentAgentVersion: inert,
    pendingUserMessage: null,
    pendingFiles: null,
    queued: scenario.fold.queued,
    resources: scenario.session?.spec?.resources ?? [],
    plugins: scenario.session?.spec?.plugins ?? [],
    skillRefs: scenario.session?.spec?.skillRefs ?? [],
    asks: activeTurn?.asks ?? NO_ASKS,
    answerToolUse: inert,
    answeringToolUseIds: NO_IDS,
    answerErrors: NO_ERRORS,
    answerError: null,
    clearAnswerError: noop,
    stopBackgroundCommand: inert,
    stoppingBackgroundToolUseIds: NO_IDS,
    stopBackgroundErrors: NO_ERRORS,
    fileReviewSets: sets.filter((set) => set.undecided),
    fileChangeCaptures: NO_CAPTURES,
    fileChangeProgress: undefined,
    reviewFileChanges: inert,
    submittingFileDecisionKeys: NO_IDS,
    fileDecisionErrors: NO_ERRORS,
    clearFileDecisionError: noop,
    fileReviewError: null,
    clearFileReviewError: noop,
    isStoppable: activePhase !== null,
    stop: inert,
    isStopping: false,
    stopError: null,
    isLoading: scenario.loading,
    loadError: scenario.loadError,
    isReconnecting: false,
    connectTimedOut: false,
    isSlow: false,
    liveness: undefined,
    streamError: null,
    reconnectStream: noop,
  };
}

/** A scenario's usage as the session usage hook returns it; empty when it has none. */
export function usageOf(scenario: Scenario): UseSessionUsageReturn {
  const usage = scenario.usage;
  const totalTokens = usage?.totalTokens ?? 0;
  return {
    totalTokens,
    inputTokens: Math.round(totalTokens * 0.8),
    outputTokens: totalTokens - Math.round(totalTokens * 0.8),
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    llmCallCount: usage?.llmCallCount ?? 0,
    workingSeconds: usage?.workingSeconds ?? 0,
    modelBreakdown: [],
    runBreakdown: [],
    servedBy: [],
    primaryModel: usage?.model ?? "",
    primaryProvider: usage === undefined ? "" : "anthropic",
    hasUsage: usage !== undefined,
    isEstimated: false,
  };
}

/** When a scenario's frames are drawn: ninety seconds after its events, so a running duration reads "1m 30s". */
export const SCENARIO_CLOCK = sampleInstant(90_000);
