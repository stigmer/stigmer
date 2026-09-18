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
 * proxy's `ProxyTiming` (`agentexecution/v1/usage.proto`): per model CALL,
 * server-side, what the provider did. Neither restates the other; a report
 * that wants both joins them by `execution_id`.
 *
 * Why a fold over the transcript events and not a mark in each adapter: the
 * transcript builder (`transcript/builder.ts`) is the one view the runtime
 * has of every harness's turn — model rounds, text, tools, sub-agents all
 * reach it as a translator's output on one union — so a fold over it is
 * written once and holds for the Cursor adapter, the native adapter and the
 * next one. `UsageAccumulator` (`usage-accumulator.ts`) is the same shape
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
 *     harness-relative — on native the first event is `message_start`, the
 *     model stream opening; on Cursor it is whatever the SDK delivered first —
 *     and is kept as a forensic (engine-ready to first model event), never as
 *     an axis. An instant that never happened is `null`.
 *   - One `model_round` span per `runId`, `message_start` to `message_finish`.
 *     What a `runId` is belongs to the translator: LangGraph's LLM-call run on
 *     native, one model round; a minted segment `<run>:<n>` on Cursor, a
 *     stretch of assistant output between tool calls, which the SDK does not
 *     let us tell apart from a provider round. The line's `rounds` reads the
 *     same way.
 *   - One `tool:<name>` span per `callId` (`tool:<slug>/<name>` for an MCP
 *     tool, so the MCP phase the runner skill's law asks for is legible),
 *     `tool_started` to the FIRST `tool_finished` or `tool_error`; a later
 *     fact for a settled span changes nothing, the builder's own upsert rule
 *     (Cursor completes every call twice). `approval_proposed` opens nothing:
 *     a call the engine held before it ran is not a tool phase.
 *   - One `sub_agent:<name>` span per `subAgentId`, opened by
 *     `sub_agent_started`, closed by `finished` or `failed`.
 *   - A fact that carries `observedAt` is placed at that instant, everything
 *     else at the fold's clock — the builder's rule for `completedAt`
 *     (`transcript/events.ts`, `Observed`), restated here because the
 *     alternative repeats the error #1097 fixed, for tool phases and on Cursor
 *     alone: a completion the SDK's delta channel reported is folded one
 *     stream event later, seconds while the model narrates, and a comparison
 *     that read the fold's clock would charge those seconds to Cursor's tools.
 *     Placing an observed instant needs a wall-clock origin beside the
 *     `performance.now()` one; the runtime captures both together.
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
 * The two clocks the timeline places facts on, captured together at the
 * turn's origin. `now` is `performance.now` in production; tests inject a
 * scripted one. `originWallMs` is the `Date.now()` of the same instant, the
 * scale `observedAt` stamps are on.
 */
export interface TurnTimelineClock {
  /** `performance.now()`-scale origin, the one `execution_setup` shares. */
  readonly originMs: number;
  /** `Date.now()`-scale reading of the same instant. */
  readonly originWallMs: number;
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

  constructor(clock: TurnTimelineClock) {
    this.clock = clock;
  }

  /** The builder's observer: place one folded event on the timeline. */
  observe(event: TranscriptEvent): void {
    const at = this.clock.now();
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
        this.close(this.tools, event.callId, this.placeObserved(event.observedAt, at));
        return;
      case "sub_agent_started":
        this.open(this.subAgents, event.subAgentId, `sub_agent:${event.name}`, at);
        return;
      case "sub_agent_finished":
      case "sub_agent_failed":
        this.close(this.subAgents, event.subAgentId, at);
        return;
      case "text_delta":
      case "reasoning_delta":
      case "tool_arg_delta":
      case "tool_output_delta":
      case "approval_proposed":
      case "system_note":
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
    const spans = [...this.rounds.values(), ...this.tools.values(), ...this.subAgents.values()]
      .sort((a, b) => a.startMs - b.startMs);
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

  /**
   * Where a fact goes on the `performance.now()` scale: its observed instant
   * translated through the paired origins when it carries one, else the fold's
   * clock. An unparseable stamp falls back to the fold's clock rather than
   * losing the fact.
   */
  private placeObserved(observedAt: string | undefined, foldAt: number): number {
    if (observedAt === undefined) return foldAt;
    const wallMs = Date.parse(observedAt);
    if (Number.isNaN(wallMs)) return foldAt;
    return this.clock.originMs + (wallMs - this.clock.originWallMs);
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
