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
//
// Two states carry what lives beside the events: `busy` the liveness
// preview the stream sends while a turn works (streamed, never stored, so it
// is folded after the events and a page that replays the scenario sends it
// as a frame), and `finished` the Files its turn returned and the routine
// that started the session.
import { create, type JsonObject, type MessageInitShape } from "@bufbuild/protobuf";
import { durationFromMs } from "@bufbuild/protobuf/wkt";
import type { Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import type { Session } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import { SessionStatusSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/status_pb";
import type { File as StigmerFile } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import {
  RunLivenessSchema,
  SessionEventSchema,
  type RunLiveness,
  type SessionEvent,
} from "@stigmer/apis/ai/stigmer/agentic/session/v1/event_pb";
import { StreamSessionEventsResponseSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/io_pb";
import type { FileChangeSet } from "@stigmer/apis/ai/stigmer/agentic/run/v1/filereview_pb";
import { SessionLog, type FileReviewSet, type SessionFold, type ToolUse, type Turn, type TurnPhase } from "@stigmer/client";
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
  "busy",
  "finished",
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
  /**
   * The newest liveness preview the stream sent for the working turn, already
   * in `fold`; undefined when the turn has none or nothing works.
   */
  readonly liveness: RunLiveness | undefined;
  /** The Files the session's turns returned (their outputs folder), oldest first. */
  readonly files: readonly StigmerFile[];
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

/** What a loaded scenario holds beside its events. */
interface Beside {
  readonly usage?: ScenarioUsage;
  readonly liveness?: RunLiveness;
  readonly files?: readonly StigmerFile[];
  readonly session?: Session;
}

/** The events folded, then the liveness preview the stream sent after them. */
function foldWithLiveness(events: readonly SessionEvent[], liveness: RunLiveness | undefined): SessionFold {
  if (liveness === undefined) return samples.fold(events);
  const log = new SessionLog();
  log.apply(numbered(events));
  log.applyFrame(create(StreamSessionEventsResponseSchema, { frame: { case: "stigmerRunLiveness", value: liveness } }));
  return log.snapshot();
}

/**
 * A tool call at `atMs` after the frozen instant and, unless it still runs,
 * its result `tookMs` later. `id` names a second call of the same tool.
 */
function call(name: string, input: JsonObject, atMs: number, result?: string, tookMs = 1_200, id?: string): SessionEvent[] {
  const use = samples.toolUseEvent(name, input, { id: id ?? `${RUN_ID}.tc-${name}`, processedAt: sampleInstant(atMs) });
  if (result === undefined) return [use];
  return [use, samples.toolResultEvent(use.event.value!.id, result, { processedAt: sampleInstant(atMs + tookMs) })];
}

const BUSY_TASK_ID = `${RUN_ID}.tc-task`;
const BUSY_TEST_RUN_ID = `${RUN_ID}.tc-execute-suite`;

/** The busy turn: a to-do list, settled searches, an edit and a test run, a note, then a subagent and the full suite still running. */
function busyEvents(): SessionEvent[] {
  const todos = [
    { content: "Find every place invoices round", status: "completed" },
    { content: "Round once, at the invoice total", status: "completed" },
    { content: "Apply the same rule to credit notes", status: "in_progress" },
    { content: "Add tests for the half-cent cases", status: "pending" },
    { content: "Run the billing suite", status: "pending" },
  ];
  return [
    samples.userMessageEvent("Invoices are off by a cent across the billing module. Find every place that rounds, fix it, and prove it with tests."),
    samples.runStatusEvent("running"),
    ...call("write_todos", { todos }, 3_000, "Updated the to-do list", 200),
    ...call("grep", { pattern: "round(", path: "src/billing" }, 6_000, "src/billing/invoice.ts:41\nsrc/billing/credit-note.ts:18"),
    ...call("read_file", { path: "src/billing/invoice.ts" }, 9_000, "export function invoiceTotal(lines: readonly Line[]) {"),
    ...call("edit_file", { path: "src/billing/invoice.ts" }, 21_000, "1 edit applied", 800),
    ...call("execute", { command: "npm test -- billing/invoice" }, 30_000, "Tests: 12 passed, 12 total", 14_000),
    samples.agentMessageEvent("Invoice totals now round once. A researcher is mapping where credit notes round while the full suite runs.", {
      id: `${RUN_ID}.root.m1`,
      processedAt: sampleInstant(48_000),
    }),
    samples.toolUseEvent("task", { description: "map where credit notes round" }, { id: BUSY_TASK_ID, processedAt: sampleInstant(52_000) }),
    ...threadEvents(BUSY_TASK_ID, "running", ""),
    ...call("execute", { command: "npm test -- billing" }, 60_000, undefined, 0, BUSY_TEST_RUN_ID),
  ];
}

/** What the busy turn had open when the stream last said: the subagent for 38s, the suite for 30s. */
const BUSY_LIVENESS: RunLiveness = create(RunLivenessSchema, {
  runId: RUN_ID,
  operations: [
    { toolUseId: BUSY_TASK_ID, name: "task", elapsed: durationFromMs(38_000) },
    { toolUseId: BUSY_TEST_RUN_ID, name: "execute", elapsed: durationFromMs(30_000) },
  ],
});

/** The Files the finished turn returned: the audit it wrote and the cases it found. */
const FINISHED_FILES: readonly StigmerFile[] = [
  samples.outputFile("invoice-audit.md", { mimeType: "text/markdown", sizeBytes: 4_210n }),
  samples.outputFile("rounding-cases.csv", { mimeType: "text/csv", sizeBytes: 1_830n }),
];

/** The finished turn: read, edit, write the two Files, answer. */
function finishedEvents(): SessionEvent[] {
  return [
    samples.userMessageEvent("Audit last month's invoices for rounding errors and fix what you find."),
    samples.runStatusEvent("running"),
    ...call("read_file", { path: "src/billing/invoice.ts" }, 4_000, "export function invoiceTotal(lines: readonly Line[]) {"),
    ...call("edit_file", { path: "src/billing/invoice.ts" }, 18_000, "1 edit applied", 800),
    ...call("write_file", { path: "outputs/invoice-audit.md" }, 52_000, "Wrote 4.1 KB", 300),
    ...call("write_file", { path: "outputs/rounding-cases.csv" }, 60_000, "Wrote 1.8 KB", 300, `${RUN_ID}.tc-write_file-2`),
    samples.agentMessageEvent(
      "Fourteen invoices were a cent off, all from rounding each line before the total. `invoiceTotal` now rounds once, at the total. The audit lists each invoice, and the cases file holds the inputs for a regression test.",
      { processedAt: sampleInstant(73_000) },
    ),
    samples.runStatusEvent("completed", { processedAt: sampleInstant(74_000) }),
  ];
}

/** The session a nightly routine started. */
function routineSession(): Session {
  const session = samples.session({ subject: "Nightly billing check" });
  session.status = create(SessionStatusSchema, { routineId: "rtn-00000000-0000-0000-0000-000000000001" });
  return session;
}

/** Builds a loaded scenario from its events, its one turn's run phase and what it holds beside them. */
function loaded(name: ScenarioName, title: string, events: readonly SessionEvent[], beside: Beside = {}): Scenario {
  const ordered = numbered(events);
  const fold = foldWithLiveness(events, beside.liveness);
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
    session: beside.session ?? samples.session({ subject: "Fix invoice rounding" }),
    events: ordered,
    fold,
    runs,
    loading: false,
    loadError: null,
    usage: beside.usage,
    liveness: beside.liveness,
    files: beside.files ?? [],
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
        liveness: undefined,
        files: [],
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
        liveness: undefined,
        files: [],
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
        { usage: { totalTokens: 18_432, llmCallCount: 3, model: "claude-sonnet-4-5", workingSeconds: 42 } },
      );
    case "markdown":
      return loaded(name, "a long reply in markdown: a heading, lists, code and a table", samples.turnEvents({ message, reply: MARKDOWN_REPLY }));
    case "busy":
      return loaded(
        name,
        "a long turn at work: two of five to-dos done, commands and an edit settled, a subagent and the test run still going",
        busyEvents(),
        { liveness: BUSY_LIVENESS },
      );
    case "finished":
      return loaded(
        name,
        "a finished session a routine started: an edit, two files returned and the answer, with usage",
        finishedEvents(),
        {
          usage: { totalTokens: 41_210, llmCallCount: 7, model: "claude-sonnet-4-5", workingSeconds: 74 },
          files: FINISHED_FILES,
          session: routineSession(),
        },
      );
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
  busy: build("busy"),
  finished: build("finished"),
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
