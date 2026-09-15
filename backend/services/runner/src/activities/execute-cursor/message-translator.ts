/**
 * Translates Cursor SDK streaming events into Stigmer AgentMessage protos.
 *
 * S4 M4 (2026-09-14): this is the FOLDING half only, and it is transient. The
 * boundary half (the denial overlay, the collapses, #205, #965, the unattended
 * stamp) moved verbatim to `boundary-rows.ts` at B2 (Q-S4-13); what remains
 * here — `MessageAccumulator`, `buildToolCallProto`, the stateless translators
 * — is the second copy of the transcript folding rule the memo counted, and is
 * deleted whole at the swap (B4) for `translator.ts` over the shared
 * `TranscriptBuilder` (`harness/transcript/builder.ts`). The ruled alignments
 * landed on it first (A1–A5) so the swap moves no golden.
 *
 * The Cursor SDK emits SDKMessage events during a Run. This module provides
 * both stateless translation (translateEvent) and stateful accumulation
 * (MessageAccumulator) for building coherent messages from token-level
 * streaming events.
 *
 * The Cursor SDK emits one SDKAssistantMessage per token chunk — a single
 * LLM turn produces dozens of events. MessageAccumulator merges them into
 * a single AgentMessage per turn, matching the Python agent-runner's
 * proven pattern (see chat_model.py handle_chat_model_stream).
 *
 * Tool calls are attached to the most recent MESSAGE_AI message rather
 * than emitted as standalone MESSAGE_TOOL messages. This matches:
 *   - The proto model (AgentMessage.tool_calls repeated field)
 *   - The Python agent-runner's StatusBuilder pattern
 *   - The UI's MessageThread expectation (tool calls on AI messages)
 *
 * Task (sub-agent) tool calls additionally produce SubAgentExecution
 * protos accessible via MessageAccumulator.subAgentExecutions.
 *
 * MCP tool enrichment:
 * Cursor reports MCP tool calls with name="mcp" and the actual details
 * (providerIdentifier, toolName, args) inside event.args. This module
 * extracts those details to populate the ToolCall proto with:
 * - name: the actual MCP tool name (e.g., "search_services")
 * - mcpServerSlug: the MCP server identifier (e.g., "planton")
 * - requiresApproval: from the merged policy chain
 * - approvalMessage: from the policy, with placeholder resolution
 */

