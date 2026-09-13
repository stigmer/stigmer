/**
 * V3StatusBuilder — consumes StigmerRunEvents from the V3ProtocolNormalizer
 * and progressively builds the transcript half of the AgentExecutionStatus
 * proto it is handed: messages, tool-call rows and their approval status,
 * sub-agent rows, todos, artifacts, write-backs.
 *
 * Implements the same behavioral contract as the v2 StatusBuilder for all
 * 8 golden scenarios, using v3 event semantics (tool_call_id keying,
 * content-block-level deltas, explicit tool lifecycle).
 *
 * What this builder deliberately does NOT write, and who does (the adapter
 * contract's field ownership, `harness/types.ts` `TurnSink`): the phase,
 * `startedAt` and `streamingUsage` are the turn runtime's. A gated tool
 * start is reported as the {@link awaitingApproval} fact and the caller
 * decides what phase that means; usage is reported raw through
 * {@link V3StatusBuilderOptions.onUsage} and the caller prices and accounts
 * it (until S3 M2a this builder flipped WAITING_FOR_APPROVAL itself and
 * summed usage into `streamingUsage` — a second writer of each field beside
 * the runtime's; `streaming-v3.ts`'s legacy loop now performs both writes
 * from these two hooks until M2b deletes it).
 *
 * Usage is reported on message_finish only (standalone usage events are
 * no-ops) to prevent double-counting — v3 emits both for the same turn.
 * Only the PARENT graph's usage is reported: a sub-agent's `message_finish`
 * is routed to the tracker, which discards it, as it always has
 * (S3 M2a finding F-M2a-12, recorded for the owner).
 */

