/**
 * LangGraph event-to-proto mapper for ExecuteDeepAgent streaming.
 *
 * Processes streamEvents v2 events and progressively builds the
 * AgentExecutionStatus proto. Each handler method is a focused unit
 * testable in isolation.
 *
 * Phase 3b-i scope: main-agent events only (no sub-agent routing,
 * no HITL approval, no tool input streaming). Those are added in
 * Phases 3b-ii and 3c.
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
  ApprovalAction,
  ExecutionPhase,
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
import {
  UsageAccumulator,
  extractToolResult,
  sanitizeArgsPreview,
  stampApprovalProvenance,
  type ApprovalProvenanceInputs,
} from "./status-builder-shared.js";

/** Minimal LangGraph streamEvents v2 event shape. */
export interface StreamEvent {
  readonly event: string;
  readonly name?: string;
  readonly run_id: string;
  readonly data: Record<string, unknown>;
  readonly metadata?: Record<string, unknown>;
  readonly parent_ids?: readonly string[];
}

type EventHandler = (event: StreamEvent, namespace: string) => void;

/**
 * The approval inputs the StatusBuilder reads to set requires-approval and to
 * attribute each tool call's authorization provenance.
 *
 * Extends {@link ApprovalProvenanceInputs} so the provenance stamper and the
 * builder share one shape. `globalBypass` is the pre-armed spec.auto_approve_all
 * (the one whole-run global bypass); `leasedCategories` lets a leased built-in be
 * attributed to its run-lifetime lease rather than the plain category gate.
 */
export interface ApprovalPolicyProvider extends ApprovalProvenanceInputs {}

export class StatusBuilder {
  readonly executionId: string;
  private readonly state: ExecutionState;
  private _forceNextUpdate = false;
  private approvalProvider: ApprovalPolicyProvider | null = null;

  private readonly usageAccumulator: UsageAccumulator;
  private readonly handlers: ReadonlyMap<string, EventHandler>;

  constructor(executionId: string, initialStatus: AgentExecutionStatus) {
    this.executionId = executionId;
    this.state = new ExecutionState(initialStatus);

    // Resume path: when constructed from a persisted transcript (status seeded
    // in index.ts on a durable-checkpoint resume), rebuild the tool-call index
    // so resumed tool events reconcile to the existing calls instead of
    // duplicating them. A first run carries no messages, so this is a no-op.
    if (initialStatus.messages.length > 0) {
      this.state.rebuildToolCallIndex();
    }

    initialStatus.phase = ExecutionPhase.EXECUTION_IN_PROGRESS;
    if (!initialStatus.startedAt) {
      initialStatus.startedAt = utcTimestamp();
    }

    this.usageAccumulator = new UsageAccumulator();

    this.handlers = new Map<string, EventHandler>([
      ["on_chat_model_stream", this.handleChatModelStream.bind(this)],
      ["on_chat_model_end", this.handleChatModelEnd.bind(this)],
      ["on_tool_start", this.handleToolStart.bind(this)],
      ["on_tool_end", this.handleToolEnd.bind(this)],
    ]);
  }

  setApprovalProvider(provider: ApprovalPolicyProvider): void {
    this.approvalProvider = provider;
  }

  get currentStatus(): AgentExecutionStatus {
    return this.state.proto;
  }

  get forceNextUpdate(): boolean {
    return this._forceNextUpdate;
  }

  clearForceFlag(): void {
    this._forceNextUpdate = false;
  }

  /**
   * Process a single streamEvents v2 event.
   * Unknown event types are silently ignored.
   */
  processEvent(event: StreamEvent): void {
    const namespace = this.extractNamespace(event);
    const handler = this.handlers.get(event.event);
    if (!handler) return;

    try {
      handler(event, namespace);
    } catch (err) {
      console.error(
        `[StatusBuilder] Event handler error: execution=${this.executionId} ` +
        `event=${event.event} run_id=${event.run_id}: ${err}`,
      );
    }
  }

  // ── Artifact & WriteBack ───────────────────────────────────────────

  /**
   * Add or update an execution artifact. Deduplicates by `sandboxPath`:
   * if an artifact with the same path already exists, it is replaced only
   * when the `contentHash` has changed (re-upload of modified file).
   */
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

  /**
   * Add or update a workspace write-back entry. Upserts by
   * `workspaceEntryName` — each git-backed workspace entry produces
   * at most one write-back record that progresses through phases.
   */
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

  // ── Event Handlers ─────────────────────────────────────────────────

  private handleChatModelStream(event: StreamEvent, namespace: string): void {
    const chunk = event.data?.chunk as Record<string, unknown> | undefined;
    if (!chunk) return;

    const content = chunk.content;

    if (Array.isArray(content)) {
      for (const block of content) {
        if (typeof block === "object" && block !== null) {
          const b = block as Record<string, unknown>;
          if (b.type === "thinking" && typeof b.thinking === "string") {
            this.appendThinkingContent(event.run_id, namespace, b.thinking);
          } else if (b.type === "text" && typeof b.text === "string") {
            this.appendTextContent(event.run_id, namespace, b.text);
          }
        }
      }
    } else if (typeof content === "string" && content.length > 0) {
      this.appendTextContent(event.run_id, namespace, content);
    }
  }