import { create } from "@bufbuild/protobuf";
import type { JsonObject } from "@bufbuild/protobuf";
import { AgentMessageSchema, ToolCallSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import type { AgentMessage, ToolCall } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { SubAgentExecutionSchema, type SubAgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/subagent_pb";
import { MessageType, ToolCallStatus, SubAgentStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { SDKMessage } from "@cursor/sdk";
import type { MergedToolPolicy } from "./approval-policy.js";
import { lookupMcpToolPolicy, resolveApprovalMessage, builtInRequiresApproval, getBuiltInApprovalMessage, SALIENT_ARG_FIELDS } from "./approval-policy.js";
import {
  POLICY_ENGINE_VERSION,
  resolveApprovalProvenance,
  toProtoPolicySource,
} from "../../shared/approval-policy.js";
import { toolCallIdentityToken } from "./approval-state.js";
import { canonicalizeImageResult, toResultString } from "./tool-result.js";
import { utcTimestamp } from "../../shared/status.js";
import { cancelInProgressSubAgentProtos } from "../../shared/subagent-rows.js";
import { isDeclinedRow } from "../../shared/tool-row.js";
import { classifyTool, type ToolApprovalCategory } from "../../shared/tool-kind.js";
import { buildElidedArgsPreview } from "../../shared/args-preview.js";

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

/**
 * Try to extract MCP tool details from a tool_call event.
 * Returns undefined if the event is not an MCP tool call.
 */
export function extractMcpToolDetails(
  event: Extract<SDKMessage, { type: "tool_call" }>,
): McpToolDetails | undefined {
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

/**
 * Translate a single Cursor SDKMessage into zero or more Stigmer AgentMessages.
 *
 * Most events produce exactly one message. Some (like system init) are
 * informational and produce none.
 *
 * Note: for production streaming, use MessageAccumulator instead — it
 * merges token-level events and attaches tool calls to their parent AI
 * messages. This stateless function is retained for unit testing and
 * simple single-event translation.
 */
export function translateEvent(event: SDKMessage): AgentMessage[] {
  switch (event.type) {
    case "assistant":
      return [translateAssistant(event)];
    case "thinking":
      return [translateThinking(event)];
    case "tool_call":
      return [translateToolCall(event)];
    case "task":
      return event.text ? [translateTask(event)] : [];
    case "system":
    case "status":
    case "user":
    case "request":
      return [];
    default:
      return [];
  }
}

function translateAssistant(event: Extract<SDKMessage, { type: "assistant" }>): AgentMessage {
  const textBlocks = event.message.content
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text);

  return create(AgentMessageSchema, {
    type: MessageType.MESSAGE_AI,
    content: textBlocks.join(""),
    timestamp: utcTimestamp(),
  });
}

function translateThinking(event: Extract<SDKMessage, { type: "thinking" }>): AgentMessage {
  return create(AgentMessageSchema, {
    type: MessageType.MESSAGE_THINKING,
    content: event.text,
    timestamp: utcTimestamp(),
  });
}

/**
 * Stateless translation of a tool_call event into a standalone MESSAGE_TOOL
 * message. Retained for backward compatibility with translateEvent() and
 * tests that use the stateless API.
 */
function translateToolCall(event: Extract<SDKMessage, { type: "tool_call" }>): AgentMessage {
  const toolCall = buildToolCallProto(event);
  const displayName = toolCall.mcpServerSlug
    ? `${toolCall.mcpServerSlug}/${toolCall.name}`
    : toolCall.name;
  return create(AgentMessageSchema, {
    type: MessageType.MESSAGE_TOOL,
    content: `Tool: ${displayName} [${event.status}]`,
    timestamp: utcTimestamp(),
    toolCalls: [toolCall],
  });
}

/**
 * Build a ToolCall proto from a Cursor SDK tool_call event.
 *
 * For MCP tools (event.name === "mcp"), extracts the actual tool name
 * and server slug from event.args. For built-in tools, uses the event
 * name directly.
 *
 * Approval fields are populated when mergedPolicies are provided.
 * Without policies, only basic fields are set (backward compatible).
 *
 * When mergedPolicies are provided, the tool call also carries its authorization
 * provenance (approval_policy_source) — which policy layer gated or cleared it —
 * derived from the same merged policy chain the gate uses, so the Cursor
 * reconstruction is as auditable as the native harness. `provenance` supplies the
 * run-scoped context (global bypass, active leases) the per-tool map cannot.
 */
export function buildToolCallProto(
  event: Extract<SDKMessage, { type: "tool_call" }>,
  mergedPolicies?: ReadonlyMap<string, MergedToolPolicy>,
  provenance?: ApprovalProvenanceContext,
): ToolCall {
  const status = mapToolCallStatus(event.status);
  const mcpDetails = extractMcpToolDetails(event);

  const actualName = mcpDetails?.toolName ?? event.name;
  const mcpServerSlug = mcpDetails?.providerIdentifier ?? "";

  // Every row has `startedAt` — the instant the runner first learned of the
  // call (S4 M4 A3, Q-S4-17). An event that arrives already terminal, with no
  // `running` before it, therefore gets `startedAt == completedAt`; until A3
  // such a row had no `startedAt` at all, the one field the canonical builder
  // stamps at every row's creation and this path did not.
  const toolCall = create(ToolCallSchema, {
    id: event.call_id,
    name: actualName,
    status,
    startedAt: utcTimestamp(),
    completedAt: isTerminalToolStatus(status) ? utcTimestamp() : "",
    // A FAILED row carries its failure text in `error` ONLY (S4 M4 A4, Q-M4-3):
    // the SDK reports a failure as the event's `result`, and until A4 this path
    // wrote it to both fields. Native and this harness's own sub-agent rows
    // write `error` alone; every reader shows `error || result`; and the
    // duplicate made a hook-denied shell twin look like a row "carrying its
    // own change" to the twin collapse (`carriesOwnChange` reads `result`),
    // so the duplicate card the collapse exists to hide survived (F-M4-2).
    result: status === ToolCallStatus.TOOL_CALL_FAILED ? "" : toResultString(event.result),
    error: status === ToolCallStatus.TOOL_CALL_FAILED
      ? (typeof event.result === "string" ? event.result : "Tool call failed")
      : "",
    mcpServerSlug,
    toolKind: classifyTool(actualName, mcpServerSlug),
  });

  const argsObj = mcpDetails?.innerArgs ?? (
    typeof event.args === "object" && event.args !== null
      ? event.args as Record<string, unknown>
      : undefined
  );
  if (argsObj && typeof argsObj === "object") {
    toolCall.args = argsObj as import("@bufbuild/protobuf").JsonObject;
    stampArgsPreview(toolCall, argsObj);
  } else if (typeof event.args === "string") {
    toolCall.argsPreview = event.args;
  }

  // Populate approval fields from the merged policy chain
  if (mergedPolicies && mcpDetails) {
    const policy = lookupMcpToolPolicy(actualName, mcpServerSlug, mergedPolicies);
    if (policy) {
      toolCall.requiresApproval = true;
      toolCall.approvalMessage = resolveApprovalMessage(
        policy.approvalMessage,
        actualName,
        mcpDetails.innerArgs,
      );
      if (status === ToolCallStatus.TOOL_CALL_FAILED) {
        toolCall.approvalRequestedAt = utcTimestamp();
      }
    }
  } else if (mergedPolicies && !mcpDetails) {
    const requires = builtInRequiresApproval(actualName);
    toolCall.requiresApproval = requires;
    if (requires) {
      const template = getBuiltInApprovalMessage(actualName);
      if (template) {
        toolCall.approvalMessage = resolveApprovalMessage(template, actualName, argsObj ?? {});
        if (status === ToolCallStatus.TOOL_CALL_FAILED) {
          toolCall.approvalRequestedAt = utcTimestamp();
        }
      }
    }
  }

  // Stamp authorization provenance from the same merged policy chain the gate
  // (the deny-oracle hook + this map) uses, so the persisted record explains WHY
  // each tool was gated or cleared. Only when policies are present — the stateless
  // path leaves it UNSPECIFIED, like an unclassified tool_kind.
  if (mergedPolicies) {
    const source = resolveApprovalProvenance(
      actualName,
      mcpServerSlug,
      mergedPolicies,
      provenance?.leasedCategories ?? NO_LEASED_CATEGORIES,
      provenance?.globalBypass ?? false,
    );
    toolCall.approvalPolicySource = toProtoPolicySource(source);
    if (source) toolCall.policyEngineVersion = POLICY_ENGINE_VERSION;
  }

  return toolCall;
}

/**
 * The row's `args_preview`, on EVERY row with args, from the row's OWN args
 * through the platform's one sanitizer (S4 M4 A2, Q-S4-16): elided past 200
 * chars per value, salient fields verbatim, secret keys redacted — the rule
 * the canonical builder already applies to native rows (`harness/transcript/
 * builder.ts` `stampArgsPreview`) and the gate path applied to a proposed row
 * (`applyGateInput`). Until A2 the stream path stamped `JSON.stringify` of the
 * EVENT's args, unredacted and, for an MCP call, the outer `{ providerIdentifier,
 * toolName, args }` envelope rather than the arguments. For short, secret-free
 * args the two render identically. An empty preview (a cycle) leaves the
 * field unset rather than failing the row.
 */
function stampArgsPreview(tc: ToolCall, args: Record<string, unknown>): void {
  const preview = buildElidedArgsPreview(args, SALIENT_ARG_FIELDS);
  if (preview) tc.argsPreview = preview;
}

/**
 * Run-scoped approval context the Cursor reconstruction needs to attribute a tool
 * call's provenance beyond the per-tool merged policy map: the pre-armed global
 * bypass and the built-in categories holding a run-lifetime lease.
 */
export interface ApprovalProvenanceContext {
  readonly globalBypass: boolean;
  readonly leasedCategories: ReadonlySet<ToolApprovalCategory>;
}

/** Shared empty set so a reconstruction without leases allocates nothing. */
const NO_LEASED_CATEGORIES: ReadonlySet<ToolApprovalCategory> = new Set();

function translateTask(event: Extract<SDKMessage, { type: "task" }>): AgentMessage {
  return create(AgentMessageSchema, {
    type: MessageType.MESSAGE_SYSTEM,
    content: event.text ?? "",
    timestamp: utcTimestamp(),
  });
}

function mapToolCallStatus(cursorStatus: string): ToolCallStatus {
  switch (cursorStatus) {
    case "running":
      return ToolCallStatus.TOOL_CALL_RUNNING;
    case "completed":
      return ToolCallStatus.TOOL_CALL_COMPLETED;
    case "error":
      return ToolCallStatus.TOOL_CALL_FAILED;
    default:
      return ToolCallStatus.TOOL_CALL_STATUS_UNSPECIFIED;
  }
}

function mapSubAgentStatus(cursorStatus: string): SubAgentStatus {
  switch (cursorStatus) {
    case "running":
      return SubAgentStatus.SUB_AGENT_IN_PROGRESS;
    case "completed":
      return SubAgentStatus.SUB_AGENT_COMPLETED;
    case "error":
      return SubAgentStatus.SUB_AGENT_FAILED;
    default:
      return SubAgentStatus.SUB_AGENT_PENDING;
  }
}

/**
 * Terminal for the MONOTONIC status guard in {@link mergeToolCallEvent}: once a
 * row reaches one of these, a later event re-emit must not regress it.
 *
 * TOOL_CALL_INTERRUPTED is deliberately NOT here, even though it is terminal
 * everywhere else (server, clients, provenance scoping — see the shared
 * TERMINAL_TOOL_CALL_STATUSES in tool-row.ts). INTERRUPTED is server-authored
 * when an execution terminalizes with the call in flight; if that FAILED
 * execution is later RECOVERED, the harness checkpoint can re-execute the call
 * under its original call id — and live execution evidence outranks the
 * interruption marker, so the replayed event must advance the row to its true
 * outcome (the enum's documented recovery supersede rule).
 */
function isTerminalToolStatus(status: ToolCallStatus): boolean {
  return (
    status === ToolCallStatus.TOOL_CALL_COMPLETED ||
    status === ToolCallStatus.TOOL_CALL_FAILED ||
    status === ToolCallStatus.TOOL_CALL_SKIPPED
  );
}

/**
 * Extract sub-agent name from task tool args, handling both the
 * legacy string format (`"generalPurpose"`) and the current SDK
 * object format (`{ kind: "generalPurpose", name?: "..." }`).
 *
 * Falls back to `description` (always populated by the SDK) before
 * returning the generic `"task"`. The `kind` value `"unspecified"`
 * is treated as absent since the Cursor SDK uses it as a default
 * when the sub-agent type is not specified in the blueprint.
 */
function extractSubagentName(args: unknown): string {
  if (args == null || typeof args !== "object") return "task";
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

  return "task";
}

function safeString(obj: unknown, key: string): string {
  if (obj != null && typeof obj === "object" && key in obj) {
    const val = (obj as Record<string, unknown>)[key];
    return typeof val === "string" ? val : "";
  }
  return "";
}

/**
 * Parse the task tool's completed result into AgentMessages.
 *
 * The Cursor SDK returns sub-agent work as a blob in the task tool's
 * completed event (not as streaming events with a distinct agent_id).
 * Re-verified 2026-08-23 on the pinned SDK (1.0.13) AND the latest (1.0.28),
 * this time including the write side (stigmer/stigmer#839): an injected
 * platform.eventStore/eventNotifier receives parent events only on 1.0.13 and
 * is bypassed entirely on 1.0.28 (persistence moved into the executor daemon's
 * own state dir); zero events reach the parent's run.stream() mid-task; the
 * agentId in the task args is not a platform-store agent id at all, so it can
 * never be addressable via Agent.listRuns / Agent.getRun (this is WHY the
 * 2026-07-02 read-side polls all returned not-found). On 1.0.28 the child
 * transcript lands at a deterministic path knowable at spawn
 * (~/.cursor/projects/<slug>/agent-transcripts/<parentId>/subagents/<argsAgentId>.jsonl)
 * but is flushed only at completion — verified with 200ms sampling across a
 * full sub-agent run. Live nested visibility is therefore still an upstream
 * SDK limitation — do not try to fake it here; the UI shows an elapsed-time
 * affordance instead (SubAgentSection). Probe scripts and recordings:
 * stigmer-cloud _projects/2026-08/20260823.03.cursor-subagent-live-progress.
 * The result shape is:
 *
 *   { status: "success", value: { conversationSteps: ConversationStep[] } }
 *
 * where each ConversationStep is a protobuf-oneof object keyed DIRECTLY by its
 * kind (there is NO `{ type, message }` envelope — verified against production
 * sub-agent blobs; see the `buildSubAgentToolCall` note):
 *   - { thinkingMessage: { text, thinkingDurationMs? } }
 *   - { assistantMessage: { text } }
 *   - { toolCall: { toolCallId, <kind>ToolCall: { args, result } } }
 *
 * This function defensively parses whatever steps are present and
 * appends corresponding AgentMessage protos to the output array.
 * Unknown step types are silently skipped for forward compatibility.
 */
export function extractConversationSteps(
  result: unknown,
  out: AgentMessage[],
): void {
  if (result == null || typeof result !== "object") return;
  const r = result as Record<string, unknown>;

  const value = r.value ?? r;
  if (value == null || typeof value !== "object") return;
  const v = value as Record<string, unknown>;

  const steps = v.conversationSteps;
  if (!Array.isArray(steps)) return;

  for (const [index, step] of steps.entries()) {
    if (step == null || typeof step !== "object") continue;
    const s = step as Record<string, unknown>;
    const type = s.type as string | undefined;

    if (type === "thinkingMessage" || s.thinkingMessage != null) {
      const msg = (type === "thinkingMessage" ? s.message : s.thinkingMessage) as Record<string, unknown> | undefined;
      const text = typeof msg?.text === "string" ? msg.text : "";
      if (text) {
        out.push(create(AgentMessageSchema, {
          type: MessageType.MESSAGE_THINKING,
          content: text,
          timestamp: utcTimestamp(),
        }));
      }
    } else if (type === "assistantMessage" || s.assistantMessage != null) {
      const msg = (type === "assistantMessage" ? s.message : s.assistantMessage) as Record<string, unknown> | undefined;
      const text = typeof msg?.text === "string" ? msg.text : "";
      if (text) {
        out.push(create(AgentMessageSchema, {
          type: MessageType.MESSAGE_AI,
          content: text,
          timestamp: utcTimestamp(),
        }));
      }
    } else if (s.toolCall != null) {
      const tc = buildSubAgentToolCall(s.toolCall, index);
      if (tc) {
        // The AI-message boundary, the same rule as the root transcript's
        // (S4 M4 A5, Q-S4-5): a tool row joins the message whose text
        // proposed it — the transcript's last AI message — and gets an empty
        // one only when the transcript has none yet. Until A5 every tool
        // step was its own `content: ""` message, the shape native's
        // sub-agent tracker had before M2 fixed F-M0-1.
        const host = lastAiMessage(out);
        if (host) {
          host.toolCalls.push(tc);
        } else {
          out.push(create(AgentMessageSchema, {
            type: MessageType.MESSAGE_AI,
            content: "",
            timestamp: utcTimestamp(),
            toolCalls: [tc],
          }));
        }
      }
    }
  }
}

/** The last MESSAGE_AI in a transcript, or undefined — the host a tool row joins. */
function lastAiMessage(messages: readonly AgentMessage[]): AgentMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].type === MessageType.MESSAGE_AI) return messages[i];
  }
  return undefined;
}

