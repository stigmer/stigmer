/**
 * The turn runtime's timeline of one engine turn, folded from the transcript
 * events every harness already emits, and written once at settle as the
 * `turn_phases` `stigmer_timing` line.
 *
 * What it answers, for every harness alike and for any harness added later
 * without a line in an adapter: when the user first saw something happen,
 * how many model rounds and tool calls the turn took, where the sub-agents
 * ran, and where the turn's longest silence was. It is the per-turn,
 * CLIENT-PERCEIVED measurement from the runner's vantage, from the turn's
 * origin (the activity's start, the same origin `execution_setup` counts
 * from, so the two lines subtract without a join) to the adapter's return;
 * the completion epilogue and the terminal persist that follow are the
 * client's own end-to-end, read at `subscribe`. Its counterpart is the cloud
 * proxy's `ProxyTiming` (`run/v1/usage.proto`): per model CALL,
 * server-side, what the provider did. Neither restates the other; a report
 * that wants both joins them by `execution_id`.
 *
 * Why a fold over the transcript events and not a mark in each adapter: the
 * transcript builder (`transcript/builder.ts`) is the one view the runtime
 * has of every harness's turn — model rounds, text, tools, sub-agents all
 * reach it as a translator's output on one union — so a fold over it is
 * written once and holds for the Stigmer harness's adapter, the Claude adapter and
 * the next one. `UsageAccumulator` (`usage-accumulator.ts`) is the same shape
 * for the usage deltas; this is that shape for the events.
 *
 * The fold's rules, each with an arm in `__tests__/turn-timeline.test.ts`:
 *
 *   - Three instants, ROOT scope only (a sub-agent's text is not what the
 *     user is watching): `first_event_ms`, the first event of any kind;
 *     `first_visible_token_ms`, the first `text_delta` or `reasoning_delta`
 *     (both stream into the console as tokens); `first_text_ms`, the first
 *     `text_delta`. The two token instants are the cross-harness axes: with
 *     extended thinking on, the visible instant moves earlier and the text
 *     instant later, and a comparison needs both. `first_event_ms` is
 *     harness-relative — on Stigmer the first event is `message_start`, the
 *     model stream opening; on Claude it is whatever the engine's process
 *     delivered first — and is kept as a forensic (engine-ready to first model event), never as
 *     an axis. An instant that never happened is `null`.
 *   - One `model_round` span per `runId`, `message_start` to `message_finish`.
 *     What a `runId` is belongs to the translator: LangGraph's LLM-call run on
 *     Stigmer, one model round; the API message on Claude, one model call.
 *     The line's `rounds` reads the same way.
 *   - One `tool:<name>` span per `callId` (`tool:<slug>/<name>` for an MCP
 *     tool, so the MCP phase the runner skill's law asks for is legible),
 *     `tool_started` to the FIRST `tool_finished` or `tool_error`; a later
 *     fact for a settled span changes nothing, the builder's own upsert rule.
 *     `approval_proposed` opens nothing:
 *     a call the engine held before it ran is not a tool phase.
 *   - One `sub_agent:<name>` span per `subAgentId`, opened by
 *     `sub_agent_started`, closed by `finished` or `failed`.
 *   - Rounds and tool calls count delegated work too: a sub-agent's model
 *     rounds and tool calls (its events carry its `subAgentId`) open spans
 *     like the main agent's, so the line's `rounds` and `tool_calls` are the
 *     whole turn's, and a turn that delegated reports more of each than its
 *     main agent made; `sub_agents` counts the delegations. A reader comparing
 *     the main agent's own loop across turns reads them with `sub_agents`
 *     beside them (the benchmark report reads them so,
 *     `test/conformance/src/benchmark/report.ts`).
 *   - One `background_command:<callId>` span per command the agent started
 *     in the background, `background_command_started` to
 *     `background_command_ended`, keyed by the starting call's id; and one
 *     `background_wait` span per wait at a round's end for those commands,
 *     `background_wait_started` to `background_wait_finished`, in its scope.
 *     With the tool and round spans on the same clock, a reader can tell
 *     what the agent did while a command ran, and how long the turn only
 *     waited for one. `background_reminders` counts the times the agent was
 *     sent back with a reminder that its commands still ran
 *     (`background_reminded`), which no span or round reveals: a round the
 *     runtime causes can as well be a wake after a wait or a notice owed.
 *   - `max_gap_ms`, the longest wait between two consecutive events, whatever
 *     their kind: the turn's longest silence as the user experienced it.
 *     `null` under two events.
 *   - A span still open at settle closes at settle: an interrupted turn's
 *     spans end where the turn did.
 *
 * The line: `emitTimingLog("turn_phases", context, recorder)` over a
 * `TimingRecorder` on the turn's origin, every span appended in start order
 * through `span()`. This is the first `stigmer_timing` event whose segments
 * OVERLAP (a tool inside a round, a sub-agent across rounds); the recorder's
 * `total_ms` is the latest end, not a sum, and a reader that summed the
 * other timelines' segments must not sum this one's. No histogram mirrors it
 * yet: the benchmark report is its reader and reads the log; an aggregate
 * earns its instrument when a dashboard asks.
 *
 * Failure posture, the timing module's: the fold is arithmetic over the
 * event and cannot affect a turn; `emit` is best-effort through
 * `emitTimingLog`. Nothing here is persisted, and nothing branches on it.
 */