  private handleChatModelEnd(event: StreamEvent, namespace: string): void {
    const output = event.data?.output as Record<string, unknown> | undefined;

    const msg = this.state.messagesByRun.get(event.run_id);
    if (msg) {
      msg.isStreaming = false;
    }

    const usageMeta = (output?.usage_metadata ?? event.data?.usage_metadata) as
      Record<string, unknown> | undefined;
    if (usageMeta) {
      this.usageAccumulator.accumulate(usageMeta);
      this.syncUsageToProto();
    }
  }

  private handleToolStart(event: StreamEvent, namespace: string): void {
    const toolName = event.name ?? "unknown_tool";

    // Resume reconciliation (v2): the seeded WAITING_APPROVAL tool call was
    // indexed by its tool_call_id, but a resumed on_tool_start carries a fresh
    // LangGraph run_id and exposes no tool_call_id. Match by tool name +
    // pending-approval status so the existing call is resolved in place rather
    // than duplicated, then re-key it under run_id so handleToolEnd resolves the
    // same object. This name match is a v2-only fallback — v3 (the default) keys
    // by the exact tool_call_id; it resolves the first pending call of that
    // name, which is unambiguous for the single-gate resume the workflow drives.
    const seeded = this.findResumableSeededToolCall(toolName);
    if (seeded) {
      seeded.status = ToolCallStatus.TOOL_CALL_RUNNING;
      this.state.toolCalls.set(event.run_id, seeded);
      this.state.toolStartTimes.set(event.run_id, performance.now());
      this._forceNextUpdate = true;
      return;
    }

    const parentMsg = this.state.currentAiMessage.get(namespace)
      ?? this.ensureAiMessageForToolCall(event.run_id, namespace);
    if (!parentMsg) return;

    const rawArgs = event.data?.input as Record<string, unknown> | undefined;
    const args = rawArgs ?? {};

    const approvalReq = this.checkApprovalRequirement(toolName, args);

    const tc = create(ToolCallSchema, {
      id: event.run_id,
      name: toolName,
      status: approvalReq.requiresApproval
        ? ToolCallStatus.TOOL_CALL_WAITING_APPROVAL
        : ToolCallStatus.TOOL_CALL_RUNNING,
      startedAt: utcTimestamp(),
    });

    if (rawArgs) {
      tc.args = rawArgs as JsonObject;
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

      const argsPreview = sanitizeArgsPreview(args);
      if (argsPreview) {
        tc.argsPreview = argsPreview;
      }

      this.state.proto.phase = ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL;
    }

    parentMsg.toolCalls.push(tc);
    this.state.toolCalls.set(event.run_id, tc);
    this.state.toolStartTimes.set(event.run_id, performance.now());

    this._forceNextUpdate = true;
  }

  /**
   * Find a seeded tool call awaiting approval for the given name, for v2 resume
   * reconciliation. Returns the first WAITING_APPROVAL call of that name in the
   * rebuilt index, or undefined when none is pending (the normal first-run path).
   */
  private findResumableSeededToolCall(toolName: string): ToolCall | undefined {
    for (const tc of this.state.toolCalls.values()) {
      if (
        tc.name === toolName &&
        tc.status === ToolCallStatus.TOOL_CALL_WAITING_APPROVAL
      ) {
        return tc;
      }
    }
    return undefined;
  }

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

  private handleToolEnd(event: StreamEvent, _namespace: string): void {
    const tc = this.state.toolCalls.get(event.run_id);
    if (!tc) return;

    const output = event.data?.output as Record<string, unknown> | undefined;
    const errorMsg = output?.error as string | undefined;

    if (errorMsg) {
      tc.status = ToolCallStatus.TOOL_CALL_FAILED;
      tc.error = errorMsg;
    } else {
      // Faithful result only; payload size is bounded at the persist chokepoint
      // (see v3 builder note). Truncating here would corrupt image base64.
      tc.status = ToolCallStatus.TOOL_CALL_COMPLETED;
      tc.result = extractToolResult(event.data);

      // Project a completed to-do write into status.todos — success branch only,
      // since a failed write_todos never ran its state-mutating Command. Shares
      // the mapper and rationale documented in V3StatusBuilder.handleToolFinished.
      if (tc.toolKind === ToolKind.TODO) {
        applyTodoUpdate(this.state.proto.todos, tc.args?.todos, { merge: false });
      }
    }

    tc.completedAt = utcTimestamp();
    tc.isStreaming = false;
    this.state.toolStartTimes.delete(event.run_id);

    this._forceNextUpdate = true;
  }

  // ── Content Helpers ────────────────────────────────────────────────

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

  /**
   * Get or create the AI message for a given LLM run. A new message is
   * created when the run_id changes (turn boundary) to prevent token
   * interleaving.
   */
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

  /**
   * Create an AI message for a tool-only LLM turn (no preceding text).
   * When the model responds with only tool_use blocks and no text,
   * handleChatModelStream never creates an AI message. This method
   * ensures tool calls still get attached to a proper AI message.
   */
  private ensureAiMessageForToolCall(
    _toolRunId: string,
    namespace: string,
  ): AgentMessage | null {
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

  private extractNamespace(event: StreamEvent): string {
    const meta = event.metadata;
    if (!meta) return "";
    const ns = (meta.langgraph_checkpoint_ns ?? meta.checkpoint_ns ?? "") as string;
    return typeof ns === "string" ? ns : "";
  }

  private syncUsageToProto(): void {
    this.state.proto.streamingUsage = this.usageAccumulator.toProto();
  }
}
