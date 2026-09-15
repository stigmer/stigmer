/**
 * CursorTranslator — the Cursor harness's translator: the `@cursor/sdk`'s two
 * event channels in, the canonical `TranscriptEvent` union out
 * (`harness/transcript/events.ts`).
 *
 * The one module that knows the SDK's wire shape (S4, `T01_0_plan.md` §3):
 * the shared `TranscriptBuilder` folds what comes out of here and nothing of
 * the engine reaches it otherwise. Until S4 M4 the Cursor harness folded its
 * own transcript — `MessageAccumulator` (the second copy of the folding rule
 * the memo counted), `DeltaEnricher` (row writes from the delta channel) and
 * `TodoTracker` (a third writer of `status.todos`) — and every rule they held
 * is either the builder's now or answered here. The same word, the same
 * `translate(raw)` signature and the same seat in its adapter as
 * `execute-deep-agent/translator.ts`, so a third harness's author finds one
 * shape in both.
 *
 * TWO CHANNELS, ONE DISCIPLINE. The SDK streams `SDKMessage`s from
 * `run.stream()` (the source of truth for messages and rows) and fires
 * `InteractionUpdate`s through `onDelta` between them (tool-call timings, live
 * shell output, a completion's status — facts the stream delivers later or
 * never). A delta lands while the loop may be awaiting a persist, and a row
 * write mid-persist would land on a row the offload is replacing (M4 finding
 * F-M4-23), so this translator never hands a delta's events to anyone
 * directly: {@link observeDelta} QUEUES them and the loop applies
 * {@link drainDeltas} after each stream event, and once more before
 * `finalize()`. A delta for a call the stream has not announced yet (the
 * output that beats the `running` event) is HELD and replayed right after the
 * `tool_started` that announces it (F-M4-7). Because the fold is later than
 * the observation, a completion learned from a delta carries `observedAt` —
 * the instant the tool actually finished — and the builder stamps that, not
 * the fold's moment (Q-M4-14). Rows are CREATED by the stream alone: the
 * delta channel amends (output, completion), never announces.
 *
 * WHAT THIS TRANSLATOR ANSWERS, per event:
 *
 *   - The MESSAGE BOUNDARY (Q-S4-3(a)). Cursor has one `run_id` per `send()`,
 *     and its message boundary is a tool call: text after a tool call is a new
 *     message. So `runId` here is a minted SEGMENT id, `<run_id>:<n>`, advanced
 *     on the first text or thinking after a tool call; a tool call emits
 *     `message_finish` for the open segment (closing its text and thinking).
 *   - The row's IDENTITY. An MCP call arrives as `name: "mcp"` with the real
 *     tool packed in `args` (`{ providerIdentifier, toolName, args }`); the row
 *     is the inner tool. A resumed agent re-runs an approved tool under a
 *     BRAND-NEW call id; the seeded WAITING row it belongs to is found by the
 *     identity token the hook and the grants already share (Q-S4-9), the
 *     `tool_started` is emitted with the SEEDED id so the builder's by-id flip
 *     does the rest, and every later event for the new id is aliased onto it.
 *     The seeded rows that can match exist only in the seed (nothing created
 *     mid-stream is WAITING until the boundary runs), so they are indexed once
 *     at construction and consumed on match (F-M4-24; a declined row is a
 *     closed gate and never matched — S2 M4 finding F9).
 *   - The GATE and the PROVENANCE (Q-M4-10). `gate` is the POLICY's word —
 *     this MCP tool's merged policy, or this built-in's category, requires
 *     approval — resolved exactly as the accumulator did, lease- and
 *     bypass-blind; it is NOT the hook's verdict (the hook has arms this side
 *     cannot evaluate: capture mode, grants, bypass, secret blocks — M2's
 *     F-M2-27 lesson). A gated call that STARTED runs until the boundary parks
 *     it through `approval_proposed`. Provenance is the shared read-side
 *     `resolveApprovalProvenance` over the same policies and the run's leases.
 *   - The RESULT string (`tool-result.ts`): a failure's text is its `error`
 *     alone (Q-M4-3).
 *   - The SUB-AGENT (Q-S4-4): a `task` tool call opens a sub-agent keyed by
 *     the call id (`sub_agent_started` before the row's own `tool_started`);
 *     its completion emits the row's `tool_finished`, the child's transcript
 *     as scoped events (`sub-agent-steps.ts` — Cursor delivers it whole, at
 *     completion), then `sub_agent_finished` with the same output string; an
 *     error, `tool_error` then `sub_agent_failed`.
 *   - The `task` SDK event → `system_note` (Q-S4-18); a todo write is an
 *     ordinary tool call the builder keys on `ToolKind.TODO` and projects
 *     (Q-S4-7); `system`, `status`, `user`, `request` and `usage` carry no
 *     transcript fact (usage is the loop's, priced from the `turn-ended`
 *     delta in `turn-stream.ts` — the same division as native's `usageOf`).
 *
 * Stateful, one per turn, shared by the primary stream and the recovery
 * retries exactly as the accumulator was (the segment map is keyed by
 * `run_id`, and a retry's send has its own).
 */