/**
 * The failure branches of a sub-agent tool call's `result` oneof. A completion
 * is `{ success: ... }`; every other branch is a non-completion the UI must show
 * as failed — an errored read/glob/grep (`error`), or a shell the approval gate
 * stopped (`permissionDenied` / `rejected`).
 */
const SUBAGENT_TOOL_RESULT_FAILURE_KEYS = new Set([
  "error",
  "permissionDenied",
  "rejected",
]);

/**
 * Build a ToolCall proto from one sub-agent `toolCall` conversation step.
 *
 * The Cursor SDK serializes a sub-agent's tool call as protobuf-oneof JSON:
 *
 *   { toolCallId, <kind>ToolCall: { args, result } }
 *
 * The tool family is the lone `<kind>ToolCall` sibling of `toolCallId` (e.g.
 * `readToolCall`, `globToolCall`, `grepToolCall`, `shellToolCall`); the bare
 * tool name (`read`) is the suffix-stripped key, which feeds the shared
 * {@link classifyTool} exactly like a top-level call. `result` is itself a oneof
 * `{ success | error | permissionDenied | rejected }` (see
 * {@link interpretSubAgentToolResult}).
 *
 * This is deliberately key-driven rather than an enumerated switch, so a new
 * tool family the SDK adds surfaces automatically instead of being dropped.
 * Returns undefined when no `<kind>ToolCall` key is present (a malformed or
 * forward-incompatible step), so the caller skips it rather than emitting a
 * blank, nameless tool call.
 *
 * History: an earlier revision parsed a `{ type: "toolCall", message: { type,
 * args, result: { status, value } } }` envelope. That shape never appears in the
 * real task-result blob (confirmed against production sub-agent outputs and the
 * WA03 capture), so every sub-agent tool call was silently discarded and the UI
 * showed a sub-agent that "did nothing".
 */