import { TimingRecorder, emitTimingLog } from "../shared/cold-start-timing.js";
import type { TranscriptEvent } from "./transcript/events.js";

/** The `stigmer_timing` selector of the line this module emits. */
export const TURN_PHASES_EVENT = "turn_phases";

/**
 * The clock the timeline places facts on, from the turn's origin. `now` is
 * `performance.now` in production; tests inject a scripted one.
 */
export interface TurnTimelineClock {
  /** `performance.now()`-scale origin, the one `execution_setup` shares. */
  readonly originMs: number;
  readonly now: () => number;
}

/** The facts the runtime adds to the line beside the fold's own. */
export type TurnPhasesContext = Record<string, string | number | boolean | null | undefined>;

/** One span the fold has closed or is still tracking. Absolute `performance.now()` scale. */
interface OpenSpan {
  readonly name: string;
  readonly startMs: number;
  endMs: number | undefined;
}

export class TurnTimeline {
  private readonly clock: TurnTimelineClock;

  private firstEventMs: number | undefined;
  private firstVisibleTokenMs: number | undefined;
  private firstTextMs: number | undefined;
  private lastEventMs: number | undefined;
  private maxGapMs: number | undefined;

  private readonly rounds = new Map<string, OpenSpan>();
  private readonly tools = new Map<string, OpenSpan>();
  private readonly subAgents = new Map<string, OpenSpan>();
  private readonly backgroundCommands = new Map<string, OpenSpan>();
  /** Every wait, in order; a scope has at most one open, the last of its scope. */
  private readonly backgroundWaits: OpenSpan[] = [];
  private readonly openWaits = new Map<string, OpenSpan>();
  private backgroundReminders = 0;

  constructor(clock: TurnTimelineClock) {
    this.clock = clock;
  }

