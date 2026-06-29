/**
 * Translates Cursor SDK streaming events into Stigmer AgentMessage protos.
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
import type { AgentMessage, ToolCall, FileChange } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { SubAgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/subagent_pb";
import type { SubAgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/subagent_pb";
import { MessageType, ToolCallStatus, SubAgentStatus, ToolKind, FileChangeType, FileChangeCaptureLevel } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { SDKMessage } from "@cursor/sdk";
import type { MergedToolPolicy } from "./approval-policy.js";
import { lookupMcpToolPolicy, resolveApprovalMessage, builtInRequiresApproval, getBuiltInApprovalMessage, SALIENT_ARG_FIELDS } from "./approval-policy.js";
import {
  POLICY_ENGINE_VERSION,
  resolveApprovalProvenance,
  toProtoPolicySource,
} from "../../shared/approval-policy.js";
import { grantToken, primaryToken, toolIdentity, type DeniedLedgerEntry } from "./approval-state.js";
import { utcTimestamp } from "../../shared/status.js";
import { classifyTool, toolApprovalCategory, type ToolApprovalCategory } from "../../shared/tool-kind.js";
import { buildFileChange, resolveWorkspacePath } from "../../shared/file-change.js";
import { buildGateFileChange } from "../../shared/gate-file-change.js";
import { contentDigest, extractFilePath, extractWriteContent } from "../../shared/file-tools.js";
import { buildElidedArgsPreview } from "../../shared/args-preview.js";
import type { WorkspaceBackend } from "../../shared/workspace/types.js";

export { utcTimestamp };

const SUPPRESSED_TOOL_NAMES = new Set(["TodoWrite", "updateTodos"]);

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
  mergedPolicies?: Map<string, MergedToolPolicy>,
  provenance?: ApprovalProvenanceContext,
): ToolCall {
  const status = mapToolCallStatus(event.status);
  const mcpDetails = extractMcpToolDetails(event);

  const actualName = mcpDetails?.toolName ?? event.name;
  const mcpServerSlug = mcpDetails?.providerIdentifier ?? "";

  const toolCall = create(ToolCallSchema, {
    id: event.call_id,
    name: actualName,
    status,
    startedAt: status === ToolCallStatus.TOOL_CALL_RUNNING ? utcTimestamp() : "",
    completedAt: isTerminalToolStatus(status) ? utcTimestamp() : "",
    result: toResultString(event.result),
    error: status === ToolCallStatus.TOOL_CALL_FAILED
      ? (typeof event.result === "string" ? event.result : "Tool call failed")
      : "",
    mcpServerSlug,
    toolKind: classifyTool(actualName, mcpServerSlug),
  });

  if (event.args != null) {
    toolCall.argsPreview = typeof event.args === "string"
      ? event.args
      : JSON.stringify(event.args);
  }

  const argsObj = mcpDetails?.innerArgs ?? (
    typeof event.args === "object" && event.args !== null
      ? event.args as Record<string, unknown>
      : undefined
  );
  if (argsObj && typeof argsObj === "object") {
    toolCall.args = argsObj as import("@bufbuild/protobuf").JsonObject;
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

/**
 * Extract the `value` object from a Cursor edit-result envelope
 * (`{ status, value: { diffString, linesAdded, linesRemoved } }`). Accepts the
 * result as a string or an already-parsed object, mirroring `normalizeEdit` in
 * the SDK's tool-view. Returns undefined when no envelope value is present (e.g.
 * a "running" event that carries no diff yet).
 */
