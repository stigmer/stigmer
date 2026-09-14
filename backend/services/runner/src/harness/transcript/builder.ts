/**
 * TranscriptBuilder — folds `TranscriptEvent`s into the transcript half of
 * the AgentExecutionStatus proto it is handed: messages, tool-call rows and
 * their approval status, sub-agent rows, todos, artifacts, write-backs.
 *
 * The one transcript builder, for every harness, in the making (S4,
 * `T01_0_plan.md`). It was the native harness's `V3StatusBuilder` (the one
 * builder there since S3 M2b retired the v2 `StatusBuilder`, Q-S3-1) and was
 * promoted here at M1 (2026-09-14) unchanged in behavior — a `git mv` with
 * the names ruled at Q-S4-2 — so the fence that keeps `harness/` out of
 * `activities/` protects it from here on. What it still knows of LangGraph
 * (the `task` tool name and its namespace depth for opening a sub-agent, the
 * `namespace` grammar) is cut out at M2, one ruling per commit (Q-S4-3 to
 * Q-S4-7) — a tool's result already arrives as the string the row carries
 * (C2a), and a tool's attribution, provenance and gate answer arrive on
 * `tool_started` from the translator (C3), so this builder no longer reads
 * an engine envelope or decides anything about approval — and the
 * `SubAgentTracker` — a second copy of these handlers for a sub-agent's own
 * transcript — is folded into one scoped set (Q-S4-4). The Cursor harness feeds this builder through a translator at
 * M4; the runtime hands it to every adapter as `TurnSink.transcript` at M5.
 * The builder's own tests still live in the native adapter's folder
 * (`execute-deep-agent/__tests__/v3-status-builder.test.ts`) because they
 * drive it through the LangGraph normalizer; they re-home at M2 (Q-M1-2).
 *
 * What this builder deliberately does NOT write, and who does (the adapter
 * contract's field ownership, `harness/types.ts` `TurnSink`): the phase,
 * `startedAt` and `streamingUsage` are the turn runtime's. A row left
 * WAITING_APPROVAL is reported as the {@link awaitingApproval} fact and the
 * caller (`turn-stream.ts`, the settle) decides what that means for the
 * turn — a fact only `approval_proposed` produces once M2 C6 lands, because
 * a call that has STARTED is never parked at creation (C3, option A). Usage never
 * passes through here at all (S4 M2 C1): it is not a transcript fact, so the
 * union does not carry it — the native loop reads it off the wire
 * (`usageOf`) and prices it into the sink, the Cursor loop reads its own
 * from the SDK. Until S3 M2a this builder flipped WAITING_FOR_APPROVAL
 * itself and summed usage into `streamingUsage` — a second writer of each
 * field beside the runtime's; until S4 M2 it still relayed usage through an
 * `onUsage` hook, a fact passing through a module that had no use for it.
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
import { POLICY_ENGINE_VERSION, toProtoPolicySource } from "../../shared/approval-policy.js";
import { classifyTool } from "../../shared/tool-kind.js";
import { applyTodoUpdate } from "../../shared/todos.js";
import { utcTimestamp } from "../../shared/status.js";
import type { ExecutionStatusWriter } from "../../shared/execution-status-writer.js";
import { TranscriptState } from "./state.js";
import type { ToolStartedEvent, TranscriptEvent } from "./events.js";
import { namespaceDepth } from "./events.js";
import { SubAgentTracker } from "./subagent-tracker.js";

// ── Builder ────────────────────────────────────────────────────────

export class TranscriptBuilder implements ExecutionStatusWriter {
  readonly executionId: string;
  private readonly state: TranscriptState;
  private _forceNextUpdate = false;
  private _awaitingApproval = false;
  private readonly subAgentTracker: SubAgentTracker;

  /** Progressive tool call arg accumulation keyed by callId. */
  private readonly toolArgBuffers = new Map<string, string>();

  /**
   * Builds INTO `status`, by reference: its `messages` and
   * `subAgentExecutions` arrays are the ones indexed and pushed into, never
   * replaced, so a caller that wraps the same status (the write-back
   * coordinator's writer, the runtime's chokepoint) keeps seeing every row.
   */
  constructor(executionId: string, status: AgentExecutionStatus) {
    this.executionId = executionId;
    this.state = new TranscriptState(status);

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

  get currentStatus(): AgentExecutionStatus {
    return this.state.proto;
  }

  /**
   * True once a row this turn was left WAITING_APPROVAL: the engine has
   * interrupted (or the harness's boundary parked the call) and the turn
   * should end awaiting a decision. A fact about the transcript, not a phase
   * — the caller owns the phase. No `tool_started` sets it (a started call
   * is running; C3, option A); `approval_proposed` does (M2 C6).
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

  /** Fold one canonical event into the transcript. Never throws: a handler's error is logged and the stream goes on. */
  apply(event: TranscriptEvent): void {
    try {
      // Sub-agent routing: detect "task" tool starts at depth 0 (root) or depth 1
      // (inside LangGraph tools-node). In real runtime, task tool-started arrives
      // at depth 1 with namespace like "tools:<pregelTaskUuid>".
      if (event.kind === "tool_started" && event.name === "task" && namespaceDepth(event.namespace) <= 1) {
        const routingPrefix = event.namespace || `tools:${event.callId}`;
        this.subAgentTracker.onTaskToolStarted(event.callId, event.input, routingPrefix);
        this.handleToolStarted(event);
        this._forceNextUpdate = true;
        return;
      }

      if (event.kind === "tool_finished" && this.isTrackedTaskTool(event.callId)) {
        this.subAgentTracker.onTaskToolFinished(event.callId, event.result);
        this.handleToolFinished(event.callId, event.result);
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
        case "tool_arg_delta":
          this.handleToolArgDelta(event.callId, event.argsChunk);
          break;
        case "message_finish":
          this.handleMessageFinish(event.runId);
          break;
        case "tool_started":
          this.handleToolStarted(event);
          break;
        case "tool_finished":
          this.handleToolFinished(event.callId, event.result);
          break;
        case "tool_error":
          this.handleToolError(event.callId, event.message);
          break;
        case "tool_output_delta":
          this.handleToolOutputDelta(event.callId, event.delta);
          break;
        default: {
          const exhaustive: never = event;
          throw new Error(`unknown transcript event ${String((exhaustive as { kind: string }).kind)}`);
        }
      }
    } catch (err) {
      console.error(
        `[TranscriptBuilder] Event handler error: execution=${this.executionId} kind=${event.kind}: ${err}`,
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

  private handleMessageFinish(runId: string): void {
    const msg = this.state.messagesByRun.get(runId);
    if (msg) {
      msg.isStreaming = false;
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

  private handleToolStarted(event: ToolStartedEvent): void {
    const { callId, name, input } = event;
    // Resume reconciliation: the gated tool call already exists, seeded from the
    // persisted transcript of a prior invocation (the runtime's
    // `seedFromPersistedStatus`, `harness/turn-context.ts`). The durable
    // checkpoint re-emits tool_started now that approval
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
      this._forceNextUpdate = true;
      return;
    }

    const agentNs = this.resolveAgentNamespace(event.namespace);
    const parentMsg = this.state.currentAiMessage.get(agentNs)
      ?? this.ensureAiMessageForToolCall(agentNs);
    if (!parentMsg) return;

    // A started call is RUNNING, gated or not: a gated call that has started
    // runs until the harness's boundary parks it through `approval_proposed`
    // (Cursor), and on native a held call never starts at all — the engine
    // interrupts before the tool runs and the post-stream seed proposes it.
    // The builder writes the gate's word it is told and decides nothing
    // about approval (S4 M2 C3, option A).
    const tc = create(ToolCallSchema, {
      id: callId,
      name,
      status: ToolCallStatus.TOOL_CALL_RUNNING,
      startedAt: utcTimestamp(),
    });

    if (Object.keys(input).length > 0) {
      tc.args = input as JsonObject;
    }

    if (event.mcpServerSlug) {
      tc.mcpServerSlug = event.mcpServerSlug;
    }

    // Classify after mcpServerSlug is set so MCP tools resolve correctly.
    tc.toolKind = classifyTool(tc.name, tc.mcpServerSlug);

    // Authorization provenance — which policy layer governs the call — stamped
    // in the same spot as tool_kind, for every observed call the translator
    // could attribute (gated or auto-approved), so the persisted record is
    // auditable and the UI can explain the gate. Absent provenance leaves the
    // field at UNSPECIFIED, like an unclassified tool_kind. A gated call is
    // re-seeded on reinvocation (the runtime's wide seed) with the same source
    // carried through the interrupt.
    if (event.provenance !== undefined) {
      tc.approvalPolicySource = toProtoPolicySource(event.provenance);
      tc.policyEngineVersion = POLICY_ENGINE_VERSION;
    }

    // The gate's word: the row says it is gated and what the card will ask;
    // `approvalRequestedAt` is stamped when the boundary actually parks it
    // (`approval_proposed`, or a gated row's `tool_error`), never here.
    if (event.gate) {
      tc.requiresApproval = true;
      tc.approvalMessage = event.gate.message;
    }

    parentMsg.toolCalls.push(tc);
    this.state.toolCalls.set(callId, tc);

    this._forceNextUpdate = true;
  }

  private handleToolFinished(callId: string, result: string): void {
    const tc = this.state.toolCalls.get(callId);
    if (!tc) return;

    // Store the faithful result; bounding the gRPC payload is owned solely by
    // the persist chokepoint (offload + enforce in status.ts/status-offload.ts).
    // Truncating here would corrupt binary content (e.g. a screenshot's base64)
    // before offload can lift it into a renderable ToolCallOutputRef.
    tc.status = ToolCallStatus.TOOL_CALL_COMPLETED;
    tc.result = result;
    tc.completedAt = utcTimestamp();
    tc.isStreaming = false;
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
    this.toolArgBuffers.delete(callId);

    this._forceNextUpdate = true;
  }

  private handleToolArgDelta(callId: string, argsChunk: string): void {
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
