/**
 * DeepAgentTranslator — the native harness's translator: LangGraph's v3
 * protocol events in, the canonical `TranscriptEvent` union out
 * (`harness/transcript/events.ts`).
 *
 * The one module that knows LangGraph's wire shape (S4's disposition table):
 * the shared builder folds what comes out of here and nothing of the engine
 * reaches it otherwise. Every engine fact the builder used to read is
 * answered on this side now (S4 M2):
 *
 *   - the tool's result, rendered to the string the row carries — the
 *     LangChain ToolMessage envelope and the LangGraph Command unwrapped
 *     (C2a, C2b; Q-S4-3, Q-S4-21);
 *   - the tool's attribution (`mcpServerSlug`) and authorization provenance,
 *     from the gate's posture (C3; `resolveApprovalProvenance`, the gate's
 *     read-side twin);
 *   - the SCOPE of every event — the root's transcript or one sub-agent's —
 *     from LangGraph's namespace grammar, and the sub-agent's own lifecycle
 *     (`sub_agent_started/finished/failed`) from deepagents' `task` tool
 *     (C4; Q-S4-3, Q-S4-4). Until C4 the builder read the namespace and the
 *     tool's name itself, and kept a second copy of every handler for the
 *     sub-agents' transcripts.
 *
 * What this translator deliberately does NOT answer: whether the gate holds
 * a call. On native it never has to. LangGraph's `interrupt()` runs inside
 * the gate middleware BEFORE the tool handler, so a held call emits no
 * `tool-started` at all; the `tool-started` that does arrive is the engine's
 * own word that the call was authorized — capture mode let the file write
 * flow, a lease or the policy chain cleared it, or the user approved it on a
 * resume. The gate's decision has arms this side cannot evaluate (capture
 * mode asks the workspace's git state, asynchronously;
 * `middleware/approval-gate.ts`), and duplicating them would be a second copy
 * of the decision — the drift Q-M2-9 exists to end. So native emits no
 * `tool_started.gate`; the held call reaches the transcript as
 * `approval_proposed` from the post-stream seed (C6). Until C3 the builder
 * carried a copy of the decision that gated MCP tools only, a path
 * production never took — M2 finding F-M2-27, option A.
 *
 * Attribution and provenance are answered for ROOT-scope calls only: a
 * sub-agent's rows carry none on either harness today (S4 review finding
 * 11), and one handler set would otherwise stamp them as a side effect
 * (F-M2-23; S5's question).
 *
 * The scope, in LangGraph 1.3.2's grammar (mirrors deepagents'
 * `createSubagentTransformer`): the root's model events arrive under
 * `["model_request:<uuid>"]` and its tool events under `["tools:<uuid>"]`
 * (one segment); a `task` tool start at that depth opens a sub-agent, and
 * the segment it arrived under is the prefix every event of that sub-agent's
 * graph carries first (`["tools:<uuid>", "model_request:<inner>"]`, two or
 * more segments). An event with a REGISTERED first segment and two or more
 * segments is the sub-agent's; everything else is the root's — including a
 * nested namespace whose prefix nobody registered, which folds into the
 * root as it always did (F-M2-17; a sub-agent resumed inside its own gate
 * with no re-emitted `task` start is the production case). A `task` inside
 * a sub-agent is an ordinary row of that sub-agent's transcript: one level
 * of delegation is tracked, as before.
 *
 * Beside the transcript, {@link usageOf} answers the loop's one
 * non-transcript question about the wire (C1) — the usage a
 * `message-finish` carries — so the loop never parses a raw event itself.
 * What the wire carries that the transcript does not: `lifecycle` and
 * `provider` events, the standalone `usage` event, each event's `seq` and
 * `node`. None of it was ever folded; the recorder keeps the raw event for
 * a replay.
 *
 * The file was `v3-protocol-normalizer.ts` (a stateless `normalize`) until
 * C4 made it stateful (Q-M2-4) — the same word as `execute-cursor/translator.ts`
 * (M4), so a third harness's author finds one shape in both.
 *
 * Defensive parsing: handles both snake_case and camelCase field names
 * for tool IDs/names (protocol spec uses camelCase but recordings show
 * snake_case). Uses `data.event` as canonical discriminator, with
 * `data.type` as fallback (CP04 finding).
 */

import type { V3ProtocolEvent } from "./v3-event-recorder.js";
import type { ToolStartedEvent, TranscriptEvent } from "../../harness/transcript/events.js";
import { resolveApprovalProvenance, type PolicySource } from "../../shared/approval-policy.js";
import type { DeepAgentGateState } from "./turn-setup.js";

