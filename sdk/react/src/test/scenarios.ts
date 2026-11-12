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
//
// Beside the states, whole stories: the scripted turn and the ledger turn
// the docs play, and the step turns, one per family of step the session
// viewer draws (a connected app's tools, twenty Files made, every file step,
// every shell step). A step turn is a story, not a state, so the surfaces
// pinned against every state (the terminal's frames, the CLI's goldens) do
// not draw it; the gallery draws it in the session view. The shell turn
// carries what its running commands printed so far, streamed like the
// liveness preview.
import { create, type JsonObject, type MessageInitShape } from "@bufbuild/protobuf";
import { durationFromMs } from "@bufbuild/protobuf/wkt";
import type { Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { StreamingUsageSummarySchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/usage_pb";
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
import type { UseSessionConversationReturn } from "@stigmer/react-core";
import type { UseSessionUsageReturn } from "@stigmer/react-core";
import { samples, sampleInstant } from "@stigmer/react-core/test";

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

/**
 * A story the catalogue tells beside its states, whole: the scripted turn the
 * docs play, the first agent job's ledger turn, or one of the step turns
 * ({@link STEP_STORY_NAMES}).
 */
export type StoryName = "scripted-turn" | "ledger-turn" | StepStoryName | EndingStoryName;

/** What the session's usage report says, in the few figures the surfaces show. */
export interface ScenarioUsage {
  readonly totalTokens: number;
  readonly llmCallCount: number;
  readonly model: string;
  readonly workingSeconds: number;
}

/** One named state of a conversation: its events, their fold, its runs, and how its load went. */
export interface Scenario {
  readonly name: ScenarioName | StoryName;
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
  /**
   * What the working turn's running commands printed so far, as the stream
   * sent it (streamed, never stored), already in `fold`; a page that replays
   * the scenario sends each as a frame after the events. Absent when nothing
   * printed.
   */
  readonly outputs?: readonly ToolOutput[];
}

/** A fragment of a running tool's output, as the stream sends it. */
export interface ToolOutput {
  readonly toolUseId: string;
  readonly delta: string;
}

const RUN_ID = samples.run().metadata!.id;
const SESSION_ID = samples.session().metadata!.id;

type EventInit = MessageInitShape<typeof SessionEventSchema>["event"];

/** An event of the demo session, filed under the demo run and a thread ("" for the primary). */
function event(init: EventInit, threadId = "", runId: string = RUN_ID): SessionEvent {
  return create(SessionEventSchema, { sessionId: SESSION_ID, runId, threadId, event: init });
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
  /** The runner's estimated cost of each turn's run, in USD (display only). */
  readonly estimatedCostUsd?: number;
  /** What running commands printed so far, streamed after the events. */
  readonly outputs?: readonly ToolOutput[];
}

/** The events folded, then the liveness preview and the running commands' output the stream sent after them. */
function foldWithLiveness(events: readonly SessionEvent[], liveness: RunLiveness | undefined, outputs: readonly ToolOutput[] = []): SessionFold {
  if (liveness === undefined && outputs.length === 0) return samples.fold(events);
  const log = new SessionLog();
  log.apply(numbered(events));
  if (liveness !== undefined) {
    log.applyFrame(create(StreamSessionEventsResponseSchema, { frame: { case: "stigmerRunLiveness", value: liveness } }));
  }
  for (const output of outputs) log.applyFrame(samples.toolOutputDeltaFrame(output.toolUseId, output.delta));
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
    ...call("write_file", { path: "/.stigmer/outputs/invoice-audit.md" }, 52_000, "Wrote 4.1 KB", 300),
    ...call("write_file", { path: "/.stigmer/outputs/rounding-cases.csv" }, 60_000, "Wrote 1.8 KB", 300, `${RUN_ID}.tc-write_file-2`),
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
  session.status = create(SessionStatusSchema, { routineId: "rtn_00000000000000000000000001" });
  return session;
}

/** Builds a loaded scenario from its events, its one turn's run phase and what it holds beside them. */
function loaded(name: ScenarioName | StoryName, title: string, events: readonly SessionEvent[], beside: Beside = {}): Scenario {
  const ordered = numbered(events);
  const fold = foldWithLiveness(events, beside.liveness, beside.outputs);
  const runs = fold.turns.map((turn) =>
    samples.run({
      id: turn.runId,
      sessionId: SESSION_ID,
      phase: RUN_PHASES[turn.status?.phase ?? "pending"],
      message: turn.userMessage?.text ?? "",
    }),
  );
  if (beside.estimatedCostUsd !== undefined) {
    for (const run of runs) {
      if (run.status !== undefined) run.status.streamingUsage = create(StreamingUsageSummarySchema, { estimatedCostUsd: beside.estimatedCostUsd });
    }
  }
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
    ...(beside.outputs === undefined ? {} : { outputs: beside.outputs }),
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
          estimatedCostUsd: 0.42,
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

// ---------------------------------------------------------------------------
// The scripted turn: one short turn the docs play, in the browser and in the
// terminal
// ---------------------------------------------------------------------------

/** What a docs reader is offered to send, and what the terminal recording types. */
export const SCRIPTED_MESSAGE = "What changed in billing this week?";

/** The command the scripted turn asks to run. */
const SCRIPTED_COMMAND = "git log --oneline -3 -- src/billing";

/**
 * The scripted turn, in the parts a reader's acts choose between: the turn up
 * to the ask, then what follows an approval, a denial or a stop. Every event
 * carries its time from the turn's start (`processedAt`, from
 * the demo's frozen instant), which a recording paces its frames by and a live
 * page replaces with its own clock as it sends each one.
 */
export interface ScriptedTurn {
  /** The person's message, the turn starting, two file reads, the command it asks to run and the ask; the turn then waits. */
  readonly untilAsk: readonly SessionEvent[];
  /** After the person allows the command: their answer, the command's output, the answer and the turn's end. */
  readonly approved: readonly SessionEvent[];
  /** After the person denies it: their answer, the agent's reply from the two files alone, and the turn's end. */
  readonly denied: readonly SessionEvent[];
  /** After the person stops the turn: its end, stopped by them (stop cause `user`). */
  readonly stopped: readonly SessionEvent[];
}

/**
 * The scripted turn for `message`, filed under `runId` in the demo session:
 * the agent reads the changelog and the invoice module, asks before it runs
 * `git log`, and answers. One story, played by the docs' live demo
 * (test/visual's scripted server) and the terminal kit's recordings, so the
 * browser and the terminal show the same turn.
 */
export function scriptedTurn(message: string = SCRIPTED_MESSAGE, runId: string = RUN_ID): ScriptedTurn {
  const o = (atMs: number, id?: string) => ({ runId, processedAt: sampleInstant(atMs), ...(id === undefined ? {} : { id }) });
  const read = (path: string, result: string, atMs: number, id: string): SessionEvent[] => {
    const use = samples.toolUseEvent("read_file", { path }, { ...o(atMs), id });
    return [use, samples.toolResultEvent(id, result, o(atMs + 600))];
  };
  const askId = `${runId}.tc-execute`;
  return {
    untilAsk: [
      samples.userMessageEvent(message, o(0)),
      samples.runStatusEvent("running", o(400)),
      ...read("CHANGELOG.md", "## This week\n- Invoices round once, at the total\n- Credit notes follow the same rule", 1_200, `${runId}.tc-read_file`),
      ...read(
        "src/billing/invoice.ts",
        "export function invoiceTotal(lines: readonly Line[]): Cents {\n  return roundHalfEven(lines.reduce((sum, line) => sum + lineTotal(line), 0));\n}",
        2_600,
        `${runId}.tc-read_file-2`,
      ),
      samples.agentMessageEvent("The changelog names two changes. I'd like to check the commits behind them.", o(4_000, `${runId}.root.m0`)),
      samples.toolUseEvent("execute", { command: SCRIPTED_COMMAND }, { ...o(4_800), id: askId, evaluatedPermission: "ask" }),
      samples.permissionAskedEvent(askId, { ...o(4_900), argsPreview: JSON.stringify({ command: SCRIPTED_COMMAND }) }),
      samples.runStatusEvent("waiting", o(5_000)),
    ],
    approved: [
      event({ case: "userToolConfirmation", value: { id: `${askId}.c`, toolUseId: askId, result: "allow", processedAt: sampleInstant(8_000) } }, "", runId),
      samples.runStatusEvent("running", { ...o(8_100), id: `${runId}.status.running-2` }),
      samples.toolResultEvent(
        askId,
        "a41c9e2 Round credit notes once, at the total\n7d03b51 Round invoices once, at the total\n19f2e88 Add half-cent test cases",
        o(9_300),
      ),
      samples.agentMessageEvent(
        "Two changes this week. Invoices now round once, at the total, instead of per line (7d03b51), and credit notes follow the same rule (a41c9e2). A third commit adds tests for the half-cent cases.",
        o(10_500, `${runId}.root.m1`),
      ),
      samples.runStatusEvent("completed", o(11_000)),
    ],
    denied: [
      event(
        { case: "userToolConfirmation", value: { id: `${askId}.c`, toolUseId: askId, result: "deny", denyMessage: "", processedAt: sampleInstant(8_000) } },
        "",
        runId,
      ),
      samples.runStatusEvent("running", { ...o(8_100), id: `${runId}.status.running-2` }),
      samples.agentMessageEvent(
        "I won't run it. From the changelog alone: invoices now round once, at the total, and credit notes follow the same rule.",
        o(9_000, `${runId}.root.m1`),
      ),
      samples.runStatusEvent("completed", o(9_500)),
    ],
    stopped: [samples.runStatusEvent("cancelled", { ...o(8_000), stopCause: "user" })],
  };
}

/**
 * The scripted turn as a story, whole: the person asks what changed, the
 * agent reads two files, asks before it runs `git log`, is allowed, and
 * answers. The terminal kit's recordings draw it event by event
 * ({@link upTo}), so a docs reader watches the turn the live demos play.
 */
export function scriptedStory(message: string = SCRIPTED_MESSAGE): Scenario {
  const turn = scriptedTurn(message);
  return loaded("scripted-turn", "the scripted turn: two reads, an ask allowed, the answer", [...turn.untilAsk, ...turn.approved]);
}

/**
 * `scenario` as it stood after its first `n` events: their fold, each
 * turn's run in the phase it had reached, and the scenario's session.
 * What lives beside the events (usage, the liveness preview, the Files)
 * is kept only when `n` covers them all, since it belongs to the whole.
 * Built through the catalogue's one assembly, so a part-way state is folded
 * exactly as a whole one is.
 */
export function upTo(scenario: Scenario, n: number): Scenario {
  if (!Number.isInteger(n) || n < 0 || n > scenario.events.length) {
    throw new RangeError(`upTo: ${scenario.name} has ${scenario.events.length} events; ${n} is not a count of them`);
  }
  const whole = n === scenario.events.length;
  return loaded(scenario.name, scenario.title, scenario.events.slice(0, n), {
    ...(scenario.session === null ? {} : { session: scenario.session }),
    ...(whole ? { usage: scenario.usage, liveness: scenario.liveness, files: scenario.files, outputs: scenario.outputs } : {}),
  });
}

// ---------------------------------------------------------------------------
// The ledger turn: the Getting Started job, as the docs' front page plays it
// ---------------------------------------------------------------------------

/** What the quickstart's `stigmer run` sends with the customer's ledger (docs/getting-started/quickstart.mdx). */
export const LEDGER_MESSAGE = "Review this quarter's ledger.";

/** The ledger the quickstart has the reader make, as the Agent reads it from the conversation's uploads. */
const LEDGER_CSV = [
  "account,budget,actual",
  "Revenue,120000,131500",
  "Cost of goods sold,48000,55200",
  "Salaries,36000,36400",
  "Marketing,9000,14100",
  "Software,4000,3900",
  "Travel,3000,1200",
].join("\n");

/** The report the ledger turn hands back: the quickstart's sample report, 696 bytes. */
const LEDGER_REPORT: StigmerFile = samples.outputFile("variance-report.md", { mimeType: "text/markdown", sizeBytes: 696n });

/**
 * The ledger turn, filed under `runId`: the person hands over the ledger
 * with the quickstart's message, the Agent reads it from its uploads folder,
 * writes the variance report to its outputs folder, says which accounts it
 * flagged, and the turn completes 38 seconds after it began. No ask: the
 * quickstart's Agent has no shell, so nothing waits for a yes.
 */
export function ledgerTurn(runId: string = RUN_ID): SessionEvent[] {
  const o = (atMs: number, id?: string) => ({ runId, processedAt: sampleInstant(atMs), ...(id === undefined ? {} : { id }) });
  const readId = `${runId}.tc-read_file`;
  const writeId = `${runId}.tc-write_file`;
  return [
    samples.userMessageEvent(LEDGER_MESSAGE, o(0)),
    samples.runStatusEvent("running", o(400)),
    samples.toolUseEvent("read_file", { path: "/.stigmer/uploads/ledger.csv" }, { ...o(1_500), id: readId }),
    samples.toolResultEvent(readId, LEDGER_CSV, o(2_100)),
    samples.toolUseEvent("write_file", { path: "/.stigmer/outputs/variance-report.md" }, { ...o(31_000), id: writeId }),
    samples.toolResultEvent(writeId, "Wrote 696 B", o(31_300)),
    samples.agentMessageEvent(
      "Three accounts are flagged. Marketing ran 56.7% over budget and cost of goods sold 15% over, while travel came in 60% under. The report lists every account, flagged ones first.",
      o(36_000, `${runId}.root.m0`),
    ),
    samples.runStatusEvent("completed", o(38_000)),
  ];
}

/**
 * The ledger turn as a story, whole, with the report it returned among the
 * session's Files. The terminal kit's `first-job` recording draws it event
 * by event ({@link upTo}), so the docs' front page plays the quickstart's
 * own job.
 */
export function ledgerStory(): Scenario {
  return loaded("ledger-turn", "the first agent job: the ledger read, the report written, the flagged accounts named", ledgerTurn(), {
    session: samples.session({ subject: "Quarterly variance report" }),
    files: [LEDGER_REPORT],
  });
}

// ---------------------------------------------------------------------------
// The step turns: one turn per family of step the session viewer draws, so
// every kind of step has a picture: a connected app's tools, a turn that made
// twenty Files, every file step, and every shell step
// ---------------------------------------------------------------------------

/** The step turns, in the order the gallery draws them. */
export const STEP_STORY_NAMES = ["mcp-turn", "many-files", "file-steps", "shell-steps"] as const;

/** One of the step turns. */
export type StepStoryName = (typeof STEP_STORY_NAMES)[number];

/** A call's use and result in the demo run: `atMs` after the frozen instant, returning `tookMs` later, as `id` when one tool is called twice. */
interface Step {
  readonly name: string;
  readonly input: JsonObject;
  readonly atMs: number;
  readonly result: string;
  readonly tookMs?: number;
  readonly id?: string;
  readonly isError?: boolean;
  readonly mcpServerName?: string;
}

function step({ name, input, atMs, result, tookMs = 1_000, id, isError = false, mcpServerName }: Step): SessionEvent[] {
  const toolUseId = id ?? `${RUN_ID}.tc-${name}`;
  const use = samples.toolUseEvent(name, input, {
    id: toolUseId,
    processedAt: sampleInstant(atMs),
    ...(mcpServerName === undefined ? {} : { mcpServerName }),
  });
  const result_ = samples.toolResultEvent(toolUseId, result, {
    processedAt: sampleInstant(atMs + tookMs),
    isError,
    mcp: mcpServerName !== undefined,
  });
  return [use, result_];
}

/** The connected app the MCP turn files its issue in. */
const ISSUE_TRACKER = "issue-tracker";

/** A connected app's tools: the agent searches the issue tracker, files an issue, and says so. */
function mcpTurn(): SessionEvent[] {
  return [
    samples.userMessageEvent("File an issue for the credit-note rounding so the billing team picks it up."),
    samples.runStatusEvent("running"),
    ...step({
      name: "search_issues",
      input: { query: "credit note rounding", state: "open" },
      atMs: 3_000,
      tookMs: 2_000,
      result: "No open issues match.",
      mcpServerName: ISSUE_TRACKER,
    }),
    ...step({
      name: "create_issue",
      input: { title: "Credit notes round per line", team: "billing", labels: ["bug", "rounding"], api_token: "itk_live_2b9f7c" },
      atMs: 7_000,
      tookMs: 4_000,
      result: "Created BILL-219",
      mcpServerName: ISSUE_TRACKER,
    }),
    samples.agentMessageEvent("Filed as **BILL-219** in the billing team's tracker, with the two invoices that show the drift.", {
      processedAt: sampleInstant(16_000),
    }),
    samples.runStatusEvent("completed", { processedAt: sampleInstant(18_000) }),
  ];
}

/** The twenty Files the long audit made: a summary, the cases, an audit per invoice that was off, and the month's invoices. */
const MANY_FILES: readonly StigmerFile[] = [
  samples.outputFile("invoice-audit.md", { mimeType: "text/markdown", sizeBytes: 4_210n }),
  samples.outputFile("rounding-cases.csv", { mimeType: "text/csv", sizeBytes: 1_830n }),
  samples.outputFile("credit-note-audit.md", { mimeType: "text/markdown", sizeBytes: 3_280n }),
  samples.outputFile("half-cent-cases.csv", { mimeType: "text/csv", sizeBytes: 920n }),
  samples.outputFile("invoices-2026-10.pdf", { mimeType: "application/pdf", sizeBytes: 421_900n }),
  ...[1042, 1057, 1063, 1071, 1088, 1093, 1101, 1114, 1120, 1136, 1149, 1152].map((invoice) =>
    samples.outputFile(`inv-${invoice}-audit.md`, { mimeType: "text/markdown", sizeBytes: 1_400n + BigInt(invoice % 7) * 90n }),
  ),
  ...["credit-notes-2026-10.pdf", "adjustments-2026-10.pdf", "statements-2026-10.pdf"].map((name) =>
    samples.outputFile(name, { mimeType: "application/pdf", sizeBytes: 188_400n }),
  ),
];

/** The long audit: it reads the billing code, edits three files, runs the tests twice and writes its twenty Files. */
function manyFilesTurn(): SessionEvent[] {
  const reads = ["src/billing/invoice.ts", "src/billing/credit-note.ts", "src/billing/line.ts", "src/billing/rounding.ts"].flatMap((path, index) =>
    step({ name: "read_file", input: { path }, atMs: 4_000 + index * 2_000, result: "export function total(lines: readonly Line[]) {", id: `${RUN_ID}.tc-read-${index}` }),
  );
  const edits = [
    { path: "src/billing/invoice.ts", old_string: "sum + roundCents(lineTotal(line))", new_string: "sum + lineTotal(line)" },
    { path: "src/billing/credit-note.ts", old_string: "roundCents(line.amount)", new_string: "line.amount" },
  ].flatMap((input, index) => step({ name: "edit_file", input, atMs: 30_000 + index * 4_000, result: "1 edit applied", id: `${RUN_ID}.tc-edit-${index}` }));
  const writes = MANY_FILES.flatMap((file, index) =>
    step({
      name: "write_file",
      input: { path: `/.stigmer/outputs/${file.spec!.filename}`, content: `# ${file.spec!.filename}\n` },
      atMs: 120_000 + index * 9_000,
      tookMs: 300,
      result: "Wrote the file",
      id: `${RUN_ID}.tc-write-${index}`,
    }),
  );
  return [
    samples.userMessageEvent("Audit every October invoice for rounding errors, fix the code, and write an audit file for each invoice that was off."),
    samples.runStatusEvent("running"),
    ...reads,
    ...edits,
    ...step({
      name: "write_file",
      input: { path: "src/billing/rounding.test.ts", content: 'import { roundHalfEven } from "./rounding";\n' },
      atMs: 40_000,
      tookMs: 300,
      result: "Wrote the file",
      id: `${RUN_ID}.tc-write-test`,
    }),
    ...step({ name: "execute", input: { command: "npm test -- billing" }, atMs: 50_000, tookMs: 21_000, result: "Tests: 19 passed, 19 total", id: `${RUN_ID}.tc-execute-0` }),
    ...writes,
    ...step({ name: "execute", input: { command: "npm test -- billing" }, atMs: 330_000, tookMs: 20_000, result: "Tests: 23 passed, 23 total", id: `${RUN_ID}.tc-execute-1` }),
    samples.agentMessageEvent("Every October invoice is checked. Fourteen were a cent off; each has its own audit file, and the summary lists them all.", {
      processedAt: sampleInstant(358_000),
    }),
    samples.runStatusEvent("completed", { processedAt: sampleInstant(362_000) }),
  ];
}

/** The credit-note file as the agent read it: lines 14 to 17 of 88, in the Stigmer harness's frame. */
const CREDIT_NOTE_READ = [
  "@@ lines 14-17 of 88 | next offset 18 @@",
  "export function creditNoteTotal(note: CreditNote): Cents {",
  "  return note.lines.reduce(",
  "    (sum, line) => sum + roundCents(line.amount), 0);",
  "}",
].join("\n");

/** The test file the agent created: 24 lines. */
const ROUNDING_TEST = [
  'import { roundHalfEven } from "./rounding";',
  'import { creditNoteTotal, invoiceTotal } from "./totals";',
  "",
  'test("0.335 rounds to 0.34", () => {',
  "  expect(roundHalfEven(33.5)).toBe(34);",
  "});",
  "",
  'test("0.325 rounds to 0.32", () => {',
  "  expect(roundHalfEven(32.5)).toBe(32);",
  "});",
  "",
  'test("a credit note rounds once", () => {',
  "  const note = { lines: [{ amount: 33.5 }, { amount: 33.5 }] };",
  "  expect(creditNoteTotal(note)).toBe(67);",
  "});",
  "",
  'test("an invoice rounds once", () => {',
  "  const lines = [{ amount: 33.5 }, { amount: 33.5 }];",
  "  expect(invoiceTotal(lines)).toBe(67);",
  "});",
  "",
  'test("zero stays zero", () => {',
  "  expect(roundHalfEven(0)).toBe(0);",
  "});",
  "",
].join("\n");

/** The File the file-steps turn returns: the audit of what it changed. */
const FILE_STEPS_AUDIT: StigmerFile = samples.outputFile("rounding-audit.md", { mimeType: "text/markdown", sizeBytes: 2_310n });

/** Every file step: list, search, find, read, edit, create, delete, an edit that failed and its retry, and a File written. */
function fileStepsTurn(): SessionEvent[] {
  return [
    samples.userMessageEvent("Make credit notes round like invoices, and replace the old rounding helper."),
    samples.runStatusEvent("running"),
    ...step({ name: "ls", input: { path: "src/billing" }, atMs: 3_000, tookMs: 200, result: "credit-note.ts\ninvoice.ts\nline.ts\nlegacy-rounding.ts\nrounding.ts\ntypes.ts" }),
    ...step({
      name: "grep",
      input: { pattern: "round(", path: "src/billing" },
      atMs: 6_000,
      result: "src/billing/invoice.ts:41:      sum + roundCents(lineTotal(line))\nsrc/billing/credit-note.ts:18:  amount: roundCents(line.amount)",
    }),
    ...step({
      name: "glob",
      input: { pattern: "**/*.test.ts" },
      atMs: 9_000,
      tookMs: 200,
      result: "src/billing/invoice.test.ts\nsrc/billing/line.test.ts\nsrc/billing/types.test.ts\nsrc/tax/vat.test.ts",
    }),
    ...step({ name: "read_file", input: { path: "src/billing/credit-note.ts", offset: 14, limit: 4 }, atMs: 12_000, tookMs: 200, result: CREDIT_NOTE_READ }),
    ...step({
      name: "edit_file",
      input: {
        path: "src/billing/credit-note.ts",
        old_string: "  return note.lines.reduce(\n    (sum, line) => sum + roundCents(line.amount), 0);",
        new_string: "  return roundHalfEven(note.lines.reduce(\n    (sum, line) => sum + line.amount, 0));",
      },
      atMs: 30_000,
      result: "1 edit applied",
      id: `${RUN_ID}.tc-edit-credit-note`,
    }),
    ...step({ name: "write_file", input: { path: "src/billing/rounding.test.ts", content: ROUNDING_TEST }, atMs: 48_000, tookMs: 300, result: "Wrote 24 lines", id: `${RUN_ID}.tc-write-test` }),
    ...step({ name: "delete_file", input: { path: "src/billing/legacy-rounding.ts" }, atMs: 56_000, tookMs: 100, result: "" }),
    ...step({
      name: "edit_file",
      input: { path: "src/billing/invoice.ts", old_string: "sum + roundCents(line.total)", new_string: "sum + line.total" },
      atMs: 64_000,
      tookMs: 200,
      result: "Error: the text to replace was not found in src/billing/invoice.ts",
      isError: true,
      id: `${RUN_ID}.tc-edit-invoice-failed`,
    }),
    ...step({
      name: "edit_file",
      input: { path: "src/billing/invoice.ts", old_string: "sum + roundCents(lineTotal(line))", new_string: "sum + lineTotal(line)" },
      atMs: 72_000,
      result: "1 edit applied",
      id: `${RUN_ID}.tc-edit-invoice`,
    }),
    ...step({
      name: "write_file",
      input: { path: "/.stigmer/outputs/rounding-audit.md", content: "# Rounding audit\n\nCredit notes now round once, at the total.\n" },
      atMs: 110_000,
      tookMs: 300,
      result: "Wrote 2.3 KB",
      id: `${RUN_ID}.tc-write-audit`,
    }),
    samples.agentMessageEvent("Credit notes now round once, like invoices. The old helper is gone and the new one has its own tests.", {
      processedAt: sampleInstant(126_000),
    }),
    samples.runStatusEvent("completed", { processedAt: sampleInstant(130_000) }),
  ];
}

/** The failed suite's output, ending in the shell's exit marker. */
const FAILED_SUITE = [
  " PASS  src/billing/invoice.test.ts",
  " FAIL  src/billing/credit-note.test.ts",
  "  ✕ half-cent credit note (4 ms)",
  "    Expected: 0.34",
  "    Received: 0.33",
  "",
  "Tests: 1 failed, 18 passed, 19 total",
  "[Command failed with exit code 1]",
].join("\n");

const SHELL_RUNNING_ID = `${RUN_ID}.tc-execute-suite`;
const SHELL_BACKGROUND_ID = `${RUN_ID}.tc-execute-dev`;
const SHELL_ASK_ID = `${RUN_ID}.tc-execute-push`;

/** What the running suite and the background dev server printed so far. */
const SHELL_OUTPUTS: readonly ToolOutput[] = [
  { toolUseId: SHELL_RUNNING_ID, delta: " PASS  src/billing/invoice.test.ts\n PASS  src/billing/credit-note.test.ts\n" },
  { toolUseId: SHELL_BACKGROUND_ID, delta: "> billing-app@1.4.0 dev\n> vite\n\n  VITE v5.4.2  ready in 412 ms\n  ➜  Local:   http://localhost:5173/\n" },
];

/** What the shell turn had open when the stream last said: the suite for 30s, the dev server for 2m 4s. */
const SHELL_LIVENESS: RunLiveness = create(RunLivenessSchema, {
  runId: RUN_ID,
  operations: [{ toolUseId: SHELL_RUNNING_ID, name: "execute", elapsed: durationFromMs(30_000) }],
});

/**
 * Every shell step: a command and its output, one the agent described, one
 * that exited 1, a quick one, the suite still running, a dev server in the
 * background, and a push that waits for a yes.
 */
function shellStepsTurn(): SessionEvent[] {
  const todos = [
    { content: "Fix credit-note rounding", status: "completed" },
    { content: "Run the credit-note tests", status: "completed" },
    { content: "Fix the half-cent test", status: "completed" },
    { content: "Try the change in the app", status: "completed" },
    { content: "Push the fix", status: "in_progress" },
  ];
  return [
    samples.userMessageEvent("Fix the credit-note rounding, prove it with the tests, try it in the app, and push the fix."),
    samples.runStatusEvent("running"),
    ...step({ name: "write_todos", input: { todos }, atMs: 2_000, tookMs: 200, result: "Updated the to-do list" }),
    ...step({
      name: "execute",
      input: { command: "npm test -- billing/invoice" },
      atMs: 10_000,
      tookMs: 14_000,
      result: "Tests: 12 passed, 12 total\nTime:  13.8 s\n[Command succeeded]",
      id: `${RUN_ID}.tc-execute-invoice`,
    }),
    ...step({
      name: "execute",
      input: { command: "npm test -- billing/credit-note", description: "Run the credit-note tests" },
      atMs: 40_000,
      tookMs: 9_000,
      result: "Tests: 7 passed, 7 total\n[Command succeeded]",
      id: `${RUN_ID}.tc-execute-credit-note`,
    }),
    ...step({
      name: "execute",
      input: { command: "npm test -- billing", description: "Run the whole billing suite" },
      atMs: 60_000,
      tookMs: 31_000,
      result: FAILED_SUITE,
      id: `${RUN_ID}.tc-execute-billing`,
    }),
    ...step({ name: "execute", input: { command: "git diff --stat" }, atMs: 120_000, tookMs: 300, result: " src/billing/credit-note.ts | 4 ++--\n 1 file changed\n[Command succeeded]", id: `${RUN_ID}.tc-execute-diff` }),
    samples.toolUseEvent("execute", { command: "npm run dev", background: true }, { id: SHELL_BACKGROUND_ID, processedAt: sampleInstant(136_000) }),
    samples.toolResultEvent(SHELL_BACKGROUND_ID, "Started in the background.", { processedAt: sampleInstant(136_400) }),
    samples.backgroundCommandStatusEvent(SHELL_BACKGROUND_ID, { processedAt: sampleInstant(136_500), timeoutSeconds: 1_800 }),
    samples.toolUseEvent("execute", { command: "npm test -- billing" }, { id: SHELL_RUNNING_ID, processedAt: sampleInstant(230_000) }),
    samples.toolUseEvent(
      "execute",
      { command: "git push origin fix/invoice-rounding", description: "Push the fix to its branch" },
      { id: SHELL_ASK_ID, evaluatedPermission: "ask", processedAt: sampleInstant(255_000) },
    ),
    samples.permissionAskedEvent(SHELL_ASK_ID, {
      processedAt: sampleInstant(255_100),
      argsPreview: JSON.stringify({ command: "git push origin fix/invoice-rounding", description: "Push the fix to its branch" }),
    }),
    samples.runStatusEvent("waiting", { processedAt: sampleInstant(255_200) }),
  ];
}

/** Builds the step turn `name`. */
function buildStepStory(name: StepStoryName): Scenario {
  switch (name) {
    case "mcp-turn":
      return loaded(name, "a connected app's tools: the agent searches the issue tracker, files an issue, and says so", mcpTurn());
    case "many-files":
      return loaded(name, "a long audit a routine started: three files changed and twenty Files made", manyFilesTurn(), {
        files: MANY_FILES,
        session: routineSession(),
      });
    case "file-steps":
      return loaded(name, "every file step: list, search, find, read, edit, create, delete, a failed edit and its retry, and a File written", fileStepsTurn(), {
        files: [FILE_STEPS_AUDIT],
      });
    case "shell-steps":
      return loaded(
        name,
        "every shell step: output, a described command, exit 1, a quick one, the suite running, a dev server in the background, and a push that asks first",
        shellStepsTurn(),
        { liveness: SHELL_LIVENESS, outputs: SHELL_OUTPUTS },
      );
  }
}

/** Every step turn, by name. Built once; treat them as read-only. */
export const stepStories: Readonly<Record<StepStoryName, Scenario>> = {
  "mcp-turn": buildStepStory("mcp-turn"),
  "many-files": buildStepStory("many-files"),
  "file-steps": buildStepStory("file-steps"),
  "shell-steps": buildStepStory("shell-steps"),
};

// ---------------------------------------------------------------------------
// The ending turns: every way a turn ends badly, one story per kind, so the
// session view's failure words are pinned against each before they change
// ---------------------------------------------------------------------------

/**
 * The ending turns, one per kind of ending the runner names
 * (`StigmerStopDetail.kind`), then the stops whose cause says it all and the
 * endings of a runner that named no kind. Stories, not states: the terminal's
 * frames and the CLI's goldens draw the states, and these only the session
 * view does.
 */
export const ENDING_STORY_NAMES = [
  "fail-key-rejected",
  "fail-key-missing",
  "fail-out-of-credit",
  "fail-rate-limited",
  "fail-overloaded",
  "fail-model-unavailable",
  "fail-unreachable",
  "fail-request-rejected",
  "fail-cost-cap",
  "fail-tool-call-limit",
  "fail-stalled",
  "fail-operation-limit",
  "fail-workspace-busy",
  "fail-agent-setup",
  "fail-app-unreachable",
  "fail-app-sign-in",
  "fail-internal",
  "fail-runner-lost",
  "fail-platform-stop",
  "fail-user-stop",
  "fail-generic-model",
  "fail-generic-failed",
] as const;

/** One of the ending turns. */
export type EndingStoryName = (typeof ENDING_STORY_NAMES)[number];

/** How an ending turn ends: its phase, cause, detail and error, and whether it stops part-way through the busy turn's plan. */
interface Ending {
  readonly title: string;
  readonly phase: TurnPhase;
  readonly stopCause: string;
  readonly kind?: string;
  readonly app?: string;
  readonly error: string;
  /** The turn had worked part-way when it ended: two of five to-dos done and the edit made. */
  readonly midPlan?: boolean;
}

const ENDING_MODEL = "claude-sonnet-4-6";
const ENDING_APP = "issue-tracker";
const MODEL_LABEL = `model "${ENDING_MODEL}" (Anthropic)`;

/** Each ending as the runner writes it today (its error's bytes from `backend/services/runner`). */
const ENDINGS: Readonly<Record<EndingStoryName, Ending>> = {
  "fail-key-rejected": {
    title: "the provider refused the organization's model key",
    phase: "failed",
    stopCause: "model_error",
    kind: "provider_key_rejected",
    error: `[LLM_AUTHENTICATION_ERROR] Anthropic rejected your organization's own key (authentication, HTTP 401) for ${MODEL_LABEL}. Update the key on the Models & providers page.`,
  },
  "fail-key-missing": {
    title: "the organization has no key for the model's provider",
    phase: "failed",
    stopCause: "model_error",
    kind: "provider_key_missing",
    error: "[LLM_PROVIDER_KEY_REQUIRED] This organization has no Anthropic key. An admin can add one on the Models & providers page.",
  },
  "fail-out-of-credit": {
    title: "the provider account is out of credit",
    phase: "failed",
    stopCause: "model_error",
    kind: "provider_out_of_credit",
    error:
      "[LLM_PROVIDER_BILLING] Your organization's own Anthropic key is out of credits or over quota. Add credits to that provider account, or update the key on the Models & providers page. Provider message: Your credit balance is too low to access the Anthropic API.",
  },
  "fail-rate-limited": {
    title: "the provider limited the request rate",
    phase: "failed",
    stopCause: "model_error",
    kind: "provider_rate_limited",
    error: `[LLM_RATE_LIMIT] Rate limit exceeded for ${MODEL_LABEL}. Try again later or reduce request frequency.`,
  },
  "fail-overloaded": {
    title: "the provider was overloaded",
    phase: "failed",
    stopCause: "model_error",
    kind: "provider_overloaded",
    error: `[LLM_PROVIDER_ERROR] Anthropic returned a server error (HTTP 529) for ${MODEL_LABEL}: Overloaded`,
  },
  "fail-model-unavailable": {
    title: "the model isn't available to the key",
    phase: "failed",
    stopCause: "model_error",
    kind: "model_unavailable",
    error: `[LLM_MODEL_NOT_FOUND] Model not found: ${MODEL_LABEL}. Verify the model name is correct and available in your account.`,
  },
  "fail-unreachable": {
    title: "the provider couldn't be reached",
    phase: "failed",
    stopCause: "model_error",
    kind: "provider_unreachable",
    error: `[LLM_CONNECTION_ERROR] Connection failed for ${MODEL_LABEL}: fetch failed`,
  },
  "fail-request-rejected": {
    title: "the provider refused the request itself",
    phase: "failed",
    stopCause: "model_error",
    kind: "request_rejected",
    error: `[LLM_BAD_REQUEST] Invalid request to ${MODEL_LABEL}: prompt is too long: 214031 tokens > 200000 maximum`,
  },
  "fail-cost-cap": {
    title: "the turn reached its spending cap",
    phase: "terminated",
    stopCause: "budget_reached",
    kind: "cost_cap",
    error: "Agent reached the cost limit for this message (~$5.0213 of the $5.00 budget). Send another message to continue.",
    midPlan: true,
  },
  "fail-tool-call-limit": {
    title: "the turn reached its step limit",
    phase: "terminated",
    stopCause: "budget_reached",
    kind: "tool_call_limit",
    error: "Agent reached the tool-call limit for this message. Send another message to continue.",
    midPlan: true,
  },
  "fail-stalled": {
    title: "the turn stopped making progress",
    phase: "failed",
    stopCause: "timeout",
    kind: "stalled",
    error: "[StallTimeoutError] Agent stream stalled: no activity for 600s (last tool: execute). Retry or resume.",
    midPlan: true,
  },
  "fail-operation-limit": {
    title: "a step ran past its time limit",
    phase: "failed",
    stopCause: "timeout",
    kind: "operation_limit",
    error: "[OperationLimitError] `execute` ran for more than 60 minutes without finishing. Retry or resume.",
    midPlan: true,
  },
  "fail-workspace-busy": {
    title: "another turn held the workspace",
    phase: "failed",
    stopCause: "timeout",
    kind: "workspace_busy",
    error:
      "Workspace is in use by another session: /workspace/billing (waited 300s). Another agent execution is operating on this workspace directory; retry after it finishes.",
  },
  "fail-agent-setup": {
    title: "the agent is set up wrong",
    phase: "failed",
    stopCause: "failed",
    kind: "agent_setup",
    error: "Billing fixer's tools list names no tool this turn has: [linear:create_issue]. Fix the list or remove it; an empty list means every tool.",
  },
  "fail-app-unreachable": {
    title: "a connected app wouldn't connect",
    phase: "failed",
    stopCause: "failed",
    kind: "app_unreachable",
    app: ENDING_APP,
    error: `[MCPClientError] Failed to connect to streamable HTTP server "${ENDING_APP}, url: https://mcp.tracker.example/mcp": fetch failed`,
  },
  "fail-app-sign-in": {
    title: "a connected app needs a sign-in",
    phase: "failed",
    stopCause: "failed",
    kind: "app_needs_sign_in",
    app: ENDING_APP,
    error: `[OAuthRequiredError] MCP server '${ENDING_APP}' requires OAuth: its endpoint returned an authentication challenge (HTTP 401). A manually-entered API token will not work here — connect it with the OAuth "Sign in" flow instead.`,
  },
  "fail-internal": {
    title: "something broke on Stigmer's side",
    phase: "failed",
    stopCause: "failed",
    kind: "internal",
    error: "[TypeError] Cannot read properties of undefined (reading 'content')",
  },
  "fail-runner-lost": {
    title: "the machine running the turn stopped",
    phase: "failed",
    stopCause: "infrastructure",
    kind: "runner_lost",
    error: "Execution interrupted: runner worker was shut down. Retry or resume.",
    midPlan: true,
  },
  "fail-platform-stop": {
    title: "Stigmer stopped the turn",
    phase: "completed",
    stopCause: "platform_stop",
    error: "",
    midPlan: true,
  },
  "fail-user-stop": {
    title: "the person stopped the turn",
    phase: "cancelled",
    stopCause: "user",
    error: "",
    midPlan: true,
  },
  "fail-generic-model": {
    title: "the model failed the turn, and the runner named no kind",
    phase: "failed",
    stopCause: "model_error",
    error: "The Claude Agent SDK failed: error_during_execution",
  },
  "fail-generic-failed": {
    title: "the turn failed, and the runner named no kind",
    phase: "failed",
    stopCause: "failed",
    error: "[Error] socket hang up",
  },
};

/** The busy turn's first steps: the to-do list, a search, a read and the edit, two of five to-dos done. */
function partWayEvents(): SessionEvent[] {
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
    samples.agentMessageEvent("Invoice totals now round once. Next, credit notes.", { id: `${RUN_ID}.root.m1`, processedAt: sampleInstant(30_000) }),
  ];
}

/** Builds the ending turn `name`. */
function buildEndingStory(name: EndingStoryName): Scenario {
  const ending = ENDINGS[name];
  const detail =
    ending.kind === undefined
      ? {}
      : {
          stopDetail: {
            kind: ending.kind,
            ...(ending.stopCause === "model_error" ? { model: ENDING_MODEL } : {}),
            ...(ending.app === undefined ? {} : { app: ending.app }),
          },
        };
  const start = ending.midPlan === true ? partWayEvents() : samples.turnEvents({ message: "Invoices are off by a cent. Can you fix the rounding?", phase: "running", reply: "" });
  const endAt = ending.midPlan === true ? 90_000 : 400;
  return loaded(name, ending.title, [
    ...start,
    samples.runStatusEvent(ending.phase, { stopCause: ending.stopCause, error: ending.error, processedAt: sampleInstant(endAt), ...detail }),
  ]);
}

/** Every ending turn, by name. Built once; treat them as read-only. */
export const endingStories: Readonly<Record<EndingStoryName, Scenario>> = Object.fromEntries(
  ENDING_STORY_NAMES.map((name) => [name, buildEndingStory(name)]),
) as Record<EndingStoryName, Scenario>;