function buildSubAgentToolCall(
  toolCall: unknown,
  stepIndex: number,
): ToolCall | undefined {
  if (toolCall == null || typeof toolCall !== "object") return undefined;
  const obj = toolCall as Record<string, unknown>;

  const kindKey = Object.keys(obj).find(
    (k) => k !== "toolCallId" && k.endsWith("ToolCall"),
  );
  if (!kindKey) return undefined;

  const name = kindKey.slice(0, -"ToolCall".length);
  const inner =
    obj[kindKey] != null && typeof obj[kindKey] === "object"
      ? (obj[kindKey] as Record<string, unknown>)
      : {};
  // Prefer the SDK's real call id so the row is stable across resumes and never
  // collides with a sibling; fall back to a synthetic id from the step's INDEX
  // in `conversationSteps` only when the SDK omits one (the index, not the
  // message count: two tool steps can share a message since A5).
  const id =
    typeof obj.toolCallId === "string" && obj.toolCallId
      ? obj.toolCallId
      : `sub-${name}-${stepIndex}`;

  const { status, result, error } = interpretSubAgentToolResult(inner.result);

  const tc = create(ToolCallSchema, {
    id,
    name,
    status,
    result,
    error,
    startedAt: utcTimestamp(),
    completedAt: utcTimestamp(),
    toolKind: classifyTool(name),
  });

  if (inner.args != null && typeof inner.args === "object") {
    tc.args = inner.args as JsonObject;
    stampArgsPreview(tc, inner.args as Record<string, unknown>);
  }
  return tc;
}