const loggedUnknowns = new Set<string>();

/** deepagents' delegation tool: the one tool name this translator knows, because its start opens a sub-agent. */
const TASK_TOOL = "task";

// ── The translator ────────────────────────────────────────────────

export class DeepAgentTranslator {
  /** First namespace segment → the sub-agent (its `task` call id) whose graph runs under it. */
  private readonly subAgentByPrefix = new Map<string, string>();
  /** The `task` call ids whose completion closes a sub-agent. */
  private readonly taskCalls = new Set<string>();

  /**
   * @param gate the turn's gate posture, for attribution and provenance;
   *   `null` where a turn runs with none (the unit arms that drive the
   *   builder bare), and then every call is unattributed.
   */
  constructor(private readonly gate: DeepAgentGateState | null) {}

  /** One raw event to its canonical events — `translate(raw)` is the one signature every harness's translator shares. */
  translate(raw: V3ProtocolEvent): TranscriptEvent[] {
    const namespace = raw.params.namespace;
    const subAgentId = this.scopeOf(namespace);
    const out: TranscriptEvent[] = [];
    for (const event of normalize(raw)) {
      if (subAgentId !== undefined) {
        out.push({ ...event, subAgentId });
        continue;
      }
      switch (event.kind) {
        case "tool_started":
          if (event.name === TASK_TOOL && namespace.length <= 1) {
            out.push(this.openSubAgent(event, namespace));
          }
          out.push(this.attribute(event));
          break;
        case "tool_finished":
          out.push(event);
          if (this.taskCalls.has(event.callId)) {
            out.push({ kind: "sub_agent_finished", subAgentId: event.callId, output: event.result });
          }
          break;
        case "tool_error":
          out.push(event);
          if (this.taskCalls.has(event.callId)) {
            out.push({ kind: "sub_agent_failed", subAgentId: event.callId, error: event.message });
          }
          break;
        default:
          out.push(event);
      }
    }
    return out;
  }

  /** The sub-agent an event belongs to, or `undefined` for the root (see the header for the grammar). */
  private scopeOf(namespace: readonly string[]): string | undefined {
    if (namespace.length < 2) return undefined;
    return this.subAgentByPrefix.get(namespace[0]);
  }

  /**
   * A `task` start at the root opens a sub-agent keyed by the call id, with
   * the segment it arrived under as the routing prefix (a depth-0 start —
   * tests — gets a synthetic one so its children can still name it).
   */
  private openSubAgent(event: ToolStartedEvent, namespace: readonly string[]): TranscriptEvent {
    const prefix = namespace[0] ?? `tools:${event.callId}`;
    this.subAgentByPrefix.set(prefix, event.callId);
    this.taskCalls.add(event.callId);
    const description = stringArg(event.input, "description");
    return {
      kind: "sub_agent_started",
      subAgentId: event.callId,
      name: stringArg(event.input, "subagent_type") || TASK_TOOL,
      subject: description,
      input: description,
    };
  }

  /** The attribution and provenance for one root-scope tool start. */
  private attribute(event: ToolStartedEvent): ToolStartedEvent {
    const gate = this.gate;
    if (!gate) return event;
    const mcpServerSlug = gate.toolServerMap.get(event.name) ?? "";
    const provenance: PolicySource | undefined = resolveApprovalProvenance(
      event.name,
      mcpServerSlug,
      gate.policies,
      gate.leasedCategories,
      gate.globalBypass,
    );
    return {
      ...event,
      mcpServerSlug,
      ...(provenance !== undefined ? { provenance } : {}),
    };
  }
}

function stringArg(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  return typeof value === "string" ? value : "";
}

// ── The wire, event by event ──────────────────────────────────────

/**
 * The stateless core: one raw event to its canonical events, root-scoped
 * (no `subAgentId`) and unattributed (`mcpServerSlug: ""`, no provenance, no
 * gate). The translator layers scope and the gate's answers on top; the arms
 * that pin the wire's shape read this directly.
 */
export function normalize(event: V3ProtocolEvent): TranscriptEvent[] {
  const method = event.method;

  switch (method) {
    case "messages": return normalizeMessage(event);
    case "tools": return normalizeTool(event);
    default:
      return [];
  }
}

// ── Usage ─────────────────────────────────────────────────────────

/**
 * The token usage as LangChain's v3 protocol delivers it on a
 * `message-finish`. `input_tokens` already INCLUDES the cache buckets (the
 * Anthropic adapter folds them in); the loop prices over the disjoint parts.
 */