  /** The builder's observer: place one folded event on the timeline, at `at` when the fold happened earlier (a relayed event). */
  observe(event: TranscriptEvent, at: number = this.clock.now()): void {
    this.noteEvent(at);

    // Root scope only: a sub-agent's tokens stream into its own row, not the
    // thread the user is watching.
    if ((event.kind === "text_delta" || event.kind === "reasoning_delta") && event.subAgentId === undefined) {
      this.firstVisibleTokenMs ??= at;
      if (event.kind === "text_delta") this.firstTextMs ??= at;
    }

    switch (event.kind) {
      case "message_start":
        this.open(this.rounds, event.runId, "model_round", at);
        return;
      case "message_finish":
        this.close(this.rounds, event.runId, at);
        return;
      case "tool_started":
        this.open(this.tools, event.callId, toolSpanName(event.name, event.mcpServerSlug), at);
        return;
      case "tool_finished":
      case "tool_error":
        this.close(this.tools, event.callId, at);
        return;
      case "sub_agent_started":
        this.open(this.subAgents, event.subAgentId, `sub_agent:${event.name}`, at);
        return;
      case "sub_agent_finished":
      case "sub_agent_failed":
        this.close(this.subAgents, event.subAgentId, at);
        return;
      case "background_command_started":
        this.open(this.backgroundCommands, event.callId, `background_command:${event.callId}`, at);
        return;
      case "background_command_ended":
        this.close(this.backgroundCommands, event.callId, at);
        return;
      case "background_wait_started": {
        const scope = event.subAgentId ?? "";
        if (this.openWaits.has(scope)) return;
        const span: OpenSpan = { name: "background_wait", startMs: at, endMs: undefined };
        this.openWaits.set(scope, span);
        this.backgroundWaits.push(span);
        return;
      }
      case "background_wait_finished": {
        const scope = event.subAgentId ?? "";
        const span = this.openWaits.get(scope);
        if (span === undefined) return;
        span.endMs = at;
        this.openWaits.delete(scope);
        return;
      }
      case "background_reminded":
        this.backgroundReminders += 1;
        return;
      case "text_delta":
      case "reasoning_delta":
      case "tool_arg_delta":
      case "tool_output_delta":
      case "tool_policy":
      case "approval_proposed":
      case "context_compacted":
      case "system_note":
      case "background_output_delta":
        return;
      default: {
        const exhaustive: never = event;
        throw new Error(`unknown transcript event ${String((exhaustive as { kind: string }).kind)}`);
      }
    }
  }

  /**
   * Write the line, once, at settle. Spans still open close now; the
   * runtime's context (`execution_id`, `session_id`, `turn_seq`, `harness`,
   * `outcome`) rides beside the fold's facts.
   */
  emit(context: TurnPhasesContext): void {
    const settledAt = this.clock.now();
    const recorder = new TimingRecorder(this.clock.originMs);
    const spans = [
      ...this.rounds.values(),
      ...this.tools.values(),
      ...this.subAgents.values(),
      ...this.backgroundCommands.values(),
      ...this.backgroundWaits,
    ].sort((a, b) => a.startMs - b.startMs);
    for (const span of spans) {
      recorder.span(span.name, span.startMs, span.endMs ?? settledAt);
    }
    emitTimingLog(TURN_PHASES_EVENT, {
      ...context,
      first_event_ms: this.offset(this.firstEventMs),
      first_visible_token_ms: this.offset(this.firstVisibleTokenMs),
      first_text_ms: this.offset(this.firstTextMs),
      rounds: this.rounds.size,
      tool_calls: this.tools.size,
      sub_agents: this.subAgents.size,
      background_commands: this.backgroundCommands.size,
      background_reminders: this.backgroundReminders,
      max_gap_ms: this.maxGapMs === undefined ? null : round1(this.maxGapMs),
    }, recorder);
  }

  private noteEvent(at: number): void {
    this.firstEventMs ??= at;
    if (this.lastEventMs !== undefined) {
      const gap = at - this.lastEventMs;
      if (this.maxGapMs === undefined || gap > this.maxGapMs) this.maxGapMs = gap;
    }
    this.lastEventMs = at;
  }

  /** A span per identity: a re-emitted start (a resumed seeded call) keeps the first start. */
  private open(spans: Map<string, OpenSpan>, id: string, name: string, at: number): void {
    if (spans.has(id)) return;
    spans.set(id, { name, startMs: at, endMs: undefined });
  }

  /** The FIRST close settles a span; a later fact for it changes nothing. A close for an unknown id is ignored. */
  private close(spans: Map<string, OpenSpan>, id: string, at: number): void {
    const span = spans.get(id);
    if (!span || span.endMs !== undefined) return;
    span.endMs = at;
  }

  private offset(absoluteMs: number | undefined): number | null {
    return absoluteMs === undefined ? null : round1(absoluteMs - this.clock.originMs);
  }
}

function toolSpanName(name: string, mcpServerSlug: string): string {
  return mcpServerSlug ? `tool:${mcpServerSlug}/${name}` : `tool:${name}`;
}

function round1(ms: number): number {
  return Math.round(ms * 10) / 10;
}
