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
 * `namespace` grammar, the approval decision from a provider) is cut out at
 * M2, one ruling per commit (Q-S4-3 to Q-S4-7) — a tool's result already
 * arrives as the string the row carries (C2a), so the LangChain envelope is
 * no longer read here — and the `SubAgentTracker` — a second copy of these
 * handlers for a sub-agent's own transcript — is folded into one scoped set
 * (Q-S4-4). The Cursor harness feeds this builder through a translator at
 * M4; the runtime hands it to every adapter as `TurnSink.transcript` at M5.
 * The builder's own tests still live in the native adapter's folder
 * (`execute-deep-agent/__tests__/v3-status-builder.test.ts`) because they
 * drive it through the LangGraph normalizer; they re-home at M2 (Q-M1-2).
 *
 * What this builder deliberately does NOT write, and who does (the adapter
 * contract's field ownership, `harness/types.ts` `TurnSink`): the phase,
 * `startedAt` and `streamingUsage` are the turn runtime's. A gated tool
 * start is reported as the {@link awaitingApproval} fact and the caller
 * (`turn-stream.ts`) decides what that means for the turn. Usage never
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
import {
  POLICY_ENGINE_VERSION,
  resolveApprovalMessage as resolveApprovalMsg,
  resolveApprovalProvenance,
  toProtoPolicySource,
  type MergedToolPolicy,
} from "../../shared/approval-policy.js";
import { sanitizeArgsPreview } from "../../shared/args-preview.js";
import { classifyTool, type ToolApprovalCategory } from "../../shared/tool-kind.js";
import { applyTodoUpdate } from "../../shared/todos.js";
import { utcTimestamp } from "../../shared/status.js";
import type { ExecutionStatusWriter } from "../../shared/execution-status-writer.js";
import { TranscriptState } from "./state.js";
import type { TranscriptEvent } from "./events.js";
import { namespaceDepth } from "./events.js";
import { SubAgentTracker } from "./subagent-tracker.js";

// ── Authorization Provenance ───────────────────────────────────────

/**
 * The policy inputs the builder needs to decide whether a tool call waits for
 * approval and to attribute its authorization provenance.
 *
 * M2-transient (S4 Q-S4-3): the decision moves to the translator, which
 * answers it per call as `tool_started.gate`, and this provider shape goes
 * with it. Until then the native adapter hands the gate's policy state in
 * through {@link TranscriptBuilder.setApprovalProvider}.
 */
export interface ApprovalProvenanceInputs {
  readonly policies: ReadonlyMap<string, MergedToolPolicy>;
  readonly toolServerMap: ReadonlyMap<string, string>;
  /**
   * Built-in categories with a run-lifetime lease, so a leased built-in is
   * attributed to its lease (approval_lease) rather than the plain category gate.
   * Optional (mirroring {@link ApprovalGateConfig.leasedCategories}); absent =
   * no lease active.
   */
  readonly leasedCategories?: ReadonlySet<ToolApprovalCategory>;
  /** Pre-armed spec.auto_approve_all — the one whole-run global bypass. */
  readonly globalBypass: boolean;
  /**
   * Unattended approval mode (ExecutionConfig.approval_mode = UNATTENDED):
   * the gate auto-skips gated calls instead of interrupting, so the builder
   * must NOT seed WAITING_APPROVAL rows or flip the phase to
   * WAITING_FOR_APPROVAL — the row streams as RUNNING and the post-stream
   * `reconcileUnattendedSkips` stamps the terminal SKIPPED + provenance.
   */
  readonly unattended?: boolean;
}

/**
 * The name the builder's API uses for the same shape (`setApprovalProvider`):
 * the adapter hands the gate's policy state in under this name. One shape, two
 * names on purpose — the provider is what a caller SUPPLIES, the inputs are
 * what the stamper READS; until S3 M2b the v2 builder declared the provider as
 * an empty `interface extends`, a second type for one shape.
 */
export type ApprovalPolicyProvider = ApprovalProvenanceInputs;

/** Shared empty set so a provider without leases allocates nothing per call. */
const NO_LEASED_CATEGORIES: ReadonlySet<ToolApprovalCategory> = new Set();

/**
 * Stamp a tool call's authorization provenance — which policy layer governs it —
 * alongside `tool_kind`, in exactly the spot the builder classifies the tool.
 *
 * This is the read-side companion to the gate: it records WHY a tool is gated or
 * auto-approved for every observed tool call, so the persisted record is
 * auditable and the UI can explain the gate. Built-ins that no layer governs (a
 * read-only built-in) and the no-provider path both leave the field at
 * UNSPECIFIED, like an unclassified tool_kind. Sub-agent rows carry no
 * provenance on either harness today (S4 review finding 11), which is why the
 * tracker does not call this.
 */
export function stampApprovalProvenance(
  tc: ToolCall,
  provider: ApprovalProvenanceInputs | null,
): void {
  if (!provider) return;
  const serverSlug = tc.mcpServerSlug || provider.toolServerMap.get(tc.name) || "";
  const source = resolveApprovalProvenance(
    tc.name,
    serverSlug,
    provider.policies,
    provider.leasedCategories ?? NO_LEASED_CATEGORIES,
    provider.globalBypass,
  );
  tc.approvalPolicySource = toProtoPolicySource(source);
  if (source) tc.policyEngineVersion = POLICY_ENGINE_VERSION;
}

// ── Builder ────────────────────────────────────────────────────────

export class TranscriptBuilder implements ExecutionStatusWriter {
  readonly executionId: string;
  private readonly state: TranscriptState;
  private _forceNextUpdate = false;
  private _awaitingApproval = false;
  private approvalProvider: ApprovalPolicyProvider | null = null;
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

  /** Fold one canonical event into the transcript. Never throws: a handler's error is logged and the stream goes on. */
  apply(event: TranscriptEvent): void {
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
          this.handleToolStarted(event.callId, event.name, event.input, event.namespace);
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

  private handleToolStarted(
    callId: string,
    name: string,
    input: Record<string, unknown>,
    namespace: string,
  ): void {
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
    // reinvocation (the runtime's wide seed) with the same source carried
    // through the interrupt.
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