/**
 * Map a sub-agent tool call's `result` oneof to a (status, result, error)
 * triple. `success` → COMPLETED with the serialized payload (a screenshot is
 * canonicalized the same way as a top-level result); any failure branch (see
 * {@link SUBAGENT_TOOL_RESULT_FAILURE_KEYS}) → FAILED with the serialized
 * detail. An absent result is a COMPLETED call with no output — the SDK omits
 * `result` for a call that reports nothing.
 */
function interpretSubAgentToolResult(result: unknown): {
  status: ToolCallStatus;
  result: string;
  error: string;
} {
  if (result == null || typeof result !== "object") {
    return { status: ToolCallStatus.TOOL_CALL_COMPLETED, result: "", error: "" };
  }
  const r = result as Record<string, unknown>;

  if ("success" in r) {
    const val = r.success;
    const str =
      canonicalizeImageResult(val) ??
      (typeof val === "string" ? val : JSON.stringify(val));
    return { status: ToolCallStatus.TOOL_CALL_COMPLETED, result: str, error: "" };
  }

  const failKey = Object.keys(r).find((k) =>
    SUBAGENT_TOOL_RESULT_FAILURE_KEYS.has(k),
  );
  if (failKey) {
    const val = r[failKey];
    const detail = typeof val === "string" ? val : JSON.stringify(val);
    return { status: ToolCallStatus.TOOL_CALL_FAILED, result: "", error: detail };
  }

  // Unknown oneof branch — surface it as a completed result rather than drop it.
  return {
    status: ToolCallStatus.TOOL_CALL_COMPLETED,
    result: JSON.stringify(r),
    error: "",
  };
}

/**
 * Options for creating a MessageAccumulator with policy awareness.
 */
export interface MessageAccumulatorOptions {
  mergedPolicies?: ReadonlyMap<string, MergedToolPolicy>;
  /**
   * Run-scoped approval context (global bypass + active leases) so reconstructed
   * tool calls carry their authorization provenance. Omitted in unit tests that
   * only assert basic translation; provenance then stays UNSPECIFIED.
   */
  provenance?: ApprovalProvenanceContext;
  /**
   * Absolute workspace root, used to render file-change paths relative to the
   * workspace (with the absolute path retained). Omitted in unit tests, in
   * which case raw tool-arg paths are used verbatim.
   */
  workspaceRoot?: string;
  /**
   * The status's own `subAgentExecutions` array, wrapped BY REFERENCE exactly
   * as `messages` is: the accumulator upserts into it in place, so the rows
   * the runtime seeded on a resume (`harness/turn-context.ts`
   * `seedFromPersistedStatus`) are indexed by id at construction and a
   * resumed sub-agent's lifecycle updates merge onto its seeded row instead
   * of producing a duplicate. Omitted in unit tests that only assert basic
   * translation; the accumulator then owns a private array.
   */
  subAgentExecutions?: SubAgentExecution[];
}