import type { InteractionUpdate, SDKMessage } from "@cursor/sdk";
import type { AgentMessage } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { ToolCallStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { GateAnswer, ToolStartedEvent, TranscriptEvent } from "../../harness/transcript/events.js";
import { resolveApprovalProvenance, type MergedToolPolicy, type PolicySource } from "../../shared/approval-policy.js";
import { utcTimestamp } from "../../shared/status.js";
import { isDeclinedRow } from "../../shared/tool-row.js";
import type { ToolApprovalCategory } from "../../shared/tool-kind.js";
import { builtInRequiresApproval, getBuiltInApprovalMessage, lookupMcpToolPolicy, resolveApprovalMessage } from "./approval-policy.js";
import { toolCallIdentityToken, toolIdentity, primaryToken } from "./approval-state.js";
import { contentDigest } from "../../shared/file-tools.js";
import { subAgentStepEvents } from "./sub-agent-steps.js";
import { toResultString } from "./tool-result.js";

type ToolCallEvent = Extract<SDKMessage, { type: "tool_call" }>;

/** The delegation tool: the one tool name this translator knows, because its start opens a sub-agent. */
const TASK_TOOL = "task";

/** The run's approval posture the translator answers `gate` and `provenance` from. */
export interface CursorTranslatorOptions {
  /** The merged four-level MCP policy map (`mergeApprovalPolicies`). */
  readonly policies: ReadonlyMap<string, MergedToolPolicy>;
  /** The run-lifetime leases: the pre-armed global bypass and the built-in categories approved for the run. */
  readonly leases: { readonly global: boolean; readonly categories: ReadonlySet<ToolApprovalCategory> };
  /** The transcript as seeded at turn start (`status.messages`): the WAITING rows a resumed agent's re-issued call may belong to. */
  readonly seeded: readonly AgentMessage[];
}

/** The text and thinking of one Cursor run, cut into messages by its tool calls. */
interface Segment {
  /** How many tool calls have cut this run so far; part of the minted `runId`. */
  n: number;
  /** A `message_start` was emitted for the current segment and no `message_finish` yet. */
  open: boolean;
  /** A tool call closed the current segment; the next text or thinking opens the next one. */
  advance: boolean;
}

// ── The translator ────────────────────────────────────────────────

export class CursorTranslator {
  private readonly segments = new Map<string, Segment>();
  /** Row ids the stream has announced (a `tool_started` was emitted for them). */
  private readonly announced = new Set<string>();
  /** A resumed agent's fresh call id → the seeded row it re-runs. */
  private readonly aliases = new Map<string, string>();
  /** Identity token → the seeded WAITING rows with it, in transcript order; consumed on match. */
  private readonly resumable = new Map<string, string[]>();
  /** The `task` rows whose completion closes a sub-agent. */
  private readonly taskCalls = new Set<string>();
  /** Delta-derived events for announced rows, awaiting the loop's drain. */
  private queue: TranscriptEvent[] = [];
  /**
   * Delta-derived events for calls the stream has not announced yet, keyed by
   * the delta's own call id and kept as makers: the row they belong to is
   * known only when the stream announces the call (a resumed agent's re-run
   * is aliased onto a seeded row then), so each is materialized at replay.
   */
  private readonly held = new Map<string, Array<(rowId: string) => TranscriptEvent>>();
  /** The most recent shell call the delta channel started — the home of an output delta that names no call. */
  private lastShellCallId: string | undefined;

  constructor(private readonly options: CursorTranslatorOptions) {
    for (const message of options.seeded) {
      for (const tc of message.toolCalls) {
        if (tc.status !== ToolCallStatus.TOOL_CALL_WAITING_APPROVAL || isDeclinedRow(tc)) continue;
        const token = toolCallIdentityToken(tc);
        const ids = this.resumable.get(token);
        if (ids) ids.push(tc.id);
        else this.resumable.set(token, [tc.id]);
      }
    }
  }

  /** One stream event to its canonical events — `translate(raw)` is the one signature every harness's translator shares. */
  translate(event: SDKMessage): TranscriptEvent[] {
    switch (event.type) {
      case "assistant": {
        const text = event.message.content
          .filter((b): b is { type: "text"; text: string } => b.type === "text")
          .map((b) => b.text)
          .join("");
        if (!text) return [];
        const { runId, opened } = this.openSegment(event.run_id);
        return [...opened, { kind: "text_delta", runId, text }];
      }
      case "thinking": {
        if (!event.text) return [];
        const { runId, opened } = this.openSegment(event.run_id);
        return [...opened, { kind: "reasoning_delta", runId, text: event.text }];
      }
      case "tool_call":
        return this.translateToolCall(event);
      case "task":
        return event.text ? [{ kind: "system_note", text: event.text }] : [];
      // Carried by the wire, not by the transcript (see the header).
      case "system":
      case "status":
      case "user":
      case "request":
      case "usage":
        return [];
      default: {
        const exhaustive: never = event;
        throw new Error(`CursorTranslator: unknown SDK message ${String((exhaustive as { type: string }).type)}`);
      }
    }
  }

  /**
   * One delta, queued — never applied here (see the header). The loop drains
   * the queue after the stream event it is processing.
   */
  observeDelta(update: InteractionUpdate): void {
    switch (update.type) {
      case "tool-call-started":
        // The row's `startedAt` is the stream's (every row has one from its
        // first stream event, Q-S4-17); the delta only tells us which shell an
        // output delta that names no call belongs to.
        if (update.toolCall.type === "shell") this.lastShellCallId = update.callId;
        return;
      case "shell-output-delta": {
        const text = shellOutputText(update.event);
        const callId = shellOutputCallId(update.event) ?? this.lastShellCallId;
        if (!text || !callId) return;
        this.enqueue(callId, (rowId) => ({ kind: "tool_output_delta", callId: rowId, delta: text }));
        return;
      }
      case "tool-call-completed": {
        // The completion, at the instant it was observed (Q-M4-14); the stream's
        // own completion follows with the result, and the builder's upsert
        // merges the two (Q-S4-3(c)). An empty result never clears anything.
        const observedAt = utcTimestamp();
        this.enqueue(update.callId, (rowId) => ({ kind: "tool_finished", callId: rowId, result: "", observedAt }));
        return;
      }
      default:
        // `turn-ended` (the loop prices it), `text-delta`/`thinking-delta` (the
        // stream carries the text), `thinking-completed`, the step and summary
        // markers, `partial-tool-call`: no transcript fact.
        return;
    }
  }

  /** The delta-derived events ready to apply, in arrival order; empties the queue. */
  drainDeltas(): TranscriptEvent[] {
    const out = this.queue;
    this.queue = [];
    return out;
  }

  // ── Messages ────────────────────────────────────────────────────

  /** The segment id text or thinking streams into now, and the `message_start` that opens it if none is open. */
  private openSegment(runId: string): { runId: string; opened: TranscriptEvent[] } {
    const segment = this.segmentOf(runId);
    if (segment.advance) {
      segment.n += 1;
      segment.advance = false;
    }
    const id = segmentId(runId, segment.n);
    if (segment.open) return { runId: id, opened: [] };
    segment.open = true;
    return { runId: id, opened: [{ kind: "message_start", runId: id }] };
  }

  /** A tool call ends the open segment: its text and thinking are finished, and the next text starts a new message. */
  private closeSegment(runId: string): TranscriptEvent[] {
    const segment = this.segmentOf(runId);
    segment.advance = true;
    if (!segment.open) return [];
    segment.open = false;
    return [{ kind: "message_finish", runId: segmentId(runId, segment.n) }];
  }

  private segmentOf(runId: string): Segment {
    let segment = this.segments.get(runId);
    if (!segment) {
      segment = { n: 0, open: false, advance: false };
      this.segments.set(runId, segment);
    }
    return segment;
  }

  // ── Tool calls ──────────────────────────────────────────────────

  private translateToolCall(event: ToolCallEvent): TranscriptEvent[] {
    const out: TranscriptEvent[] = this.closeSegment(event.run_id);

    const mcp = extractMcpToolDetails(event);
    const name = mcp?.toolName ?? event.name;
    const mcpServerSlug = mcp?.providerIdentifier ?? "";
    const input = mcp?.innerArgs ?? parseArgs(event.args);

    const rowId = this.resolveRowId(event.call_id, name, mcpServerSlug, input);
    const isTask = event.name === TASK_TOOL;

    if (!this.announced.has(rowId)) {
      if (isTask) {
        this.taskCalls.add(rowId);
        out.push({
          kind: "sub_agent_started",
          subAgentId: rowId,
          name: extractSubagentName(event.args),
          subject: stringArg(event.args, "description"),
          input: stringArg(event.args, "prompt"),
        });
      }
      this.announced.add(rowId);
    }
    out.push(this.toolStarted(rowId, name, mcp !== undefined, mcpServerSlug, input));
    // Deltas that arrived before the stream announced this call follow its
    // start, targeted at the row it resolved to.
    const heldMakers = this.held.get(event.call_id);
    if (heldMakers) {
      this.held.delete(event.call_id);
      for (const make of heldMakers) this.queue.push(make(rowId));
    }

    switch (event.status) {
      case "running":
        break;
      case "completed": {
        const result = toResultString(event.result);
        out.push({ kind: "tool_finished", callId: rowId, result });
        if (this.taskCalls.has(rowId)) {
          out.push(...subAgentStepEvents(event.result, rowId));
          out.push({ kind: "sub_agent_finished", subAgentId: rowId, output: result });
        }
        break;
      }
      case "error": {
        const message = typeof event.result === "string" ? event.result : "Tool call failed";
        out.push({ kind: "tool_error", callId: rowId, message });
        if (this.taskCalls.has(rowId)) {
          out.push({ kind: "sub_agent_failed", subAgentId: rowId, error: message });
        }
        break;
      }
      default: {
        const exhaustive: never = event.status;
        throw new Error(`CursorTranslator: unknown tool_call status ${String(exhaustive)}`);
      }
    }
    return out;
  }

  /**
   * The row a call's events fold into: the id the stream gave it, unless the
   * call is a resumed agent's re-run of a seeded WAITING row (the same
   * identity token; Q-S4-9), in which case the seeded id — aliased for every
   * later event of this call.
   */
  private resolveRowId(callId: string, name: string, mcpServerSlug: string, input: Record<string, unknown>): string {
    const known = this.aliases.get(callId);
    if (known) return known;
    if (this.announced.has(callId)) return callId;
    const identity = toolIdentity(name, mcpServerSlug, input);
    const token = primaryToken(identity.key, identity.salient, contentDigest(input));
    const candidates = this.resumable.get(token);
    const seededId = candidates?.shift();
    if (seededId === undefined) return callId;
    this.aliases.set(callId, seededId);
    return seededId;
  }

  private toolStarted(callId: string, name: string, isMcp: boolean, mcpServerSlug: string, input: Record<string, unknown>): ToolStartedEvent {
    const { policies, leases } = this.options;
    const provenance: PolicySource | undefined = resolveApprovalProvenance(
      name,
      mcpServerSlug,
      policies,
      leases.categories,
      leases.global,
    );
    const gate = this.gateOf(name, isMcp, mcpServerSlug, input);
    return {
      kind: "tool_started",
      callId,
      name,
      input,
      mcpServerSlug,
      ...(provenance !== undefined ? { provenance } : {}),
      ...(gate !== undefined ? { gate } : {}),
    };
  }

  /**
   * The policy's word that this call requires approval, and the card's
   * message — or nothing for an ungated call. An MCP call (the `mcp` envelope,
   * whatever its provider field says) is governed by the merged policy map
   * alone; a built-in by its category.
   */
  private gateOf(name: string, isMcp: boolean, mcpServerSlug: string, input: Record<string, unknown>): GateAnswer | undefined {
    if (isMcp) {
      const policy = lookupMcpToolPolicy(name, mcpServerSlug, this.options.policies);
      return policy ? { message: resolveApprovalMessage(policy.approvalMessage, name, input) } : undefined;
    }
    if (!builtInRequiresApproval(name)) return undefined;
    const template = getBuiltInApprovalMessage(name);
    return template ? { message: resolveApprovalMessage(template, name, input) } : undefined;
  }

  // ── The delta queue ─────────────────────────────────────────────

  private rowIdOf(callId: string): string {
    return this.aliases.get(callId) ?? callId;
  }

  private enqueue(callId: string, make: (rowId: string) => TranscriptEvent): void {
    const rowId = this.rowIdOf(callId);
    if (this.announced.has(rowId)) {
      this.queue.push(make(rowId));
      return;
    }
    const pending = this.held.get(callId);
    if (pending) pending.push(make);
    else this.held.set(callId, [make]);
  }
}

function segmentId(runId: string, n: number): string {
  return `${runId}:${n}`;
}

// ── The MCP envelope ──────────────────────────────────────────────

/**
 * Details extracted from an MCP tool call event's args.
 *
 * When Cursor invokes an MCP tool, the SDK stream reports event.name as
 * "mcp" and packs the real tool identity into event.args:
 * { providerIdentifier: "planton", toolName: "search_services", args: {...} }
 */
export interface McpToolDetails {
  providerIdentifier: string;
  toolName: string;
  innerArgs: Record<string, unknown>;
}

/** The MCP tool a `tool_call` event names, or undefined for a built-in. */
export function extractMcpToolDetails(event: ToolCallEvent): McpToolDetails | undefined {
  if (event.name !== "mcp") return undefined;

  const args = event.args;
  if (args == null || typeof args !== "object") return undefined;

  const obj = args as Record<string, unknown>;
  const providerIdentifier = typeof obj.providerIdentifier === "string" ? obj.providerIdentifier : "";
  const toolName = typeof obj.toolName === "string" ? obj.toolName : "";

  if (!toolName) return undefined;

  const innerArgs = (typeof obj.args === "object" && obj.args !== null)
    ? obj.args as Record<string, unknown>
    : {};

  return { providerIdentifier, toolName, innerArgs };
}

// ── Args ──────────────────────────────────────────────────────────

/**
 * A `tool_call` event's `args` as the row's input: the object as it came, a
 * JSON string parsed when it parses (a truncated one does not — the SDK marks
 * `truncated.args`), anything else nothing.
 */
function parseArgs(raw: unknown): Record<string, unknown> {
  if (raw != null && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed != null && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      // Not JSON (or cut short by the SDK's truncation): the row has no args.
    }
  }
  return {};
}