function editEnvelopeValue(result: unknown): Record<string, unknown> | undefined {
  let obj: unknown = result;
  if (typeof result === "string") {
    try {
      obj = JSON.parse(result);
    } catch {
      return undefined;
    }
  }
  if (!obj || typeof obj !== "object") return undefined;
  const value = (obj as Record<string, unknown>).value;
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

/**
 * Build the WHOLE_FILE CREATE for a STREAMING Cursor write tool call from its
 * args alone — no IO. This is the streaming (NOT gate) path: the tool is running
 * or has completed, so a disk read would observe the post-edit content; the args
 * carry the authoritative new body, presented as a CREATE (the established
 * streaming behavior). The gate path uses {@link buildGateFileChange}, which
 * reads `before` for a true before/after — see applyGateInput.
 *
 * Field extraction goes through the shared {@link extractFilePath} /
 * {@link extractWriteContent} so the stream and gate paths recognize the same
 * fields. Returns undefined for a missing path or absent content (an empty
 * string is a real empty file and is preserved).
 */
function buildStreamWriteChange(
  args: Record<string, unknown>,
  workspaceRoot?: string,
): FileChange | undefined {
  const rawPath = extractFilePath(args);
  if (!rawPath) return undefined;
  const content = extractWriteContent(args);
  if (content === null) return undefined;

  const { path, absolutePath } = workspaceRoot
    ? resolveWorkspacePath(rawPath, workspaceRoot, /* virtualRoot */ false)
    : { path: rawPath, absolutePath: rawPath };

  return buildFileChange({
    path,
    absolutePath,
    changeType: FileChangeType.CREATE,
    captureLevel: FileChangeCaptureLevel.WHOLE_FILE,
    after: content,
  });
}

/**
 * Build the `FileChange`s for a STREAMING Cursor file-edit/file-write tool call.
 *
 * A write delegates to {@link buildStreamWriteChange} (WHOLE_FILE CREATE from
 * args, no IO). An edit prefers the SDK's authoritative precomputed hunk
 * (`diffString` + line counts), which only materializes with the terminal
 * result — so during streaming (no diff yet) it returns nothing, and a denied
 * edit's preview is synthesized at the gate from the hook-captured args instead.
 *
 * Returns an empty array for non-file tools and for an edit whose diff is not
 * yet available, so callers can attach unconditionally.
 */
export function buildCursorFileChanges(
  event: Extract<SDKMessage, { type: "tool_call" }>,
  workspaceRoot?: string,
): FileChange[] {
  // Cursor's built-in file tools are not MCP, so name alone classifies them.
  const kind = classifyTool(event.name);
  if (kind !== ToolKind.FILE_EDIT && kind !== ToolKind.FILE_WRITE) return [];

  const args =
    typeof event.args === "object" && event.args !== null
      ? (event.args as Record<string, unknown>)
      : undefined;
  if (!args) return [];

  if (kind === ToolKind.FILE_WRITE) {
    const fileChange = buildStreamWriteChange(args, workspaceRoot);
    return fileChange ? [fileChange] : [];
  }

  // Edit: prefer the SDK's authoritative diff from the terminal result.
  const value = editEnvelopeValue(event.result);
  const unifiedDiff = typeof value?.diffString === "string" ? value.diffString : undefined;
  const linesAdded = typeof value?.linesAdded === "number" ? value.linesAdded : undefined;
  const linesRemoved = typeof value?.linesRemoved === "number" ? value.linesRemoved : undefined;
  // No diff yet (e.g. the initial "running" event) — nothing authoritative to attach.
  if (unifiedDiff === undefined && linesAdded === undefined && linesRemoved === undefined) {
    return [];
  }

  const rawPath = extractFilePath(args);
  if (!rawPath) return [];
  const { path, absolutePath } = workspaceRoot
    ? resolveWorkspacePath(rawPath, workspaceRoot, /* virtualRoot */ false)
    : { path: rawPath, absolutePath: rawPath };

  return [
    buildFileChange({
      path,
      absolutePath,
      changeType: FileChangeType.MODIFY,
      captureLevel: FileChangeCaptureLevel.HUNK_ONLY,
      unifiedDiff,
      linesAdded,
      linesRemoved,
    }),
  ];
}

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
 * Normalize a tool_call event result into a string for the ToolCall proto.
 * Returns "" for an absent result so callers can treat "no result yet" and
 * "empty result" uniformly (e.g. to avoid clobbering a captured result).
 *
 * The one non-passthrough case is a multimodal MCP result (e.g. a computer-use
 * screenshot): see {@link canonicalizeImageResult}. Everything else is the
 * string as-is, or a whole-value JSON.stringify — byte-identical to before.
 */
export function toResultString(result: unknown): string {
  if (result == null) return "";
  if (typeof result === "string") return result;
  const canonical = canonicalizeImageResult(result);
  if (canonical !== undefined) return canonical;
  return JSON.stringify(result);
}

/**
 * Re-emit a Cursor MCP result that carries an image block as the canonical
 * top-level content-block array the persist-time offload understands.
 *
 * The Cursor SDK wraps an MCP tool result as `{ status, value: { content: [...] } }`
 * (or a bare `{ content: [...] }`), where an image block is
 * `{ image: { data, mimeType } }` and `data` is a Node Buffer-JSON
 * (`{ type:"Buffer", data:number[] }`). Persisting that envelope verbatim buries
 * the image where `detectImagePayload`/`contentBlocks` (shared/status-offload.ts)
 * cannot see it, so the screenshot lands as `text/plain` instead of a renderable
 * `ToolCallOutputRef`.
 *
 * This mirrors `serializeToolContent` in the deep-agent path
 * (execute-deep-agent/status-builder-shared.ts): the harness adapter normalizes
 * its own wire shape into the canonical array
 *   `[{ type:"text", text }, { type:"image", data:<base64>, mimeType }]`
 * so the shared offload stays harness-agnostic (its envelope handling is
 * documented there as insurance, not the primary path). Buffer-JSON is decoded
 * to base64 here so the bloated byte-array never propagates into the status.
 *
 * Returns undefined when there is no content array or no image block, so the
 * caller falls back to its existing serialization (no change for text/error
 * results).
 */
export function canonicalizeImageResult(result: unknown): string | undefined {
  if (result == null || typeof result !== "object") return undefined;
  const blocks = resultContentBlocks(result as Record<string, unknown>);
  if (!blocks) return undefined;

  const canonical: Array<Record<string, unknown>> = [];
  let sawImage = false;
  for (const block of blocks) {
    if (!block || typeof block !== "object") continue;
    const b = block as Record<string, unknown>;

    if (b.image && typeof b.image === "object") {
      const img = b.image as Record<string, unknown>;
      const base64 = imageDataToBase64(img.data);
      if (base64) {
        const mimeType = typeof img.mimeType === "string" ? img.mimeType : "image/png";
        canonical.push({ type: "image", data: base64, mimeType });
        sawImage = true;
        continue;
      }
    }

    const text = blockText(b);
    if (text !== undefined) canonical.push({ type: "text", text });
  }

  return sawImage ? JSON.stringify(canonical) : undefined;
}

/** Extract the content-block array from a Cursor result envelope or a bare one. */
function resultContentBlocks(obj: Record<string, unknown>): unknown[] | undefined {
  const value = obj.value;
  if (value && typeof value === "object" && Array.isArray((value as Record<string, unknown>).content)) {
    return (value as Record<string, unknown>).content as unknown[];
  }
  if (Array.isArray(obj.content)) return obj.content;
  return undefined;
}

/**
 * Decode an image block's `data` to plain base64. Accepts a Node Buffer-JSON
 * (`{ type:"Buffer", data:number[] }`, how the Cursor SDK serializes bytes), a
 * `data:` URL, or an already-base64 string. Returns undefined for anything else.
 */
function imageDataToBase64(data: unknown): string | undefined {
  if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    if (d.type === "Buffer" && Array.isArray(d.data)) {
      try {
        return Buffer.from(d.data as number[]).toString("base64");
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
  if (typeof data === "string" && data) {
    const dataUrl = data.match(/^data:image\/[a-zA-Z0-9.+-]+;base64,([\s\S]+)$/);
    return (dataUrl ? dataUrl[1] : data).replace(/\s+/g, "");
  }
  return undefined;
}

/** Extract the text from a Cursor content block: `{ text:{text} }` or `{ text }`. */
function blockText(b: Record<string, unknown>): string | undefined {
  const t = b.text;
  if (typeof t === "string") return t;
  if (t && typeof t === "object" && typeof (t as Record<string, unknown>).text === "string") {
    return (t as Record<string, unknown>).text as string;
  }
  return undefined;
}

/**
 * Parse the task tool's completed result into AgentMessages.
 *
 * The Cursor SDK returns sub-agent work as a blob in the task tool's
 * completed event (not as streaming events with a distinct agent_id).
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

  for (const step of steps) {
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
      const tc = buildSubAgentToolCall(s.toolCall, out.length);
      if (tc) {
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
  seq: number,
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
  // collides with a sibling; fall back to a per-step synthetic id only when the
  // SDK omits one.
  const id =
    typeof obj.toolCallId === "string" && obj.toolCallId
      ? obj.toolCallId
      : `sub-${name}-${seq}`;

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
    tc.argsPreview = JSON.stringify(inner.args);
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
  mergedPolicies?: Map<string, MergedToolPolicy>;
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
   * Sub-agent executions carried over from the persisted transcript on a
   * durable resume (see seedCursorTranscriptFromExecution in index.ts). The
   * accumulator re-registers them so a sub-agent's resumed lifecycle updates
   * merge onto the seeded row instead of producing a duplicate, and so the row
   * survives the round-trip rather than being dropped from the rebuilt status.
   * Empty on a first run.
   */
  seededSubAgents?: SubAgentExecution[];
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
 * call_id), mirroring the native harness's `ExecutionState.toolCalls`.
 * This ensures completion events always find the correct ToolCall proto
 * regardless of which AI message it was originally attached to — the
 * index stores the same object reference that lives in the message's
 * `toolCalls[]` array, so mutations propagate directly to the proto.
 *
 * Task (sub-agent) tool calls additionally produce SubAgentExecution
 * protos, accessible via the subAgentExecutions getter.
 */
/**
 * Transition any non-terminal sub-agent (IN_PROGRESS or PENDING) in the given
 * proto array to CANCELLED with a completion timestamp, in place.
 *
 * Operates directly on the status array (not the accumulator) because the
 * Cursor cancellation exception unwinds out of the streaming loop into the
 * activity's catch block, where the MessageAccumulator is out of scope. Returns
 * true if any sub-agent changed.
 */
export function cancelInProgressSubAgentProtos(
  subAgents: SubAgentExecution[],
): boolean {
  let changed = false;
  for (const sub of subAgents) {
    if (
      sub.status === SubAgentStatus.SUB_AGENT_IN_PROGRESS ||
      sub.status === SubAgentStatus.SUB_AGENT_PENDING
    ) {
      sub.status = SubAgentStatus.SUB_AGENT_CANCELLED;
      sub.completedAt = utcTimestamp();
      changed = true;
    }
  }
  return changed;
}

export class MessageAccumulator {
  private readonly messages: AgentMessage[];
  private activeAiByRunId = new Map<string, AgentMessage>();
  private activeThinkingByRunId = new Map<string, AgentMessage>();
  private readonly _subAgentExecutions: SubAgentExecution[] = [];
  private readonly subAgentMap = new Map<string, SubAgentExecution>();
  private readonly mergedPolicies?: Map<string, MergedToolPolicy>;
  private readonly provenance?: ApprovalProvenanceContext;
  private readonly workspaceRoot?: string;
  private readonly toolCallIndex = new Map<string, ToolCall>();
  private _dirty = false;

  constructor(messages: AgentMessage[], options?: MessageAccumulatorOptions) {
    this.messages = messages;
    this.mergedPolicies = options?.mergedPolicies;
    this.provenance = options?.provenance;
    this.workspaceRoot = options?.workspaceRoot;

    // Resume seeding. When constructed over a pre-seeded transcript (a durable
    // resume — see seedCursorTranscriptFromExecution in index.ts), rebuild the
    // by-id tool-call index so a cross-message completion for a seeded call
    // resolves onto the existing proto, and re-register seeded sub-agents so
    // their resumed lifecycle updates merge in place. A first run carries an
    // empty transcript and no seed, so both are no-ops. Mirrors the deep-agent
    // ExecutionState.rebuildToolCallIndex + sub-agent re-registration on resume.
    this.rebuildToolCallIndex();
    for (const sub of options?.seededSubAgents ?? []) {
      this._subAgentExecutions.push(sub);
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
    if (SUPPRESSED_TOOL_NAMES.has(event.name)) return;

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
    // append-only-at-identity guard, stalling the run. This generalizes the v2
    // deep-agent StatusBuilder.findResumableSeededToolCall (a tool-name match)
    // to the full Cursor identity, reusing the single existing identity
    // definition rather than introducing a parallel one.
    const seeded = this.findResumableSeededToolCall(tc);
    if (seeded) {
      // Re-key the fresh call_id onto the seeded proto so this call_id's later
      // lifecycle events resolve here, then merge in place. mergeToolCallEvent
      // advances WAITING_APPROVAL (non-terminal) toward the event's status.
      this.toolCallIndex.set(event.call_id, seeded);
      this.attachExecutedFileChanges(seeded, event);
      this.mergeToolCallEvent(seeded, event);
      return;
    }

    // A write carries whole-file content at creation; an edit's diff arrives
    // with its terminal result (merged later). Both flow through the single
    // capture-attach path (see attachExecutedFileChanges).
    this.attachExecutedFileChanges(tc, event);
    this.findOrCreateLastAiMessage().toolCalls.push(tc);
    this.toolCallIndex.set(event.call_id, tc);
    // A new tool call is a discrete, user-visible event — force a prompt
    // flush so the live UI surfaces it the instant it starts.
    this._dirty = true;
  }

  /**
   * Attach the SDK-sourced (executed) file change(s) for a tool_call event,
   * letting an authoritative capture SUPERSEDE a gate proposal — the same
   * invariant the native harness enforces via attachFileChangesToStatus
   * (executed capture overwrites the interrupt-time proposal), adapted to
   * Cursor's per-tool capture shape:
   *
   *  - HUNK_ONLY incoming = the SDK's authoritative, self-contained edit diff.
   *    It supersedes ANY prior capture, because the only thing it can replace is
   *    a gate PROPOSAL (an edit's diff is never set at creation) and it carries
   *    the complete truth. This is the missing-diff fix: a stale WHOLE_FILE
   *    proposal (built at the gate from the hook-captured input) no longer
   *    shadows the executed diff after approval + resume.
   *  - WHOLE_FILE incoming = a stream write CREATE (after-only). It attaches
   *    only when nothing is captured yet, so it never DOWNGRADES a gated write's
   *    proposal (which carries a true before/after the stream cannot reconstruct
   *    post-execution) nor an already-captured change.
   *  - An event with no authoritative capture (a result-less "running" re-emit)
   *    yields [] and never wipes a captured change.
   *
   * Known, deliberate limitation: a gated WHOLE_FILE *write* whose content
   * DIVERGES on resume keeps showing the proposal's before/after rather than the
   * executed content. We prefer the richer (if rarely stale) before/after diff
   * over a content-only CREATE; the fully-correct path is a before-preserving
   * merge (carry the proposal's irrecoverable `before` onto the executed
   * `after`), deferred — it is not reachable from the edit defect this fixes and
   * would expand the change into the write path.
   */
  private attachExecutedFileChanges(
    tc: ToolCall,
    event: Extract<SDKMessage, { type: "tool_call" }>,
  ): void {
    const incoming = buildCursorFileChanges(event, this.workspaceRoot);
    if (incoming.length === 0) return;
    const supersedes =
      tc.fileChanges.length === 0 ||
      incoming[0].captureLevel === FileChangeCaptureLevel.HUNK_ONLY;
    if (supersedes) tc.fileChanges = incoming;
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
   */
  private findResumableSeededToolCall(candidate: ToolCall): ToolCall | undefined {
    const wanted = toolCallIdentityToken(candidate);
    for (const tc of this.toolCallIndex.values()) {
      if (
        tc.status === ToolCallStatus.TOOL_CALL_WAITING_APPROVAL &&
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
    if (!existing.startedAt && status === ToolCallStatus.TOOL_CALL_RUNNING) {
      existing.startedAt = utcTimestamp();
    }

    // Only a non-empty incoming result overwrites; a result-less "running"
    // re-emit must not wipe a result captured on completion (or vice versa).
    const incomingResult = toResultString(event.result);
    if (incomingResult) {
      existing.result = incomingResult;
    }

    // A file edit's authoritative diff arrives with the terminal result; attach
    // it, letting it SUPERSEDE a gate proposal set before the tool ran (the
    // missing-diff fix) without downgrading a write's richer capture — the rule
    // lives in the single capture-attach path.
    this.attachExecutedFileChanges(existing, event);

    if (status === ToolCallStatus.TOOL_CALL_FAILED) {
      if (!existing.error) {
        existing.error = typeof event.result === "string"
          ? event.result
          : "Tool call failed";
      }
      if (existing.requiresApproval && !existing.approvalRequestedAt) {
        existing.approvalRequestedAt = utcTimestamp();
      }
    }

    if (event.args != null && !existing.argsPreview) {
      existing.argsPreview = typeof event.args === "string"
        ? event.args
        : JSON.stringify(event.args);
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

/**
 * Reconcile the denial ledger written by the preToolUse hook against the tool
 * calls accumulated from the stream, marking each denied call as
 * WAITING_APPROVAL.
 *
 * This is the cursor analog of the native harness synthesizing WAITING_APPROVAL
 * tool calls from LangGraph interrupts (execute-deep-agent/index.ts). The hook
 * ledger — not the SDK-reported tool status — is the authoritative record of
 * what was gated, because the hook is the only component that makes the per-call
 * allow/deny decision. The backend then projects pending_approvals from these
 * WAITING_APPROVAL tool calls (PendingApprovalComputer), so the approval surface
 * is driven entirely by tool-call status, exactly like the native harness.
 *
 * Correlation is by tool identity token (the same space as approvedGrantTokens),
 * not by call id: a denied tool's identity is stable, and a single resource
 * approved once should produce one approval regardless of how many times the
 * agent re-attempted it within the turn.
 *
 * ONE GATE PER TURN (deny-only clean pause). The Cursor harness can only gate by
 * the hook returning `deny`, which Cursor surfaces to the model as a tool
 * *failure* — so a blocked model frequently improvises a workaround (the
 * canonical case: a denied `edit notes.md` followed ~2.5s later by a
 * `shell: cat > notes.md`, in the SAME assistant message with no narration
 * between them — observed in production, exec aex_01kw4p0cqgk0j8vvxbs5t8gv59).
 * The first-denial stop (index.ts) tries to cancel the turn at that first
 * denial, but `run.cancel()` is async and races the SDK's auto-execution, so the
 * workaround can still stream and land a SECOND denial in the ledger. Two
 * denials of distinct identity would otherwise surface two approval cards for
 * one logical intent. Their identities differ (`write\nnotes.md` vs
 * `shell\ncat > notes.md`), so no same-identity twin collapse can join them, and
 * they share one message, so no positional rule can separate them; the only
 * honest signal that the second is a reaction is CAUSALITY — it was emitted
 * after the model saw the first denial. We therefore ANCHOR on the FIRST ledger
 * denial of the turn (the ledger is reset per turn and appended in denial order,
 * so ledger[0] is the original intent) and surface ONLY that identity. Every
 * other denied identity in the turn — a post-denial workaround, or a genuine
 * co-pending sibling the deny-only harness defers — is blanked in place to a
 * hidden SKIPPED row ({@link collapseNonAnchorDenials}). A deferred sibling is
 * not lost: on resume it re-attempts and gates again next turn (sequential
 * gating). The native (LangGraph) harness pauses BEFORE the model can react, so
 * it keeps full in-turn co-pending and is untouched by this rule. This is the
 * near-term, invariant-preserving stepping stone to the Tool Execution Gateway,
 * where an un-leased workaround is refused by construction.
 *
 * Correlation runs in two passes. The first matches the streamed token to a
 * ledger token byte-for-byte (the common case). The hook, however, records its
 * token from the RAW path Cursor hands it — a bash script cannot normalize a
 * path against the workspace root — so an ABSOLUTE hook `file_path` against a
 * RELATIVE stream `path` (or vice versa) yields two different raw tokens for one
 * edit and the exact pass misses. The runner CAN normalize, so a second pass
 * matches any still-unmatched FILE denial to a streamed call by (category,
 * workspace-normalized path) and overlays the REAL streamed call — reusing its
 * captured `file_changes`, never appending a content-less placeholder beside it.
 * This is the difference between one honest gate (with its diff) and two cards,
 * one of which reads "No preview available". It reuses the single tool-identity
 * definition + `resolveWorkspacePath`; it introduces no parallel identity.
 *
 * Only after BOTH passes miss is a placeholder WAITING_APPROVAL tool call
 * synthesized (rare — Cursor normally emits a tool_call event for every
 * attempt), so the gate still surfaces and never renders as a silent success.
 * Critically, every match overlays a call IN PLACE (the committed id is
 * preserved): the backend's append-only-at-identity transcript guard rejects a
 * finalize that drops a previously-committed tool-call id, so reconciliation may
 * only reconcile entries in place, never remove them.
 *
 * Every matched/synthesized call is enriched with the hook-captured authoritative
 * input (`ledger.input`) via {@link applyGateInput}: the full proposed args, a
 * compact `args_preview`, and the proposed `file_changes` (a write's WHOLE_FILE
 * CREATE or an edit's synthesized HUNK) — so the approval card shows the change
 * before approval, for every tool. A real streamed diff is never clobbered, and
 * a missing capture (the hook's grep fallback) degrades to the prior behavior.
 *
 * Returns the tool calls now marked WAITING_APPROVAL — the single anchor gate
 * for the turn (overlaid or, rarely, synthesized).
 */
export async function reconcileDeniedToolCalls(
  messages: AgentMessage[],
  ledger: DeniedLedgerEntry[],
  mergedPolicies?: Map<string, MergedToolPolicy>,
  workspaceBackend?: WorkspaceBackend,
): Promise<ToolCall[]> {
  if (ledger.length === 0) return [];

  // The workspace the gated files live in. Its rootDir normalizes paths for the
  // abs-vs-rel fallback; the backend itself reads each file's pre-edit `before`
  // at the gate (the tool was DENIED, so disk still holds the true old content).
  const workspaceRoot = workspaceBackend?.rootDir;

  // One gate per turn: anchor on the FIRST ledger denial. The ledger is reset
  // per turn and appended in denial order, so ledger[0] is the model's original
  // intent; any later denial of a DIFFERENT identity is a post-denial workaround
  // or a deferred co-pending sibling (see the doc comment). We surface ONLY the
  // anchor identity below and blank every other denied identity to a hidden
  // SKIPPED row. `deniedTokens` still carries every denied identity — it is the
  // scope for that collapse, never an additional gate.
  const anchorToken = ledger[0].token;
  const deniedTokens = new Set(ledger.map((e) => e.token));
  // The authoritative pre-execution args the hook captured for the anchor. A
  // resource re-attempted within the turn shares a token; last write wins (the
  // attempts carry the same proposed change).
  let anchorInput: Record<string, unknown> | undefined;
  for (const e of ledger) {
    if (e.token === anchorToken && e.input) anchorInput = e.input;
  }
  const matchedCalls = new Set<ToolCall>();
  const result: ToolCall[] = [];
  let anchorMatched = false;

  // 1. Exact overlay: a streamed call whose token equals the anchor denial token
  //    byte-for-byte (the path form agreed on both sides). The anchor resource
  //    re-attempted within the turn shares one token and collapses to a single
  //    approval (the first match is the keeper; same-identity twins are blanked
  //    by collapseRedundantToolCallTwins below).
  for (const msg of messages) {
    if (anchorMatched) break;
    for (const tc of msg.toolCalls) {
      if (toolCallIdentityToken(tc) !== anchorToken) continue;
      await overlayDeniedStreamCall(tc, anchorInput, mergedPolicies, workspaceBackend);
      matchedCalls.add(tc);
      result.push(tc);
      anchorMatched = true;
      break;
    }
  }

  // 2. Normalized-path fallback (the abs-vs-rel drift fix): if the anchor is a
  //    FILE denial the exact pass missed, match a streamed call by (category,
  //    workspace-normalized path) and overlay the REAL call — never a content-
  //    less placeholder beside it. Requires the workspace root to normalize;
  //    shell/MCP denials (no path) and resumes without a root fall through to
  //    synthesis.
  if (!anchorMatched && workspaceRoot) {
    const decoded = decodeIdentityToken(anchorToken);
    const wanted = decoded
      ? normalizedFileSalient(decoded.key, decoded.salient, workspaceRoot)
      : undefined;
    if (wanted) {
      const tc = findUnmatchedStreamCallByNormalizedSalient(
        messages, matchedCalls, wanted, workspaceRoot,
      );
      if (tc) {
        await overlayDeniedStreamCall(tc, anchorInput, mergedPolicies, workspaceBackend);
        matchedCalls.add(tc);
        result.push(tc);
        anchorMatched = true;
      }
    }
  }

  // 2a. One gate per turn: blank every denied identity OTHER than the anchor to a
  //     hidden SKIPPED row (the workaround shell, or a deferred co-pending
  //     sibling). Runs BEFORE the WAITING_FOR_APPROVAL persist so a reaction is
  //     never persisted as WAITING_APPROVAL — the backend authors an approval
  //     REQUESTED event only from a WAITING_APPROVAL tool call, so collapsing
  //     here keeps the append-only approval-event stream free of an orphan
  //     REQUESTED that would need retraction.
  const nonAnchorCollapsed = collapseNonAnchorDenials(messages, deniedTokens, anchorToken);
  if (nonAnchorCollapsed > 0) {
    console.log(
      `ExecuteCursor reconcile collapsed ${nonAnchorCollapsed} non-anchor denied ` +
        `tool call(s) to hidden SKIPPED (one gate per turn; anchor is the first ` +
        `denial of the turn)`,
    );
  }

  // 2b. Collapse same-turn duplicate edits. When the model emitted the SAME
  //     resource twice in one turn (two call ids, one identity token), only the
  //     FIRST same-token stream call was overlaid into the gate above; any OTHER
  //     same-token call stays a committed row (RUNNING zombie, or a
  //     denied-reported-as-success COMPLETED) that would render as a second,
  //     content-less card beside the gate (the reported "No preview available"
  //     duplicate). The overlaid gate is now WAITING_APPROVAL, so the shared
  //     routine recognizes it as the keeper and blanks the twins IN PLACE to
  //     hidden SKIPPED rows — we cannot drop them, since the backend's
  //     append-only-at-identity guard rejects removing a previously-committed
  //     tool-call id, but the id is preserved so the finalize stays append-only.
  const collapsed = collapseRedundantToolCallTwins(messages);
  if (collapsed > 0) {
    console.log(
      `ExecuteCursor reconcile collapsed ${collapsed} redundant tool-call twin(s) ` +
        `superseded by the approval gate (kept in place as hidden SKIPPED rows)`,
    );
  }

  // 3. Synthesize the anchor gate if it matched NO streamed call in either pass
  //    (rare — Cursor emits a tool_call event for every attempt), so the gate
  //    still surfaces rather than rendering as a silent success. After the
  //    normalized fallback this should be ~0; the caller logs a divergence when
  //    it is not (a synthesized id is prefixed `approval:`). Only the anchor is
  //    ever synthesized: non-anchor denials are deliberately collapsed, never
  //    surfaced (one gate per turn).
  if (!anchorMatched) {
    const anchorEntry = ledger.find((e) => e.token === anchorToken) ?? ledger[0];
    const decoded = decodeIdentityToken(anchorToken);
    // Display the hook's raw tool name; carry the decoded salient so the grant
    // rebuilt from this tool call on reinvocation keys on the same resource.
    const displayName = anchorEntry.toolName || decoded?.key || "tool";
    const salient = decoded?.salient ?? "";
    const tc = synthesizeWaitingApprovalToolCall(
      displayName, salient, decoded?.digest ?? "", anchorToken, mergedPolicies,
    );
    // The hook-captured input upgrades the placeholder from a bare {path} to the
    // full proposed args + diff, so even a synthesized gate shows the change.
    await applyGateInput(tc, anchorInput ?? anchorEntry.input, workspaceBackend);
    appendToolCallToLastAiMessage(messages, tc);
    result.push(tc);
  }

  return result;
}

/**
 * Overlay WAITING_APPROVAL onto a streamed tool call the hook denied. Mutates
 * `tc` in place — the call keeps its committed id, so the backend's
 * append-only-at-identity transcript guard accepts the finalize (an in-place
 * status change is a reconcile, not a drop). The single overlay routine for both
 * the exact and the normalized correlation passes, so the gate diff can never
 * diverge between them. The hook-captured `input` (when present) is the
 * authoritative, complete proposed args — the stream may have carried only
 * partial args before the first-denial cancel — so it supplies the args preview
 * and the proposed file change (see {@link applyGateInput}).
 */
async function overlayDeniedStreamCall(
  tc: ToolCall,
  input: Record<string, unknown> | undefined,
  mergedPolicies: Map<string, MergedToolPolicy> | undefined,
  workspaceBackend: WorkspaceBackend | undefined,
): Promise<void> {
  markWaitingApproval(tc, mergedPolicies);
  await applyGateInput(tc, input, workspaceBackend);
}

/**
 * Recognizes a tool call already blanked to a hidden collapsed row, so a second
 * pass never re-collapses it (and never miscounts). Mirrors the SDK's
 * `isCollapsedToolCall` shape without importing across the runner/SDK seam.
 */
function isAlreadyCollapsed(tc: ToolCall): boolean {
  return (
    tc.status === ToolCallStatus.TOOL_CALL_SKIPPED &&
    !tc.requiresApproval &&
    tc.fileChanges.length === 0 &&
    !tc.result &&
    !tc.error &&
    !tc.argsPreview
  );
}

/**
 * Whether a tool call carries a change/output of its own — the signal that it is
 * authoritative for its resource rather than a redundant denial/cancel twin.
 *
 * The notion of "change" is category-aware on purpose: a file mutation's change
 * is its proposed diff (`file_changes`) and NEVER its `result` envelope, so a
 * denied-reported-as-success edit with a degenerate empty result (`"\"\""`) is
 * correctly read as no-change. Every other gated tool (shell, MCP) has no
 * `file_changes`; its "change" is its execution output, so a genuine run carries
 * a non-empty `result` while a denied/cancelled attempt that never executed does
 * not. This keeps two distinct shell runs (each with output) both visible while
 * still collapsing a same-command denial twin.
 */
function carriesOwnChange(tc: ToolCall): boolean {
  const category = toolApprovalCategory(tc.name);
  if (category === "write" || category === "delete") {
    return tc.fileChanges.length > 0;
  }
  return !!tc.result;
}

/**
 * Collapse redundant same-identity tool-call twins to a single visible row.
 *
 * The model frequently emits the SAME gated action twice in one turn (two
 * tool-call ids, one identity). When the first attempt is gated and the run is
 * cancelled mid-flight, the extra attempt never receives a terminal event and
 * persists as a stuck `RUNNING` row ("No preview available"); other variants are
 * a denied-reported-as-success `COMPLETED` with an empty result, two no-change
 * `COMPLETED` attempts where neither carries a change, or — on the denial path —
 * a `FAILED` twin beside the overlaid gate. All render as a duplicate card beside
 * the real action (or the approval gate). This is the recurring duplicate-card
 * defect, most visible for file edits but shared by every gated tool family.
 *
 * The routine is harness-agnostic and a pure function of `messages`:
 *
 * 1. Scope to GATED identities — file mutations (`write`/`delete`) and shell key
 *    on their cross-taxonomy category; MCP tools are recognized by their server
 *    slug. A same-turn duplicate of a gated tool is a denial/cancel artifact, not
 *    meaningful repetition. The category is name-derived (via {@link toolIdentity}
 *    -> approvalCategory), so a twin cancelled before classification (empty
 *    `toolKind`) is still scoped via its name (`edit` -> `write`). Ungated
 *    read-only tools are left untouched.
 * 2. Group those calls by `toolCallIdentityToken` — the SAME `toolIdentity` used
 *    for denial correlation and resume grants, so scope and grouping cannot drift.
 * 3. In each group the keepers depend on the gate's capture level:
 *      - WITH a WHOLE_FILE gate (`WAITING_APPROVAL` carrying a WHOLE_FILE change):
 *        the gate is the SOLE keeper. After {@link applyGateInput} it holds the
 *        COMPLETE proposed content, and a whole-file write is cumulative (the last
 *        write subsumes the earlier ones), so every same-identity sibling — a
 *        denied/zombie row or a stale snapshot from a second rewrite — is
 *        redundant and would render a second, contradictory card.
 *      - OTHERWISE (a HUNK gate, or no gate): the keepers carry the authoritative
 *        state — a change/output of their own (see {@link carriesOwnChange}) or
 *        the gate itself. Two DISTINCT hunk edits to one file are independent
 *        regions (neither supersedes the other), and two genuine distinct EXECUTED
 *        edits each carry their own `file_changes`, so both are kept and both
 *        render. If NO member qualifies (every attempt produced no change), keep
 *        exactly ONE representative — preferring a terminal attempt over a stuck
 *        `RUNNING` zombie — so the resource still shows a single card.
 *    Every non-keeper is blanked in place to a hidden `SKIPPED` row (see
 *    {@link collapseDenialTwin}).
 *
 * It is deliberately subtractive — it only ever HIDES a row, never invents a
 * terminal state. The committed `id` is preserved on every collapse, so the
 * finalize stays append-only by construction and the backend's
 * append-only-at-identity guard accepts it. Returns the number collapsed, for
 * observability.
 */
export function collapseRedundantToolCallTwins(messages: AgentMessage[]): number {
  const groups = new Map<string, ToolCall[]>();
  for (const msg of messages) {
    for (const tc of msg.toolCalls) {
      const id = toolIdentity(tc.name, tc.mcpServerSlug, toolCallArgs(tc));
      const gated = tc.mcpServerSlug
        ? true
        : id.key === "write" || id.key === "delete" || id.key === "shell";
      if (!gated) continue;
      const token = grantToken(id.key, id.salient);
      const bucket = groups.get(token);
      if (bucket) bucket.push(tc);
      else groups.set(token, [tc]);
    }
  }

  let collapsed = 0;
  for (const group of groups.values()) {
    if (group.length < 2) continue; // a lone call is never a twin

    // A pending approval gate that carries a WHOLE_FILE change is the single
    // authoritative representation of its resource for the turn: that gate already
    // holds the COMPLETE proposed content (via applyGateInput's authoritative-input
    // override), and a whole-file write is cumulative — the last write subsumes the
    // earlier ones — so every same-identity sibling is a stale snapshot and the
    // gate is the SOLE keeper. This is deliberately NOT applied to a HUNK gate:
    // two DISTINCT hunk edits to one file are independent regions, neither
    // superseding the other, so a sibling carrying its own change is kept.
    const wholeFileGate = group.find(
      (tc) =>
        tc.status === ToolCallStatus.TOOL_CALL_WAITING_APPROVAL &&
        tc.fileChanges.some((fc) => fc.captureLevel === FileChangeCaptureLevel.WHOLE_FILE),
    );
    let keepers: Set<ToolCall>;
    if (wholeFileGate) {
      // Keep every WAITING gate (one-gate-per-turn yields exactly one; the superset
      // is the safe choice), collapse all other same-identity siblings.
      keepers = new Set<ToolCall>(
        group.filter((tc) => tc.status === ToolCallStatus.TOOL_CALL_WAITING_APPROVAL),
      );
    } else {
      keepers = new Set<ToolCall>(
        group.filter(
          (tc) =>
            carriesOwnChange(tc) ||
            tc.status === ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
        ),
      );
      // All attempts produced no change (e.g. denied-reported-as-success): keep one
      // representative, preferring a settled outcome over a stuck RUNNING zombie.
      if (keepers.size === 0) {
        const terminal = [...group].reverse().find((tc) => isTerminalToolStatus(tc.status));
        keepers.add(terminal ?? group[0]);
      }
    }

    for (const tc of group) {
      if (keepers.has(tc)) continue;
      if (isAlreadyCollapsed(tc)) continue;
      collapseDenialTwin(tc);
      collapsed++;
    }
  }
  return collapsed;
}

/**
 * One gate per turn: blank every DENIED tool call whose identity differs from
 * the anchor (the first denial of the turn) to a hidden SKIPPED row.
 *
 * This is the cross-identity complement of {@link collapseRedundantToolCallTwins}
 * (which only joins SAME-identity duplicates). The canonical target is the
 * deny-only workaround — a denied `edit notes.md` followed by a `shell:
 * cat > notes.md` whose identity (`shell\n…`) differs from the edit's
 * (`write\nnotes.md`), so no twin collapse can join them and (since they share
 * one assistant message) no positional rule can separate them. The honest signal
 * that the shell is redundant is that it is a DIFFERENT denied identity in the
 * same turn as the anchor; under the one-gate-per-turn contract every such
 * identity is either a post-denial reaction or a co-pending sibling the harness
 * defers to the next turn, so it is hidden, not surfaced.
 *
 * Scoped strictly to identities present in `deniedTokens`: a non-denied tool
 * (an earlier read/glob, or an already-granted call that ran) is never touched.
 * Subtractive and id-preserving (via {@link collapseDenialTwin}), so the finalize
 * stays append-only. Returns the number collapsed, for observability.
 */
function collapseNonAnchorDenials(
  messages: AgentMessage[],
  deniedTokens: ReadonlySet<string>,
  anchorToken: string,
): number {
  let collapsed = 0;
  for (const msg of messages) {
    for (const tc of msg.toolCalls) {
      const token = toolCallIdentityToken(tc);
      if (token === anchorToken) continue;
      if (!deniedTokens.has(token)) continue;
      if (isAlreadyCollapsed(tc)) continue;
      collapseDenialTwin(tc);
      collapsed++;
    }
  }
  return collapsed;
}

/**
 * Blank a superseded denial twin in place to a hidden SKIPPED row. Keeps the
 * committed `id` (append-only), `name`, and `toolKind`; clears every renderable
 * surface and the approval flags so the SDK's `isCollapsedToolCall` predicate
 * recognizes it and renders nothing. The structured `args` are left as the honest
 * stored record of the redundant attempt (never rendered, since the row is
 * hidden; the gate carries the authoritative proposed change).
 */
function collapseDenialTwin(tc: ToolCall): void {
  tc.status = ToolCallStatus.TOOL_CALL_SKIPPED;
  tc.requiresApproval = false;
  tc.approvalRequestedAt = "";
  tc.approvalMessage = "";
  tc.error = "";
  tc.result = "";
  tc.argsPreview = "";
  tc.fileChanges = [];
  if (!tc.completedAt) tc.completedAt = utcTimestamp();
}

/**
 * Overlay the hook-captured authoritative tool input onto a gated tool call so
 * the approval card can show the proposed change before the user approves.
 *
 * When `input` is present it becomes the single source for the preview: the full
 * structured `args`, a compact-but-always-valid `args_preview` (the field a
 * resumed turn parses to rebuild the grant salient — so salient fields are never
 * elided, and the heavy content stays only on `file_changes`/`args`), and the
 * proposed `file_changes` — via the shared {@link buildGateFileChange}, which
 * reads the file's pre-edit `before` from the workspace so a whole-file rewrite
 * renders a true before/after diff (the same builder, and the same
 * WHOLE_FILE/HUNK rules, the native gate uses).
 *
 * Full-change fidelity for whole-file writes. For a whole-file write the
 * authoritative hook input is the COMPLETE intended content, so it SUPERSEDES any
 * streamed `file_changes` snapshot. This matters because the streaming capture
 * sets a write's `file_changes` from its FIRST event and never refreshes them for
 * later WHOLE_FILE captures ({@link MessageTranslator.attachExecutedFileChanges}),
 * so a body still streaming — or a file rewritten twice in one turn — would
 * otherwise leave a partial `after` on the gate. The runner then exact-applies
 * that `after` verbatim (see exact-apply.ts), silently dropping the rest of the
 * change the user requested. Sourcing the gate from the input keeps
 * shown == approved == applied == the complete content.
 *
 * Scope and graceful degradation. The override is whole-file-only and only when
 * the builder yields a change (it never wipes `file_changes` to empty). An edit
 * fragment (`old_string`/`new_string`) keeps the SDK's authoritative hunk via the
 * fallback below; with no `input` (the hook's grep fallback) it falls back to the
 * call's existing args and never clobbers a streamed diff; with no workspace
 * backend it still produces a (before-less) change, matching prior behavior.
 */
async function applyGateInput(
  tc: ToolCall,
  input: Record<string, unknown> | undefined,
  workspaceBackend: WorkspaceBackend | undefined,
): Promise<void> {
  if (input) {
    tc.args = input as JsonObject;
    tc.argsPreview = buildElidedArgsPreview(input, SALIENT_ARG_FIELDS);
    // Stamp the content digest from the AUTHORITATIVE captured input, so the
    // approved edit's exact content survives to resume on a small, never-elided
    // field — the grant then binds to (category, path, content) and a sibling
    // edit to the same file re-gates. Empty for a non-content tool. This is the
    // one place the digest is authored; everything downstream reads the field.
    tc.approvalContentDigest = contentDigest(input);
    // Whole-file input is authoritative and complete → it supersedes any streamed
    // snapshot (which can lag the final args). Override only when the builder
    // yields a change, so a defensive miss never wipes a real diff.
    if (extractWriteContent(input) !== null) {
      const gateChange = await buildGateFileChange(tc.name, input, workspaceBackend, {
        virtualRoot: false,
      });
      if (gateChange) {
        tc.fileChanges = [gateChange];
        return;
      }
    }
  }
  // Fallback: no authoritative whole-file input to supersede with (a hunk edit,
  // or the grep-fallback denial with no captured input). Synthesize the proposal
  // only when the call carries no streamed change, so a real streamed diff is kept.
  if (tc.fileChanges.length === 0) {
    const fileChange = await buildGateFileChange(
      tc.name,
      input ?? toolCallArgs(tc),
      workspaceBackend,
      { virtualRoot: false },
    );
    if (fileChange) tc.fileChanges = [fileChange];
  }
}

/**
 * The workspace-normalized identity of a FILE approval category's salient, or
 * undefined for a non-file category (shell, whose salient is a command, not a
 * path) or an empty salient. Both the hook-decoded denial salient and a streamed
 * call's salient pass through this, so an absolute-vs-relative path difference
 * collapses to one comparable key (`category + "\n" + relPath`). Restricting to
 * write/delete keeps a shell command from being mangled by path normalization.
 */
function normalizedFileSalient(
  category: string,
  salient: string,
  workspaceRoot: string,
): string | undefined {
  if ((category !== "write" && category !== "delete") || !salient) return undefined;
  const { path } = resolveWorkspacePath(salient, workspaceRoot, /* virtualRoot */ false);
  return `${category}\n${path}`;
}

/**
 * Find the first not-yet-overlaid streamed tool call whose workspace-normalized
 * (category, path) equals `wanted`. Skips calls already claimed by an earlier
 * denial so several concurrent file denials each overlay a distinct stream call.
 */
function findUnmatchedStreamCallByNormalizedSalient(
  messages: AgentMessage[],
  matchedCalls: ReadonlySet<ToolCall>,
  wanted: string,
  workspaceRoot: string,
): ToolCall | undefined {
  for (const msg of messages) {
    for (const tc of msg.toolCalls) {
      if (matchedCalls.has(tc)) continue;
      const id = toolIdentity(tc.name, tc.mcpServerSlug, toolCallArgs(tc));
      if (normalizedFileSalient(id.key, id.salient, workspaceRoot) === wanted) {
        return tc;
      }
    }
  }
  return undefined;
}

/**
 * Redact provisional post-denial narration when a Cursor turn pauses for approval.
 *
 * THE PROBLEM. Unlike the native harness — which gates with a LangGraph
 * `interrupt()` *before* the tool runs, so the model never sees a denial — the
 * Cursor harness can only gate via the file-based `beforeMCPExecution`/
 * `preToolUse` hook returning `deny`. Cursor surfaces that deny to the model as
 * a tool *failure* (often its own generic "blocked by a hook" text; see the
 * Phase 0 ground-truth capture in cursor_hitl_test.go), and there is no
 * non-leaky SDK approval primitive to use instead (the `request` event is
 * opaque and carries no responder). So a well-behaved model frequently reacts by
 * narrating defeat — "I couldn't do this; enable the hook in your Cursor
 * settings" — which would otherwise be persisted as the assistant's verdict and
 * rendered right next to the approval card that is, in fact, asking the user to
 * approve. Contradictory and alarming.
 *
 * THE GUARANTEE. The runner's job is to simplify this data, not mirror its
 * complexity: a turn that pauses for approval must read the SAME shape the
 * native harness produces — `[pre-tool text][tool calls WAITING_APPROVAL]`, with
 * no post-denial verdict. We therefore BLANK (clear the `content` of, and mark
 * non-streaming) the trailing assistant/thinking messages that (a) appear
 * positionally AFTER the last message bearing a WAITING_APPROVAL tool call and
 * (b) carry no tool calls of their own. The approval card (projected from the
 * WAITING_APPROVAL tool-call status) becomes the single, unambiguous source of
 * truth. The blanked messages are already invisible on every surface via the
 * existing empty-message handling (`buildThreadItems` skips empty `MESSAGE_AI`;
 * `MessageEntry` renders nothing for empty `MESSAGE_THINKING`), so the shared
 * `@stigmer/react`/Ink components stay harness-agnostic with zero per-harness UI
 * special-casing — the cleanliness lives in the data, not in each consumer.
 *
 * WHY BLANK INSTEAD OF REMOVE. Removing the messages would make the persisted
 * WAITING_FOR_APPROVAL transcript SHORTER than the in-progress transcript the
 * runner already streamed. The backend's append-only message guard rejects a
 * shrink for a non-terminal execution (it protects against regressed/partial
 * writes). Blanking keeps the message COUNT identical, so the finalize is
 * append-only BY CONSTRUCTION and the guard accepts it with no special case —
 * which is why this phase deletes the backend's former `isApprovalFinalize`
 * shrink exception in both editions. The transcript is the authoritative *raw*
 * record; the verbatim narration text remains recoverable from the runner logs
 * and the recorded cursor-event stream.
 *
 * WHY THIS IS DETERMINISTIC. `attachToolCallToLastAi` calls
 * `finalizeStreaming(run_id)` before attaching a tool call, so any assistant
 * text the model emits *after* the denied tool call always starts a NEW message
 * — post-denial narration is never merged into the message that holds the gated
 * call. We stop at the first non-narration message (one bearing tool calls), so
 * legitimately-executed tools after the gate and any text around them are never
 * touched; only the contiguous trailing reaction block is blanked. The
 * first-denial stop in index.ts is the primary mechanism that keeps this block
 * small (it ends the turn before the model produces inter-tool narration); this
 * redaction is the backstop for any token that streamed before the cancel landed.
 *
 * Returns the blanked messages (for diagnostics); mutates `messages` in place.
 */
export function clearProvisionalPostDenialNarration(
  messages: AgentMessage[],
  deniedToolCalls: ToolCall[],
): AgentMessage[] {
  if (deniedToolCalls.length === 0) return [];

  // reconcileDeniedToolCalls returns the very ToolCall protos held inside
  // messages[].toolCalls (overlaid) or appended to the last AI message
  // (synthesized), so object identity is a stable, exact match.
  const denied = new Set(deniedToolCalls);

  let lastGatedIdx = -1;
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].toolCalls.some((tc) => denied.has(tc))) {
      lastGatedIdx = i;
    }
  }
  if (lastGatedIdx < 0) return [];

  const redacted: AgentMessage[] = [];
  for (let i = messages.length - 1; i > lastGatedIdx; i--) {
    const msg = messages[i];
    const isProvisionalNarration =
      (msg.type === MessageType.MESSAGE_AI || msg.type === MessageType.MESSAGE_THINKING) &&
      msg.toolCalls.length === 0;
    // Stop at the first message that is NOT trailing narration: a tool-bearing
    // message marks real activity we must preserve, and anything before it is no
    // longer "trailing".
    if (!isProvisionalNarration) break;
    // Blank in place — keep the message so the transcript count never shrinks,
    // but drop its provisional content so no consumer renders the defeatist
    // verdict. Empty AI/THINKING messages are hidden by the SDK already.
    msg.content = "";
    msg.isStreaming = false;
    redacted.unshift(msg);
  }
  return redacted;
}

/**
 * Compute a streamed tool call's identity token in the same canonical space the
 * preToolUse hook records denials in (see {@link toolIdentity} / primaryToken).
 * The token keys on the cross-taxonomy category + salient resource PLUS, for a
 * file edit/write, the {@link contentDigest} of the edit content — so a stream
 * `edit` correlates to the hook's `Write` deny for the same path AND content,
 * and an approval of one edit does not match a DIFFERENT edit to the same file.
 *
 * The digest is read from the persisted `approval_content_digest` field when
 * present (a seeded gate carries it, stable even if `args` was elided), and is
 * recomputed from the call's args otherwise (a freshly-streamed call). For a
 * shell/delete/MCP call (no content) it falls back to the coarse token, exactly
 * as before — so those identities are unchanged.
 *
 * Exported so the resume-grant round-trip can be locked against it: the grant a
 * resume mints for an approved tool (buildApprovalGrants -> primaryToken) must
 * equal THIS denial/overlay identity, or the re-issued call is re-gated forever
 * (the dual-path drift the approval-state round-trip suite guards against).
 */
export function toolCallIdentityToken(tc: ToolCall): string {
  const id = toolIdentity(tc.name, tc.mcpServerSlug, toolCallArgs(tc));
  const digest = tc.approvalContentDigest || contentDigest(toolCallArgs(tc));
  return primaryToken(id.key, id.salient, digest);
}

/**
 * Decode a primary token back into its (key, salient, digest) for the synthesis
 * fallback. The token is `base64(key \n salient)` (coarse) or
 * `base64(key \n salient \n digest)` (content-exact); the digest is the optional
 * third segment. salient never contains a newline (a path or shell command), so
 * splitting on the first two newlines is unambiguous.
 */
function decodeIdentityToken(
  token: string,
): { key: string; salient: string; digest: string } | undefined {
  try {
    const decoded = Buffer.from(token, "base64").toString("utf-8");
    const first = decoded.indexOf("\n");
    if (first < 0) return undefined;
    const key = decoded.slice(0, first);
    const rest = decoded.slice(first + 1);
    const second = rest.indexOf("\n");
    if (second < 0) return { key, salient: rest, digest: "" };
    return { key, salient: rest.slice(0, second), digest: rest.slice(second + 1) };
  } catch {
    return undefined;
  }
}

/** Best-effort args record for a tool call (proto struct, else parsed preview). */
function toolCallArgs(tc: ToolCall): Record<string, unknown> {
  if (tc.args && typeof tc.args === "object") {
    return tc.args as Record<string, unknown>;
  }
  if (tc.argsPreview) {
    try {
      const parsed = JSON.parse(tc.argsPreview);
      if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
    } catch {
      // fall through
    }
  }
  return {};
}

/**
 * Mark a denied tool call as awaiting approval, clearing the result/terminal
 * fields the stream may have set (the tool never actually ran — it was gated).
 */
function markWaitingApproval(
  tc: ToolCall,
  mergedPolicies?: Map<string, MergedToolPolicy>,
): void {
  tc.status = ToolCallStatus.TOOL_CALL_WAITING_APPROVAL;
  tc.requiresApproval = true;
  if (!tc.approvalMessage) {
    tc.approvalMessage = resolveDeniedApprovalMessage(
      tc.name, tc.mcpServerSlug, toolCallArgs(tc), mergedPolicies,
    );
  }
  if (!tc.approvalRequestedAt) tc.approvalRequestedAt = utcTimestamp();
  tc.completedAt = "";
  tc.error = "";
  tc.result = "";
}

function synthesizeWaitingApprovalToolCall(
  displayName: string,
  salient: string,
  digest: string,
  token: string,
  mergedPolicies?: Map<string, MergedToolPolicy>,
): ToolCall {
  const tc = create(ToolCallSchema, {
    id: `approval:${token}`,
    name: displayName,
    status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
    requiresApproval: true,
    startedAt: utcTimestamp(),
    approvalRequestedAt: utcTimestamp(),
    toolKind: classifyTool(displayName),
    // Carry the decoded digest so this placeholder's identity (and the grant
    // rebuilt from it on resume) equals the anchor's content token. applyGateInput
    // overwrites it from the authoritative input when one was captured.
    approvalContentDigest: digest,
  });
  // Carry the salient resource so reconstructAdjudicatedApprovals -> the grant
  // builder keys on the same resource the hook will see on the re-attempt.
  if (salient) {
    tc.argsPreview = JSON.stringify({ path: salient });
  }
  tc.approvalMessage = salient
    ? `Tool requires approval: ${displayName} (${salient})`
    : resolveDeniedApprovalMessage(displayName, "", {}, mergedPolicies);
  // A synthesized call is a ledger denial — it was gated, so it has a governing
  // layer. A denied call never occurs under a global bypass or a matching lease,
  // so empty leases + no bypass faithfully attribute it (a built-in resolves to
  // builtin_category; an MCP placeholder lacks a reconstructed slug and stays
  // UNSPECIFIED rather than be mislabeled).
  if (mergedPolicies) {
    const source = resolveApprovalProvenance(
      displayName, "", mergedPolicies, NO_LEASED_CATEGORIES, false,
    );
    tc.approvalPolicySource = toProtoPolicySource(source);
    if (source) tc.policyEngineVersion = POLICY_ENGINE_VERSION;
  }
  return tc;
}

/**
 * Resolve a human-readable approval message for a denied tool, preferring the
 * MCP policy template, then the built-in template, then a generic fallback.
 */
function resolveDeniedApprovalMessage(
  name: string,
  mcpServerSlug: string,
  args: Record<string, unknown>,
  mergedPolicies?: Map<string, MergedToolPolicy>,
): string {
  if (mergedPolicies && mcpServerSlug) {
    const policy = lookupMcpToolPolicy(name, mcpServerSlug, mergedPolicies);
    if (policy) return resolveApprovalMessage(policy.approvalMessage, name, args);
  }
  if (!mcpServerSlug) {
    const template = getBuiltInApprovalMessage(name);
    if (template) return resolveApprovalMessage(template, name, args);
  }
  return `Tool requires approval: ${name}`;
}

/** Append a tool call to the last AI message, creating one if none exists. */
function appendToolCallToLastAiMessage(messages: AgentMessage[], tc: ToolCall): void {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].type === MessageType.MESSAGE_AI) {
      messages[i].toolCalls.push(tc);
      return;
    }
  }
  const msg = create(AgentMessageSchema, {
    type: MessageType.MESSAGE_AI,
    content: "",
    timestamp: utcTimestamp(),
    toolCalls: [tc],
  });
  messages.push(msg);
}