/**
 * Stateful accumulator that merges per-token SDK events into coherent
 * AgentMessages.
 *
 * The Cursor SDK emits one `assistant` event per token chunk (validated:
 * a 2-sentence response produces ~41 events). Without accumulation each
 * chunk becomes a separate AgentMessage, causing the UI to render each
 * word on its own line.
 *
 * MessageAccumulator tracks the active AI and thinking messages per
 * run_id. Consecutive assistant events for the same run_id append to
 * the existing message's content instead of creating new ones.
 *
 * Tool calls are attached to the most recent MESSAGE_AI message's
 * toolCalls array — matching the Python agent-runner's StatusBuilder
 * pattern and the UI's MessageThread expectations.
 *
 * Tool call lifecycle is tracked via a `toolCallIndex` map (keyed by
 * call_id), mirroring the native harness's `TranscriptState.toolCalls`.
 * This ensures completion events always find the correct ToolCall proto
 * regardless of which AI message it was originally attached to — the
 * index stores the same object reference that lives in the message's
 * `toolCalls[]` array, so mutations propagate directly to the proto.
 *
 * Task (sub-agent) tool calls additionally produce SubAgentExecution
 * protos, accessible via the subAgentExecutions getter.
 */

export class MessageAccumulator {
  private readonly messages: AgentMessage[];
  private activeAiByRunId = new Map<string, AgentMessage>();
  private activeThinkingByRunId = new Map<string, AgentMessage>();
  private readonly _subAgentExecutions: SubAgentExecution[];
  private readonly subAgentMap = new Map<string, SubAgentExecution>();
  private readonly mergedPolicies?: ReadonlyMap<string, MergedToolPolicy>;
  private readonly provenance?: ApprovalProvenanceContext;
  private readonly workspaceRoot?: string;
  private readonly toolCallIndex = new Map<string, ToolCall>();
  private _dirty = false;

  constructor(messages: AgentMessage[], options?: MessageAccumulatorOptions) {
    this.messages = messages;
    this._subAgentExecutions = options?.subAgentExecutions ?? [];
    this.mergedPolicies = options?.mergedPolicies;
    this.provenance = options?.provenance;
    this.workspaceRoot = options?.workspaceRoot;

    // Resume seeding. When constructed over a pre-seeded status (the runtime's
    // `seedFromPersistedStatus` on a resume), rebuild the by-id indexes so a
    // cross-message completion for a seeded call resolves onto the existing
    // proto and a resumed sub-agent's lifecycle updates merge onto its seeded
    // row. A first run carries an empty status, so both are no-ops.
    this.rebuildToolCallIndex();
    this.rebuildSubAgentIndex();
  }

  /** Index every sub-agent row already present in the (seeded) array by its id, so upserts land on it. */
  private rebuildSubAgentIndex(): void {
    for (const sub of this._subAgentExecutions) {
      if (sub.id) this.subAgentMap.set(sub.id, sub);
    }
  }

  /**
   * Index every tool call already present in the (seeded) transcript by its
   * call_id. Called once at construction: on a first run the transcript is empty
   * (no-op); on a resume it lets re-emitted lifecycle events for a previously
   * committed call_id reconcile onto the existing proto instead of duplicating.
   */
  private rebuildToolCallIndex(): void {
    this.toolCallIndex.clear();
    for (const message of this.messages) {
      for (const tc of message.toolCalls) {
        if (tc.id) this.toolCallIndex.set(tc.id, tc);
      }
    }
  }

  get subAgentExecutions(): SubAgentExecution[] {
    return this._subAgentExecutions;
  }

  /**
   * True when a discrete, user-visible state change has accumulated since the
   * last markPersisted(): a tool call created or transitioned to a terminal
   * status, or a sub-agent execution created or updated. The streaming loop
   * treats this as a force-flush signal so the live UI surfaces a tool call the
   * instant it starts and completes, and a sub-agent's IN_PROGRESS state the
   * instant delegation begins — instead of waiting for the scheduler's time
   * cadence or the parent finalizing.
   *
   * High-frequency token deltas (assistant text, model thinking) deliberately do
   * NOT set this flag; they ride the StreamingUpdateScheduler's time cadence so
   * we avoid a per-token persist storm — matching the native harness, which only
   * force-flushes on discrete tool start/end events.
   */
  get isDirty(): boolean {
    return this._dirty;
  }

  /** Clears the dirty flag after the latest status has been persisted. */
  markPersisted(): void {
    this._dirty = false;
  }

  /**
   * Transition any non-terminal sub-agent (IN_PROGRESS or PENDING) to CANCELLED.
   *
   * Called when the parent run is aborted (pause / cancel / worker shutdown):
   * the Cursor SDK run stops, so a delegated sub-agent is no longer executing.
   * Without this, the final snapshot would show a permanent "Running" zombie
   * sub-agent. Mirrors the native harness's cancelSubAgents().
   */
  cancelInProgressSubAgents(): void {
    if (cancelInProgressSubAgentProtos(this._subAgentExecutions)) {
      this._dirty = true;
    }
  }