export interface V3UsagePayload {
  readonly input_tokens?: number;
  readonly output_tokens?: number;
  readonly total_tokens?: number;
  readonly input_token_details?: {
    readonly cache_creation?: number;
    readonly cache_read?: number;
  };
}

/**
 * The usage one raw event carries, or `undefined`. Read from `message-finish`
 * ONLY — v3 also emits a standalone `usage` event for the same turn, and
 * reading both would double-count. Every namespace's finish counts: a
 * sub-agent's spend is the execution's spend (S3 M2b, Q-M2b-1), and the cost
 * cap the runtime enforces reads the whole execution.
 *
 * A loop concern, deliberately NOT a `TranscriptEvent` (S4 M2 C1, Q-M2-3):
 * usage is neither a row nor a message, and `translate`'s return type stays
 * the one signature every harness's translator shares. The Cursor loop reads
 * its usage from the SDK's `turn-ended` delta — the same division.
 */
export function usageOf(event: V3ProtocolEvent): V3UsagePayload | undefined {
  if (event.method !== "messages") return undefined;
  const data = event.params.data as Record<string, unknown> | undefined;
  if (!data || readEventType(data) !== "message-finish") return undefined;
  return normalizeUsagePayload(data.usage as Record<string, unknown> | undefined);
}

// ── Messages Channel ──────────────────────────────────────────────

function normalizeMessage(event: V3ProtocolEvent): TranscriptEvent[] {
  const data = event.params.data as Record<string, unknown> | undefined;
  if (!data) return [];

  const eventType = readEventType(data);
  const runId = (data.run_id ?? "") as string;

  switch (eventType) {
    case "message-start":
      return [{ kind: "message_start" as const, runId }];

    case "content-block-delta":
      return normalizeContentBlockDelta(data, runId);

    case "message-finish":
      return [{ kind: "message_finish" as const, runId }];

    // Carried by the wire, not by the transcript (see the header).
    case "usage":
    case "provider":
    case "content-block-start":
    case "content-block-finish":
      return [];

    default:
      logUnknown("messages", eventType);
      return [];
  }
}

function normalizeContentBlockDelta(
  data: Record<string, unknown>,
  runId: string,
): TranscriptEvent[] {
  const delta = data.delta as Record<string, unknown> | undefined;
  if (!delta) return [];

  const deltaType = delta.type as string | undefined;

  if (deltaType === "text-delta") {
    const text = (delta.text ?? "") as string;
    if (!text) return [];
    return [{ kind: "text_delta" as const, runId, text }];
  }

  if (deltaType === "reasoning-delta") {
    const text = (delta.reasoning ?? "") as string;
    if (!text) return [];
    return [{ kind: "reasoning_delta" as const, runId, text }];
  }

  if (deltaType === "block-delta") {
    const fields = delta.fields as Record<string, unknown> | undefined;
    if (!fields) return [];
    if (fields.type === "tool_call_chunk") {
      const callId = (fields.id ?? "") as string;
      const argsChunk = (fields.args ?? "") as string;
      if (!argsChunk && !callId) return [];
      return [{ kind: "tool_arg_delta" as const, callId, argsChunk }];
    }
  }

  return [];
}

// ── Tools Channel ─────────────────────────────────────────────────

function normalizeTool(event: V3ProtocolEvent): TranscriptEvent[] {
  const data = event.params.data as Record<string, unknown> | undefined;
  if (!data) return [];

  const eventType = readEventType(data);

  switch (eventType) {
    case "tool-started": {
      const callId = readToolCallId(data);
      const name = readToolName(data);
      const input = parseToolInput(data.input);
      return [{ kind: "tool_started" as const, callId, name, input, mcpServerSlug: "" }];
    }

    case "tool-finished": {
      const callId = readToolCallId(data);
      return [{ kind: "tool_finished" as const, callId, result: extractToolResult(data.output) }];
    }

    case "tool-error": {
      const callId = readToolCallId(data);
      const message = (data.message ?? data.error ?? "") as string;
      return [{ kind: "tool_error" as const, callId, message }];
    }

    case "tool-output-delta": {
      const callId = readToolCallId(data);
      const delta = (data.delta ?? "") as string;
      return [{ kind: "tool_output_delta" as const, callId, delta: String(delta) }];
    }

    default:
      logUnknown("tools", eventType);
      return [];
  }
}

// ── Tool Result ───────────────────────────────────────────────────

