// The snapshot→event differ: the headless analog of Go's streamToEvents
// (run_stream_events.go:203-468).
//
// Go's version owns a gRPC loop and blocks on an approval channel. This is a
// pure, stateful transformer instead: feed it each AgentExecution snapshot and
// it returns the discrete events for that snapshot, holding all cross-snapshot
// state (message cursor, tool/sub-agent/todo trackers, prompted-approval dedup).
// Approval *submission* is the renderer's job — the differ only emits
// ApprovalNeededEvent. The step numbering and ordering below mirror the Go body
// exactly, because the resulting event sequence is a wire-parity contract.

import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { PendingApproval } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/approval_pb";
import type { AgentMessage, ToolCall } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import type { SubAgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/subagent_pb";
import { ExecutionPhase, MessageType } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import {
  buildApprovalNeeded,
  buildPendingApprovalFromToolCall,
  findAllUnpromptedApprovals,
  hasUsableApproval,
} from "./approval-detect.js";
import {
  collectToolCallsFromMessages,
  convertToolCalls,
  findToolCallById,
  isApprovalNoiseMessage,
  isTerminalAgentPhase,
  mapPhaseToString,
  mapSummarizationSource,
  sanitizeSystemContent,
} from "./convert.js";
import type { StreamEvent } from "./events.js";
import { SubAgentTracking } from "./subagent.js";
import { TodoDiffer } from "./todo.js";
import { buildToolEventMap, toolEventId, ToolStateTracker } from "./tool-state.js";

/**
 * Stateful differ. Construct one per execution stream, then call {@link next}
 * for every snapshot in arrival order. Once a terminal `done` is emitted, later
 * calls return nothing.
 */
export class SnapshotDiffer {
  private displayedCount = 0;
  private inStream = false;
  private humanMessageEmitted = false;
  private lastPhase: ExecutionPhase = ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED;
  private seenSummarizationCount = 0;
  private finished = false;
  private readonly promptedIds = new Set<string>();
  private readonly topTools = new ToolStateTracker();
  private readonly subAgentTracking = new SubAgentTracking();
  private readonly todos = new TodoDiffer();

  /** Project one snapshot into its events, advancing all internal state. */
  next(execution: AgentExecution): StreamEvent[] {
    if (this.finished) return [];
    const out: StreamEvent[] = [];
    const status = execution.status;
    const messages = status?.messages ?? [];
    const subAgents = status?.subAgentExecutions ?? [];
    const phase = status?.phase ?? ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED;

    this.emitHumanMessage(out, execution);

    // Step 1: track tool transitions, then interleave message + tool events.
    const rootToolCalls = collectToolCallsFromMessages(messages);
    const toolEvents = this.topTools.track(rootToolCalls, "");
    const pendingTools = buildToolEventMap(toolEvents);
    this.emitMessageEvents(out, messages, pendingTools);

    // Step 1c: orphan tool events (no matching MESSAGE_TOOL this snapshot).
    for (const ev of toolEvents) {
      if (pendingTools.has(toolEventId(ev))) out.push(ev);
    }

    // Step 1d–1f: sub-agents, todos, context compaction.
    if (subAgents.length > 0) out.push(...this.subAgentTracking.emit(subAgents));
    const todos = status?.todos ?? {};
    if (Object.keys(todos).length > 0 || this.todos.hasPrev) {
      out.push(...this.todos.diff(todos));
    }
    this.emitContextCompaction(out, execution);

    // Step 2: phase change (with approval cycle-reset) before approval handling.
    this.emitPhaseChange(out, phase);

    // Step 3 + 3b: approval detection (pending_approvals, then status scan).
    this.emitApprovals(out, status?.pendingApprovals ?? [], rootToolCalls, subAgents, phase);

    // Step 5: terminal → done.
    if (isTerminalAgentPhase(phase)) {
      this.finished = true;
      out.push({ kind: "done", phase: mapPhaseToString(phase), error: status?.error ?? "" });
    }

    return out;
  }

  // Step 0: emit the user's input message once, suppressing the "execute"
  // placeholder. Mirrors streamToEvents Step 0.
  private emitHumanMessage(out: StreamEvent[], execution: AgentExecution): void {
    if (this.humanMessageEmitted) return;
    const msg = execution.spec?.message ?? "";
    if (msg !== "" && msg !== "execute") {
      out.push({ kind: "humanMessage", content: msg });
      this.humanMessageEmitted = true;
    }
  }

  // Steps 1b: convert new messages to events, interleaving matched tool events
  // at their chronological position. Mirrors Go's emitMessageEvents.
  private emitMessageEvents(out: StreamEvent[], messages: readonly AgentMessage[], pending: Map<string, StreamEvent>): void {
    // Phase 1: an in-progress streaming AI message.
    if (this.inStream && this.displayedCount < messages.length) {
      const msg = messages[this.displayedCount];
      if (msg.isStreaming) {
        out.push({ kind: "aiStreamDelta", content: msg.content, subAgentId: "" });
        return;
      }
      out.push({ kind: "aiStreamEnd", content: msg.content, toolCalls: convertToolCalls(msg.toolCalls), subAgentId: "" });
      this.displayedCount++;
      this.inStream = false;
    }

    // Phase 2: complete messages, detecting a new streaming start.
    while (this.displayedCount < messages.length) {
      const msg = messages[this.displayedCount];
      if (msg.isStreaming && msg.type === MessageType.MESSAGE_AI) {
        out.push({ kind: "aiStreamStart", content: msg.content, subAgentId: "" });
        this.inStream = true;
        return;
      }
      if (msg.type === MessageType.MESSAGE_HUMAN) {
        this.displayedCount++;
        continue;
      }
      if (this.isTrackedToolMessage(msg)) {
        emitMatchedToolEvents(out, msg, pending);
        this.displayedCount++;
        continue;
      }
      this.emitCompleteMessage(out, msg);
      this.displayedCount++;
    }
  }

  // Emit one complete (non-streaming) message by type. Mirrors Go's emitCompleteMessage.
  private emitCompleteMessage(out: StreamEvent[], msg: AgentMessage): void {
    switch (msg.type) {
      case MessageType.MESSAGE_HUMAN:
        out.push({ kind: "humanMessage", content: msg.content });
        return;
      case MessageType.MESSAGE_AI:
        out.push({ kind: "aiMessage", content: msg.content, toolCalls: convertToolCalls(msg.toolCalls), subAgentId: "" });
        return;
      case MessageType.MESSAGE_TOOL:
        out.push({ kind: "toolResult", content: msg.content, toolCalls: convertToolCalls(msg.toolCalls) });
        return;
      case MessageType.MESSAGE_SYSTEM:
        if (isApprovalNoiseMessage(msg.content)) return;
        out.push({ kind: "systemMessage", content: sanitizeSystemContent(msg.content) });
        return;
      default:
        out.push({ kind: "systemMessage", content: `Unknown message: ${msg.content}` });
    }
  }

  // True for a MESSAGE_TOOL whose tool call the top-level tracker already owns.
  // Mirrors Go's isTrackedToolMessage.
  private isTrackedToolMessage(msg: AgentMessage): boolean {
    if (msg.type !== MessageType.MESSAGE_TOOL) return false;
    return msg.toolCalls.some((tc) => tc.id !== "" && this.topTools.has(tc.id));
  }

  // Step 1f: emit a ContextCompactedEvent per new summarization event. Mirrors
  // the count-based tracking in streamToEvents.
  private emitContextCompaction(out: StreamEvent[], execution: AgentExecution): void {
    const events = execution.status?.contextInfo?.summarizationEvents ?? [];
    for (let i = this.seenSummarizationCount; i < events.length; i++) {
      const se = events[i];
      out.push({
        kind: "contextCompacted",
        source: mapSummarizationSource(se.source),
        tokensBefore: se.tokensBefore,
        tokensAfter: se.tokensAfter,
        compressionRatio: se.compressionRatio,
        durationMs: se.durationMs,
        messagesBefore: se.messagesBefore,
        messagesAfter: se.messagesAfter,
      });
    }
    this.seenSummarizationCount = events.length;
  }

  // Step 2: phase change, resetting the prompted set on an approval cycle
  // (IN_PROGRESS→WAITING_FOR_APPROVAL) so a re-entered gate re-prompts instead
  // of deadlocking. Mirrors streamToEvents Step 2.
  private emitPhaseChange(out: StreamEvent[], phase: ExecutionPhase): void {
    if (phase === this.lastPhase) return;
    if (
      phase === ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL &&
      this.lastPhase === ExecutionPhase.EXECUTION_IN_PROGRESS
    ) {
      this.promptedIds.clear();
    }
    out.push({ kind: "phaseChange", phase: mapPhaseToString(phase), previous: mapPhaseToString(this.lastPhase) });
    this.lastPhase = phase;
  }

  // Steps 3 + 3b: emit ApprovalNeededEvent for each unprompted pending approval,
  // then fall back to a tool-status scan when pending_approvals is degraded.
  private emitApprovals(
    out: StreamEvent[],
    pendingApprovals: readonly PendingApproval[],
    rootToolCalls: readonly ToolCall[],
    subAgents: readonly SubAgentExecution[],
    phase: ExecutionPhase,
  ): void {
    for (const pa of pendingApprovals) {
      const key = pa.toolCallId;
      if (key === "" || this.promptedIds.has(key)) continue;
      const tc = findToolCallById(rootToolCalls, subAgents, pa.toolCallId);
      out.push(buildApprovalNeeded(tc, pa));
      this.promptedIds.add(key);
    }

    if (
      !hasUsableApproval(pendingApprovals, this.promptedIds) &&
      phase === ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL
    ) {
      for (const u of findAllUnpromptedApprovals(rootToolCalls, subAgents, this.promptedIds)) {
        const pa = buildPendingApprovalFromToolCall(u.toolCall);
        pa.fromSubAgent = u.fromSubAgent;
        pa.subAgentName = u.subAgentName;
        out.push(buildApprovalNeeded(u.toolCall, pa));
        this.promptedIds.add(pa.toolCallId);
      }
    }
  }
}

// Emit tool events whose IDs match the MESSAGE_TOOL's embedded tool calls at the
// current position, consuming them from `pending`. Mirrors Go's emitMatchedToolEvents.
function emitMatchedToolEvents(out: StreamEvent[], msg: AgentMessage, pending: Map<string, StreamEvent>): void {
  for (const tc of msg.toolCalls) {
    if (tc.id === "") continue;
    const ev = pending.get(tc.id);
    if (ev !== undefined) {
      out.push(ev);
      pending.delete(tc.id);
    }
  }
}