  processEvent(event: SDKMessage): void {
    switch (event.type) {
      case "assistant":
        this.accumulateAssistant(event);
        break;
      case "thinking":
        this.accumulateThinking(event);
        break;
      case "tool_call":
        this.finalizeStreaming(event.run_id);
        this.attachToolCallToLastAi(event);
        break;
      case "task":
        if (event.text) {
          this.messages.push(translateTask(event));
        }
        break;
    }
  }

  finalize(): void {
    for (const msg of this.activeAiByRunId.values()) {
      msg.isStreaming = false;
    }
    for (const msg of this.activeThinkingByRunId.values()) {
      msg.isStreaming = false;
    }
    this.activeAiByRunId.clear();
    this.activeThinkingByRunId.clear();
  }

  /**
   * Attach a tool call to the current AI message, upserting by `call_id` so a
   * single call maps to at most ONE ToolCall across all messages.
   *
   * The Cursor SDK can emit the lifecycle for one `call_id` more than once —
   * observed in production as two "running" events ~0.5s apart for task/edit
   * tools, which previously appended a duplicate ToolCall (the same call
   * rendered two or three times in the UI). We therefore index by `call_id`
   * and merge subsequent events into the existing proto, mirroring how
   * trackSubAgentExecution() upserts via subAgentMap. The first event for a
   * `call_id` (running or terminal) creates the proto on the last AI message;
   * the index keeps pointing at it even after later assistant text starts a
   * new AI message, so cross-message completions still land on the original.
   */
  private attachToolCallToLastAi(
    event: Extract<SDKMessage, { type: "tool_call" }>,
  ): void {
    const existing = this.toolCallIndex.get(event.call_id);
    if (existing) {
      this.mergeToolCallEvent(existing, event);
      return;
    }

    const tc = buildToolCallProto(event, this.mergedPolicies, this.provenance);

    // Resume reconciliation. A resumed Cursor agent re-runs a previously
    // approved tool with a BRAND-NEW call_id, so it misses the by-id index
    // above. Reconcile it onto the seeded WAITING_APPROVAL call with the same
    // canonical identity (the (category, salient)/MCP-name space the hook and
    // grants already use — see toolCallIdentityToken) and keep the original id.
    // Without this the seeded approved call and the re-run would both appear (a
    // duplicate row) and dropping the seeded id would trip the backend's
    // append-only-at-identity guard, stalling the run. This generalizes what
    // the native builder does by exact tool_call_id (`TranscriptBuilder`'s resume
    // reconciliation; its v2 predecessor matched by tool name) to the full
    // Cursor identity, reusing the single existing identity definition rather
    // than introducing a parallel one.
    const seeded = this.findResumableSeededToolCall(tc);
    if (seeded) {
      // Re-key the fresh call_id onto the seeded proto so this call_id's later
      // lifecycle events resolve here, then merge in place. mergeToolCallEvent
      // advances WAITING_APPROVAL (non-terminal) toward the event's status.
      this.toolCallIndex.set(event.call_id, seeded);
      this.mergeToolCallEvent(seeded, event);
      return;
    }

    this.findOrCreateLastAiMessage().toolCalls.push(tc);
    this.toolCallIndex.set(event.call_id, tc);
    // A new tool call is a discrete, user-visible event — force a prompt
    // flush so the live UI surfaces it the instant it starts.
    this._dirty = true;
  }

  /**
   * Find a seeded, still-gated tool call this resumed event should reconcile
   * onto: the first tool call in the index that is still WAITING_APPROVAL and
   * shares the candidate's canonical identity token. "First" (Map iteration =
   * transcript order) mirrors the v2 deep-agent's ordered first-unreconciled
   * match — once reconciled a call leaves WAITING_APPROVAL, so a second co-
   * pending call with the same identity naturally reconciles onto the next one.
   * Tool calls created during this turn are not WAITING_APPROVAL until the
   * post-stream denial reconciliation runs, so they can never be matched here.
   *
   * Only a row whose decision EXECUTES is resumable: the re-issue after an
   * APPROVE is the approved act itself, landing on its row. A row the user
   * declined (SKIP / REJECT) is a closed gate — a later same-identity call is a
   * NEW act the model was told not to perform, and it gets its own row so the
   * hook's denial gates it afresh instead of landing on the declined row and
   * inheriting its decision (S2 M4 finding F9, the accumulator's half; the
   * denial overlay's half is {@link isAdjudicatedRow}).
   */
  private findResumableSeededToolCall(candidate: ToolCall): ToolCall | undefined {
    const wanted = toolCallIdentityToken(candidate);
    for (const tc of this.toolCallIndex.values()) {
      if (
        tc.status === ToolCallStatus.TOOL_CALL_WAITING_APPROVAL &&
        !isDeclinedRow(tc) &&
        toolCallIdentityToken(tc) === wanted
      ) {
        return tc;
      }
    }
    return undefined;
  }