/**
 * The sub-agent's name from the task tool's args, in both the legacy string
 * form (`"generalPurpose"`) and the SDK's object form
 * (`{ kind: "generalPurpose", name?: "..." }`); `description` (always set by
 * the SDK) before the generic `"task"`. The `kind` value `"unspecified"` is
 * treated as absent — the SDK's default when the blueprint names no type.
 */
export function extractSubagentName(args: unknown): string {
  if (args == null || typeof args !== "object") return TASK_TOOL;
  const obj = args as Record<string, unknown>;

  const subagentType = obj.subagentType ?? obj.subagent_type;
  if (typeof subagentType === "string" && subagentType) return subagentType;
  if (subagentType != null && typeof subagentType === "object") {
    const typed = subagentType as Record<string, unknown>;
    if (typeof typed.name === "string" && typed.name) return typed.name;
    if (typeof typed.kind === "string" && typed.kind && typed.kind !== "unspecified") {
      return typed.kind;
    }
  }

  if (typeof obj.description === "string" && obj.description) return obj.description;

  return TASK_TOOL;
}

function stringArg(args: unknown, key: string): string {
  if (args != null && typeof args === "object" && key in args) {
    const val = (args as Record<string, unknown>)[key];
    return typeof val === "string" ? val : "";
  }
  return "";
}

// ── The shell-output delta's payload ──────────────────────────────

/**
 * The SDK's `shell-output-delta` carries a generic `Record<string, unknown>`;
 * observed payloads are `{ type: "stdout" | "stderr", data }`, sometimes
 * `{ output }`. Read defensively.
 */
function shellOutputText(event: Record<string, unknown>): string {
  if (typeof event.data === "string") return event.data;
  if (typeof event.output === "string") return event.output;
  if (typeof event.text === "string") return event.text;
  return "";
}

/** The call an output delta names, when it names one (`{ callId, type, data }` observed). */
function shellOutputCallId(event: Record<string, unknown>): string | undefined {
  if (typeof event.callId === "string") return event.callId;
  if (typeof event.call_id === "string") return event.call_id;
  if (typeof event.id === "string") return event.id;
  return undefined;
}