import { create, type JsonObject } from "@bufbuild/protobuf";
import type { AgentExecutionStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import {
  AgentMessageSchema,
  ToolCallSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import type { AgentMessage, ToolCall } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import type { ExecutionArtifact } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/artifact_pb";
import type { WorkspaceWriteBack } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/writeback_pb";
import {
  MessageType,
  ToolCallStatus,
  ToolKind,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { resolveApprovalMessage as resolveApprovalMsg } from "../../shared/approval-policy.js";
import { classifyTool } from "../../shared/tool-kind.js";
import { applyTodoUpdate } from "../../shared/todos.js";
import { ExecutionState } from "./execution-state.js";
import { utcTimestamp } from "../../shared/status.js";
import type { ExecutionStatusWriter } from "../../shared/execution-status-writer.js";
import type { ApprovalPolicyProvider } from "./status-builder.js";
import type { StigmerRunEvent, V3UsagePayload } from "./v3-events.js";
import { namespaceDepth } from "./v3-events.js";
import {
  extractToolResultV3,
  sanitizeArgsPreview,
  stampApprovalProvenance,
} from "./status-builder-shared.js";
import { SubAgentTracker } from "./subagent-tracker.js";

export interface V3StatusBuilderOptions {
  /**
   * Fired once per PARENT `message_finish` that carries usage, with the
   * payload exactly as the protocol delivered it. The builder never sums or
   * prices: the caller accounts (the turn runtime through
   * `TurnSink.reportUsage`; the legacy loop into `streamingUsage` directly).
   */
  readonly onUsage?: (usage: V3UsagePayload) => void;
}

export class V3StatusBuilder implements ExecutionStatusWriter {
  readonly executionId: string;
  private readonly state: ExecutionState;
  private _forceNextUpdate = false;
  private _awaitingApproval = false;
  private approvalProvider: ApprovalPolicyProvider | null = null;
  private readonly onUsage: ((usage: V3UsagePayload) => void) | undefined;
  private readonly subAgentTracker: SubAgentTracker;

  /** Progressive tool call arg accumulation keyed by callId. */
  private readonly toolArgBuffers = new Map<string, string>();

  /**
   * Builds INTO `status`, by reference: its `messages` and
   * `subAgentExecutions` arrays are the ones indexed and pushed into, never
   * replaced, so a caller that wraps the same status (the write-back
   * coordinator's writer, the runtime's chokepoint) keeps seeing every row.
   */
  constructor(executionId: string, status: AgentExecutionStatus, options: V3StatusBuilderOptions = {}) {
    this.executionId = executionId;
    this.state = new ExecutionState(status);
    this.onUsage = options.onUsage;

    // Resume path: when constructed over a persisted transcript (seeded by the
    // caller on a reinvocation), rebuild the tool-call index so resumed
    // tool_started/tool_finished events reconcile to the existing calls
    // instead of duplicating them. A first run carries no messages, so this
    // is a no-op. The tracker does the same for the seeded sub-agent rows.
    if (status.messages.length > 0) {
      this.state.rebuildToolCallIndex();
    }

    this.subAgentTracker = new SubAgentTracker(status.subAgentExecutions);
  }

  setApprovalProvider(provider: ApprovalPolicyProvider): void {
    this.approvalProvider = provider;
  }

  get currentStatus(): AgentExecutionStatus {
    return this.state.proto;
  }

  /**
   * True once a tool call this turn was gated and left WAITING_APPROVAL: the
   * engine has interrupted (or will, at this step's end) and the turn should
   * end awaiting a decision. A fact about the transcript, not a phase — the
   * caller owns the phase.
   */
  get awaitingApproval(): boolean {
    return this._awaitingApproval;
  }

  get forceNextUpdate(): boolean {
    return this._forceNextUpdate;
  }

  clearForceFlag(): void {
    this._forceNextUpdate = false;
  }

  processEvent(event: StigmerRunEvent): void {
    try {
      // Sub-agent routing: detect "task" tool starts at depth 0 (root) or depth 1
      // (inside LangGraph tools-node). In real runtime, task tool-started arrives
      // at depth 1 with namespace like "tools:<pregelTaskUuid>".
      if (event.kind === "tool_started" && event.name === "task" && namespaceDepth(event.namespace) <= 1) {
        const routingPrefix = event.namespace || `tools:${event.callId}`;
        this.subAgentTracker.onTaskToolStarted(event.callId, event.input, routingPrefix);
        this.handleToolStarted(event.callId, event.name, event.input, event.namespace);
        this._forceNextUpdate = true;
        return;
      }

      if (event.kind === "tool_finished" && this.isTrackedTaskTool(event.callId)) {
        this.subAgentTracker.onTaskToolFinished(event.callId, event.output);
        this.handleToolFinished(event.callId, event.output);
        this._forceNextUpdate = true;
        return;
      }

      if (event.kind === "tool_error" && this.isTrackedTaskTool(event.callId)) {
        this.subAgentTracker.onTaskToolError(event.callId, event.message);
        this.handleToolError(event.callId, event.message);
        this._forceNextUpdate = true;
        return;
      }

      if (this.subAgentTracker.isSubAgentNamespace(event.namespace)) {
        this.subAgentTracker.routeEvent(event);
        return;
      }

      // Parent event routing (unchanged for non-sub-agent events)
      switch (event.kind) {
        case "message_start":
          this.handleMessageStart(event.runId, event.namespace);
          break;
        case "text_delta":
          this.appendTextContent(event.runId, event.namespace, event.text);
          break;
        case "reasoning_delta":
          this.appendThinkingContent(event.runId, event.namespace, event.text);
          break;
        case "tool_call_arg_delta":
          this.handleToolCallArgDelta(event.callId, event.argsChunk);
          break;
        case "message_finish":
          this.handleMessageFinish(event.runId, event.namespace, event.usage);
          break;
        case "tool_started":
          this.handleToolStarted(event.callId, event.name, event.input, event.namespace);
          break;
        case "tool_finished":
          this.handleToolFinished(event.callId, event.output);
          break;
        case "tool_error":
          this.handleToolError(event.callId, event.message);
          break;
        case "tool_output_delta":
          this.handleToolOutputDelta(event.callId, event.delta);
          break;
        case "usage":
        case "lifecycle":
        case "provider":
          break;
      }
    } catch (err) {
      console.error(
        `[V3StatusBuilder] Event handler error: execution=${this.executionId} ` +
        `kind=${event.kind} seq=${event.seq}: ${err}`,
      );
    }
  }

  // ── Artifact & WriteBack ───────────────────────────────────────────

  addArtifact(artifact: ExecutionArtifact): void {
    const artifacts = this.state.proto.artifacts;
    const idx = artifacts.findIndex(a => a.sandboxPath === artifact.sandboxPath);

    if (idx >= 0) {
      if (artifacts[idx].contentHash !== artifact.contentHash) {
        artifacts[idx] = artifact;
        this._forceNextUpdate = true;
      }
      return;
    }

    artifacts.push(artifact);
    this._forceNextUpdate = true;
  }

  addWriteBack(wb: WorkspaceWriteBack): void {
    const backs = this.state.proto.workspaceWriteBacks;
    const idx = backs.findIndex(b => b.workspaceEntryName === wb.workspaceEntryName);

    if (idx >= 0) {
      backs[idx] = wb;
    } else {
      backs.push(wb);
    }
    this._forceNextUpdate = true;
  }

  // ── Message Handlers ───────────────────────────────────────────────

  private handleMessageStart(runId: string, namespace: string): void {
    // Record the runId for turn-boundary detection but do NOT create
    // the AI message yet. The message is created lazily on the first
    // text_delta, preserving the v2 ordering (THINKING before AI text
    // when both appear in the same turn).
    const lastRunId = this.state.lastLlmRunId.get(namespace);
    if (lastRunId && lastRunId !== runId) {
      const existingMsg = this.state.currentAiMessage.get(namespace);
      if (existingMsg) {
        existingMsg.isStreaming = false;
      }
    }
    this.state.lastLlmRunId.set(namespace, runId);
  }

  private handleMessageFinish(runId: string, _namespace: string, usage?: V3UsagePayload): void {
    const msg = this.state.messagesByRun.get(runId);
    if (msg) {
      msg.isStreaming = false;
    }

    if (usage) {
      this.onUsage?.(usage);
    }
  }

  private appendTextContent(runId: string, namespace: string, text: string): void {
    const msg = this.ensureAiMessage(runId, namespace, MessageType.MESSAGE_AI);
    msg.content += text;
    msg.isStreaming = true;
  }

  private appendThinkingContent(runId: string, namespace: string, text: string): void {
    const thinkingKey = `thinking:${namespace}`;
    const existingMsg = this.state.messagesByRun.get(thinkingKey);
    if (existingMsg && existingMsg.type === MessageType.MESSAGE_THINKING) {
      existingMsg.content += text;
      existingMsg.isStreaming = true;
      return;
    }

    const msg = create(AgentMessageSchema, {
      type: MessageType.MESSAGE_THINKING,
      content: text,
      timestamp: utcTimestamp(),
      isStreaming: true,
    });
    this.state.proto.messages.push(msg);
    this.state.messagesByRun.set(thinkingKey, msg);
  }

  // ── Tool Handlers ──────────────────────────────────────────────────

  private handleToolStarted(
    callId: string,
    name: string,
    input: Record<string, unknown>,
    namespace: string,
  ): void {
    // Resume reconciliation: the gated tool call already exists, seeded from the
    // persisted transcript of a prior invocation (seedStatusFromExecution in
    // index.ts). The durable checkpoint re-emits tool_started now that approval
    // is granted — flip the existing call to RUNNING in place rather than
    // appending a duplicate or re-triggering the approval gate. v3 keys by
    // tool_call_id, so this is an exact match (no name heuristics needed).
    const existing = this.state.toolCalls.get(callId);
    if (existing) {
      if (existing.status === ToolCallStatus.TOOL_CALL_WAITING_APPROVAL) {
        existing.status = ToolCallStatus.TOOL_CALL_RUNNING;
      }
      if (Object.keys(input).length > 0 && !existing.args) {
        existing.args = input as JsonObject;
      }
      this.state.toolStartTimes.set(callId, performance.now());
      this._forceNextUpdate = true;
      return;
    }

    const agentNs = this.resolveAgentNamespace(namespace);
    const parentMsg = this.state.currentAiMessage.get(agentNs)
      ?? this.ensureAiMessageForToolCall(agentNs);
    if (!parentMsg) return;

    const approvalReq = this.checkApprovalRequirement(name, input);

    const tc = create(ToolCallSchema, {
      id: callId,
      name,
      status: approvalReq.requiresApproval
        ? ToolCallStatus.TOOL_CALL_WAITING_APPROVAL
        : ToolCallStatus.TOOL_CALL_RUNNING,
      startedAt: utcTimestamp(),
    });

    if (Object.keys(input).length > 0) {
      tc.args = input as JsonObject;
    }

    if (approvalReq.serverSlug) {
      tc.mcpServerSlug = approvalReq.serverSlug;
    }

    // Classify after mcpServerSlug is set so MCP tools resolve correctly.
    tc.toolKind = classifyTool(tc.name, tc.mcpServerSlug);

    // Stamp authorization provenance in the same spot as tool_kind, for every
    // observed tool call (gated or auto-approved). A gated call is re-seeded on
    // reinvocation (index.ts) with the same source carried through the interrupt.
    stampApprovalProvenance(tc, this.approvalProvider);

    if (approvalReq.requiresApproval) {
      tc.requiresApproval = true;
      tc.approvalMessage = approvalReq.message;
      tc.approvalRequestedAt = utcTimestamp();

      const argsPreview = sanitizeArgsPreview(input);
      if (argsPreview) {
        tc.argsPreview = argsPreview;
      }

      this._awaitingApproval = true;
    }

    parentMsg.toolCalls.push(tc);
    this.state.toolCalls.set(callId, tc);
    this.state.toolStartTimes.set(callId, performance.now());

    this._forceNextUpdate = true;
  }

  private handleToolFinished(callId: string, output: unknown): void {
    const tc = this.state.toolCalls.get(callId);
    if (!tc) return;

    // Store the faithful result; bounding the gRPC payload is owned solely by
    // the persist chokepoint (offload + enforce in status.ts/status-offload.ts).
    // Truncating here would corrupt binary content (e.g. a screenshot's base64)
    // before offload can lift it into a renderable ToolCallOutputRef.
    tc.status = ToolCallStatus.TOOL_CALL_COMPLETED;
    tc.result = extractToolResultV3(output);
    tc.completedAt = utcTimestamp();
    tc.isStreaming = false;
    this.state.toolStartTimes.delete(callId);
    this.toolArgBuffers.delete(callId);

    // Project a completed to-do write into status.todos. deepagents' write_todos
    // runs its state-mutating Command when the tool node COMPLETES, so we mirror
    // it here (not at tool-start) — a call cancelled before finishing correctly
    // projects nothing. Keyed on the harness-agnostic ToolKind.TODO (stamped at
    // tool-start) and fed by the same shared mapper the Cursor tracker uses;
    // deepagents always full-replaces (no merge field). The tool call itself
    // stays in messages (the client filters ToolKind.TODO from the thread).
    if (tc.toolKind === ToolKind.TODO) {
      applyTodoUpdate(this.state.proto.todos, tc.args?.todos, { merge: false });
    }

    this._forceNextUpdate = true;
  }

  private handleToolError(callId: string, message: string): void {
    const tc = this.state.toolCalls.get(callId);
    if (!tc) return;

    tc.status = ToolCallStatus.TOOL_CALL_FAILED;
    tc.error = message;
    tc.completedAt = utcTimestamp();
    tc.isStreaming = false;
    this.state.toolStartTimes.delete(callId);
    this.toolArgBuffers.delete(callId);

    this._forceNextUpdate = true;
  }

  private handleToolCallArgDelta(callId: string, argsChunk: string): void {
    const tc = this.state.toolCalls.get(callId);
    if (!tc) return;

    const buffer = (this.toolArgBuffers.get(callId) ?? "") + argsChunk;
    this.toolArgBuffers.set(callId, buffer);

    try {
      tc.args = JSON.parse(buffer) as JsonObject;
    } catch {
      // Partial JSON — will parse on next chunk or tool-finished
    }
  }

  private handleToolOutputDelta(callId: string, delta: string): void {
    const tc = this.state.toolCalls.get(callId);
    if (!tc) return;
    tc.result = (tc.result ?? "") + delta;
  }

  // ── Namespace Resolution ────────────────────────────────────────

  /**
   * v3 tool events carry namespace like "tools:toolu_abc" or
   * "subagent:worker-1|tools:toolu_abc". Strip tools:* segments
   * to get the agent namespace for AI message lookup.
   */
  private resolveAgentNamespace(ns: string): string {
    if (!ns) return "";
    const parts = ns.split("|").filter(p => !p.startsWith("tools:"));
    return parts.join("|");
  }

  // ── Approval ──────────────────────────────────────────────────────

  private checkApprovalRequirement(
    toolName: string,
    args: Record<string, unknown>,
  ): { requiresApproval: boolean; message: string; serverSlug: string } {
    if (!this.approvalProvider) {
      return { requiresApproval: false, message: "", serverSlug: "" };
    }

    const serverSlug = this.approvalProvider.toolServerMap.get(toolName) ?? "";

    if (this.approvalProvider.globalBypass) {
      return { requiresApproval: false, message: "", serverSlug };
    }

    // Unattended mode: the gate auto-skips instead of interrupting, so no row
    // is ever WAITING_APPROVAL and the phase never flips — the streamed row
    // runs to its skip result and reconcileUnattendedSkips terminalizes it.
    if (this.approvalProvider.unattended) {
      return { requiresApproval: false, message: "", serverSlug };
    }

    if (serverSlug) {
      const key = `${serverSlug}/${toolName}`;
      const policy = this.approvalProvider.policies.get(key);
      if (policy?.requiresApproval) {
        return {
          requiresApproval: true,
          message: resolveApprovalMsg(policy.approvalMessage, toolName, args),
          serverSlug,
        };
      }
      return { requiresApproval: false, message: "", serverSlug };
    }

    return { requiresApproval: false, message: "", serverSlug: "" };
  }

  // ── Content Helpers ───────────────────────────────────────────────

  private ensureAiMessage(
    runId: string,
    namespace: string,
    type: MessageType,
  ): AgentMessage {
    const existingByRun = this.state.messagesByRun.get(runId);
    if (existingByRun) return existingByRun;

    const lastRunId = this.state.lastLlmRunId.get(namespace);
    if (lastRunId && lastRunId !== runId) {
      const existingMsg = this.state.currentAiMessage.get(namespace);
      if (existingMsg) {
        existingMsg.isStreaming = false;
      }
    }

    const msg = create(AgentMessageSchema, {
      type,
      content: "",
      timestamp: utcTimestamp(),
      isStreaming: true,
    });

    this.state.proto.messages.push(msg);
    this.state.messagesByRun.set(runId, msg);
    this.state.currentAiMessage.set(namespace, msg);
    this.state.lastLlmRunId.set(namespace, runId);

    return msg;
  }

  private ensureAiMessageForToolCall(namespace: string): AgentMessage | null {
    const lastRunId = this.state.lastLlmRunId.get(namespace);
    if (lastRunId) {
      const existing = this.state.messagesByRun.get(lastRunId);
      if (existing) {
        this.state.currentAiMessage.set(namespace, existing);
        return existing;
      }
    }

    const msg = create(AgentMessageSchema, {
      type: MessageType.MESSAGE_AI,
      content: "",
      timestamp: utcTimestamp(),
      isStreaming: false,
    });

    this.state.proto.messages.push(msg);
    this.state.currentAiMessage.set(namespace, msg);

    return msg;
  }

  // ── Sub-Agent Integration ──────────────────────────────────────────

  /**
   * Check if a tool_call_id belongs to a tracked "task" tool invocation.
   * Used to route tool_finished/tool_error events to both parent and tracker.
   */
  private isTrackedTaskTool(callId: string): boolean {
    const tc = this.state.toolCalls.get(callId);
    return tc?.name === "task";
  }

  /**
   * Clear the streaming flag on every sub-agent message still marked as
   * streaming — what a turn that stopped mid-delegation owes the transcript
   * beside the CANCELLED status the caller stamps on the row itself
   * (`shared/subagent-rows.ts` `cancelInProgressSubAgentProtos`, the one
   * home of that transition for every harness).
   */
  finalizeSubAgentStreaming(): void {
    this.subAgentTracker.finalizeAllStreaming();
  }
}