  /**
   * Merge a repeated tool_call event into the ToolCall already tracked for this
   * `call_id`. The merge is defensive because a re-emitted event may carry less
   * information than an earlier one (a late "running" after "completed", or a
   * completion with an empty result): status only advances toward terminal,
   * timestamps are stamped once, and a populated result/args is never clobbered
   * by an empty one.
   */
  private mergeToolCallEvent(
    existing: ToolCall,
    event: Extract<SDKMessage, { type: "tool_call" }>,
  ): void {
    const status = mapToolCallStatus(event.status);
    const wasTerminal = isTerminalToolStatus(existing.status);

    // Status advances monotonically: once terminal (completed/failed/skipped)
    // a later "running" re-emit must not regress it back to RUNNING.
    if (!isTerminalToolStatus(existing.status)) {
      existing.status = status;
    }
    if (isTerminalToolStatus(status) && !existing.completedAt) {
      existing.completedAt = utcTimestamp();
    }

    // The running -> terminal transition is the user-visible "tool finished"
    // moment — force a prompt flush so the result appears live rather than at
    // the next scheduler tick. Repeated terminal re-emits (already terminal) do
    // not re-flag: that would be noise, not a state change.
    if (!wasTerminal && isTerminalToolStatus(status)) {
      this._dirty = true;
    }
    // No `startedAt` stamp on a re-emit: every row this accumulator creates has
    // one from its first event (A3), and a seeded row an older runner wrote
    // without one keeps the honest gap rather than the re-run's instant.

    // Only a non-empty incoming result overwrites; a result-less "running"
    // re-emit must not wipe a result captured on completion (or vice versa).
    // A failure's text is its `error`, never its `result` (A4, Q-M4-3).
    if (status === ToolCallStatus.TOOL_CALL_FAILED) {
      if (!existing.error) {
        existing.error = typeof event.result === "string"
          ? event.result
          : "Tool call failed";
      }
      if (existing.requiresApproval && !existing.approvalRequestedAt) {
        existing.approvalRequestedAt = utcTimestamp();
      }
    } else {
      const incomingResult = toResultString(event.result);
      if (incomingResult) {
        existing.result = incomingResult;
      }
    }

    if (event.args != null && !existing.argsPreview) {
      const argsObj = extractMcpToolDetails(event)?.innerArgs ?? (
        typeof event.args === "object" && event.args !== null
          ? event.args as Record<string, unknown>
          : undefined
      );
      if (argsObj) {
        stampArgsPreview(existing, argsObj);
      } else if (typeof event.args === "string") {
        existing.argsPreview = event.args;
      }
    }
  }

  private findOrCreateLastAiMessage(): AgentMessage {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      if (this.messages[i].type === MessageType.MESSAGE_AI) {
        return this.messages[i];
      }
    }
    const msg = create(AgentMessageSchema, {
      type: MessageType.MESSAGE_AI,
      content: "",
      timestamp: utcTimestamp(),
    });
    this.messages.push(msg);
    return msg;
  }

  trackSubAgentExecution(
    event: Extract<SDKMessage, { type: "tool_call" }>,
  ): SubAgentExecution | undefined {
    const existing = this.subAgentMap.get(event.call_id);

    if (existing) {
      existing.status = mapSubAgentStatus(event.status);
      if (event.status === "completed" || event.status === "error") {
        existing.completedAt = utcTimestamp();
      }
      if (event.status === "completed" && event.result != null) {
        existing.output = typeof event.result === "string"
          ? event.result
          : JSON.stringify(event.result);
        extractConversationSteps(event.result, existing.messages);
      }
      if (event.status === "error") {
        existing.error = typeof event.result === "string"
          ? event.result
          : "Sub-agent failed";
      }
      this._dirty = true;
      return existing;
    }

    const sub = create(SubAgentExecutionSchema, {
      id: event.call_id,
      name: extractSubagentName(event.args),
      subject: safeString(event.args, "description"),
      input: safeString(event.args, "prompt"),
      status: mapSubAgentStatus(event.status),
      startedAt: utcTimestamp(),
    });
    this._subAgentExecutions.push(sub);
    this.subAgentMap.set(event.call_id, sub);
    this._dirty = true;
    return sub;
  }

  private accumulateAssistant(
    event: Extract<SDKMessage, { type: "assistant" }>,
  ): void {
    const text = event.message.content
      .filter((b): b is { type: "text"; text: string } => b.type === "text")
      .map((b) => b.text)
      .join("");

    if (!text) return;

    const existing = this.activeAiByRunId.get(event.run_id);
    if (existing) {
      existing.content += text;
      return;
    }

    const msg = create(AgentMessageSchema, {
      type: MessageType.MESSAGE_AI,
      content: text,
      timestamp: utcTimestamp(),
      isStreaming: true,
    });
    this.messages.push(msg);
    this.activeAiByRunId.set(event.run_id, msg);
  }

  private accumulateThinking(
    event: Extract<SDKMessage, { type: "thinking" }>,
  ): void {
    if (!event.text) return;

    const existing = this.activeThinkingByRunId.get(event.run_id);
    if (existing) {
      existing.content += event.text;
      return;
    }

    const msg = create(AgentMessageSchema, {
      type: MessageType.MESSAGE_THINKING,
      content: event.text,
      timestamp: utcTimestamp(),
      isStreaming: true,
    });
    this.messages.push(msg);
    this.activeThinkingByRunId.set(event.run_id, msg);
  }

  private finalizeStreaming(runId: string): void {
    const ai = this.activeAiByRunId.get(runId);
    if (ai) {
      ai.isStreaming = false;
      this.activeAiByRunId.delete(runId);
    }
    const thinking = this.activeThinkingByRunId.get(runId);
    if (thinking) {
      thinking.isStreaming = false;
      this.activeThinkingByRunId.delete(runId);
    }
  }
}