/**
 * Serialize a LangChain message `content` field into the canonical tool-result
 * string.
 *
 * Text-only content is a plain string and passes through unchanged. Multimodal
 * content (image, or mixed text+image — e.g. a computer-use screenshot) is an
 * array of content blocks; we serialize the blocks array ITSELF, not the
 * surrounding message envelope, so the result lands in the exact top-level-array
 * shape the persist-time offload (`detectImagePayload`/`contentBlocks` in
 * status-offload.ts) consumes to lift the image out into a renderable
 * `ToolCallOutputRef`. Serializing the envelope instead would bury the base64
 * one level deeper and defeat that detection.
 *
 * Returns undefined when `content` is neither a string nor an array, letting the
 * caller fall back to serializing whatever else it holds.
 */
function serializeToolContent(content: unknown): string | undefined {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return JSON.stringify(content);
  return undefined;
}

/**
 * The `result: string` a `tool_finished` carries, from the v3 `tool-finished`
 * output — engine knowledge that stays on this side of the union (S4 M2 C2a,
 * Q-S4-3; it was `extractToolResultV3` in `harness/transcript/tool-result.ts`
 * between M1 and M2). v3 wraps a LangChain `ToolMessage` in a constructor
 * envelope, `{ lc, type, id, kwargs: { content, status, ... } }`; the content
 * is what the row shows. Anything else is serialized as it came.
 *
 * A state-mutating tool returns a LangGraph `Command` instead —
 * `{ lg_name: "Command", update: { ..., messages: [ToolMessage] }, goto }` —
 * with its ToolMessage nested in the update (deepagents' `write_todos` and
 * `task` both do). The row shows that ToolMessage's content, not the whole
 * Command (S4 M2 C2b, Q-S4-21; until then the row carried the serialized
 * Command, the todos array twice over — M0 finding F-M0-2).
 */
function extractToolResult(output: unknown): string {
  if (typeof output === "string") return output;
  if (typeof output === "object" && output !== null) {
    const obj = output as Record<string, unknown>;
    const commandMessage = toolMessageOfCommand(obj);
    if (commandMessage !== undefined) return extractToolResult(commandMessage);
    const kwargs = obj.kwargs as Record<string, unknown> | undefined;
    if (kwargs) {
      const fromKwargs = serializeToolContent(kwargs.content);
      if (fromKwargs !== undefined) return fromKwargs;
    }
    const fromContent = serializeToolContent(obj.content);
    if (fromContent !== undefined) return fromContent;
  }
  try {
    return JSON.stringify(output);
  } catch {
    return "[serialization error]";
  }
}

/**
 * The ToolMessage a LangGraph `Command` carries in `update.messages`, or
 * `undefined` when the object is not a Command or carries none. The LAST
 * message is the tool's own reply (a Command may prepend others); a Command
 * with no message falls through to plain serialization, so nothing is lost.
 */
function toolMessageOfCommand(obj: Record<string, unknown>): unknown {
  if (obj.lg_name !== "Command") return undefined;
  const update = obj.update as Record<string, unknown> | undefined;
  const messages = update?.messages;
  if (!Array.isArray(messages) || messages.length === 0) return undefined;
  return messages[messages.length - 1];
}

// ── Defensive Field Parsers ───────────────────────────────────────

function readEventType(data: Record<string, unknown>): string {
  return ((data.event ?? data.type) as string) ?? "";
}

function readToolCallId(data: Record<string, unknown>): string {
  return ((data.tool_call_id ?? data.toolCallId) as string) ?? "";
}

function readToolName(data: Record<string, unknown>): string {
  return ((data.tool_name ?? data.toolName ?? data.name) as string) ?? "unknown_tool";
}

function parseToolInput(raw: unknown): Record<string, unknown> {
  if (raw === undefined || raw === null) return {};
  if (typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw === "string") {
    try { return JSON.parse(raw) as Record<string, unknown>; }
    catch { return {}; }
  }
  return {};
}

function normalizeUsagePayload(raw: Record<string, unknown> | undefined): V3UsagePayload | undefined {
  if (!raw) return undefined;
  const details = raw.input_token_details as Record<string, unknown> | undefined;
  return {
    input_tokens: raw.input_tokens as number | undefined,
    output_tokens: raw.output_tokens as number | undefined,
    total_tokens: raw.total_tokens as number | undefined,
    input_token_details: details ? {
      cache_creation: details.cache_creation as number | undefined,
      cache_read: details.cache_read as number | undefined,
    } : undefined,
  };
}

function logUnknown(method: string, eventType: string): void {
  const key = `${method}:${eventType}`;
  if (loggedUnknowns.has(key)) return;
  loggedUnknowns.add(key);
  console.debug(`[DeepAgentTranslator] Unknown event: method=${method} event=${eventType}`);
}
