/**
 * TranscriptBuilder — folds `TranscriptEvent`s into the transcript half of
 * the AgentExecutionStatus proto it is handed: messages, tool-call rows and
 * their approval status, sub-agent rows, todos, artifacts, write-backs.
 *
 * The one transcript builder, for every harness (S4, `T01_0_plan.md`). It
 * was the native harness's `V3StatusBuilder` (the one builder there since S3
 * M2b retired the v2 `StatusBuilder`, Q-S3-1), promoted here at M1
 * (2026-09-14) unchanged and cut engine-neutral at M2 one ruling per commit:
 * it reads no engine envelope (C2a), decides nothing about approval (C3),
 * and knows no engine's tool names or namespace grammar (C4) — every engine
 * fact reaches it as a translator's output, on one union. The Cursor
 * harness feeds it through a translator (M4); the runtime constructs it once
 * per turn and hands it to every adapter as `TurnSink.transcript` (M5), so
 * a transcript row has exactly one way into the status — a source-walking
 * fence, `harness/__tests__/transcript-writers.test.ts`, refuses a second.
 *
 * ONE set of handlers over ONE scope shape (C4, Q-S4-4): every handler takes
 * the scope's {@link Transcript} — the root's over `status.messages`, or a
 * sub-agent's over its row's — from `TranscriptState`, so a sub-agent's
 * transcript is folded by exactly the rules the root's is. Until C4 the
 * sub-agents' half was a second module (`SubAgentTracker`) with its own copy
 * of every handler, differing only in which array it pushed into — the
 * memo's third copy of the folding rule, and the one whose namespace filter
 * differed from the root's by one segment (S3 M0 finding F-M0-1: the root
 * filed text under `model_request:<uuid>` and looked the tool's parent up
 * under `""`, so every native tool row sat on an empty message after its
 * text). With scope a single value per transcript, that class of miss
 * cannot exist.
 *
 * The rules this builder owns, each with an arm in
 * `harness/transcript/__tests__/builder.test.ts` and the harness whose rule
 * it generalises in parentheses:
 *
 *   - A row per `callId`, indexed over the status as handed and over what
 *     {@link seed} appends (a reinvocation's prior rows, indexed by the same
 *     routine, so a builder born before the seed is no different from one
 *     born after it), reconciled in place on a re-emitted start — an UNSETTLED row becomes
 *     RUNNING (a WAITING row on native's durable-checkpoint resume; an
 *     INTERRUPTED row on a recovery replay, the enum's supersede rule) and
 *     takes the args and preview it lacked — never duplicated. Every row
 *     with args carries `argsPreview`, elided and redacted, salient fields
 *     verbatim (Q-S4-16). A finish or an error is an upsert: status
 *     monotonic, `completedAt` once, a non-empty result or message
 *     overwrites, an empty one never clears (Q-S4-3(c)); a re-emit that
 *     changes nothing forces no persist (Q-M4-8); a fact the harness
 *     observed earlier and delivers later stamps its own instant
 *     (`observedAt`, Q-M4-14); an output chunk for a settled row is stale
 *     and dropped — the completion's result is the whole output (Q-M4-15).
 *   - The AI-message boundary (Q-S4-5; native's own rule, made correct by
 *     scoping): a tool row attaches to the scope's current AI message — the
 *     latest with text, the seed's last AI message over a seeded transcript
 *     (Q-M2-2) — and to a new empty one only when the scope has none.
 *   - A THINKING row per `runId` (Q-S4-6), a text message per `runId`; a
 *     new run closes the previous message's streaming flag, and a run's
 *     finish closes both its text and its thinking (Q-M4-6).
 *   - A sub-agent row per `subAgentId`, opened by `sub_agent_started`,
 *     closed COMPLETED/FAILED by `sub_agent_finished/failed` with its
 *     transcript's streaming flags cleared; a known id is never re-opened.
 *     CANCELLED is not this builder's: `shared/subagent-rows.ts`
 *     `cancelInProgressSubAgentProtos` is the one home of that transition.
 *   - `approval_proposed` is the one place a row is ever WAITING (Q-S4-20,
 *     Q-S4-3(e)): a known row REOPENS — WAITING, the outcome fields cleared,
 *     `approvalRequestedAt` stamped once, the proposal's args and preview
 *     taken when carried (Cursor's `markWaitingApproval` + `applyGateInput`;
 *     Q-M4-7); an unknown call gets a WAITING row on the scope's current AI message,
 *     the text that proposed it (native's post-stream seed, until C6 a new
 *     empty message of its own). Either way {@link awaitingApproval} is set.
 *   - `system_note` is a SYSTEM message in the scope, in the harness's
 *     voice; it hosts no rows and moves no boundary (Q-S4-18).
 *   - A completed `ToolKind.TODO` call in the ROOT scope is projected into
 *     `status.todos` through the shared `applyTodoUpdate`, a full replace
 *     unless the call's args say `merge: true` (Q-S4-7; the row stays — the
 *     clients filter it); a sub-agent's is not.
 *   - `finalize()` clears every streaming flag in every scope.
 *   - Artifacts upsert by `sandboxPath`/`contentHash`, write-backs by
 *     `workspaceEntryName` (Q-S4-8): the inline publisher and the write-back
 *     coordinator register theirs here.
 *   - {@link dirty} is set by every discrete change above and by nothing a
 *     token delta does; the adapter's loop reads it and clears it with
 *     {@link markPersisted} as it requests the persist (Q-S4-12).
 *
 * What this builder deliberately does NOT write, and who does (the adapter
 * contract's field ownership, `harness/types.ts` `TurnSink`): the phase,
 * `startedAt`, `streamingUsage` and the epilogue's plan artifact are the
 * turn runtime's (the plan artifact supersedes by its own name rule, which
 * is the plan's knowledge, not the transcript's). A row left
 * WAITING_APPROVAL is reported as the {@link awaitingApproval} fact and the
 * caller decides what that means for the turn — a fact only
 * `approval_proposed` produces once C6 lands, because a call that has
 * STARTED is never parked at creation (C3, option A). Usage never passes
 * through here (C1): the native loop reads it off the wire (`usageOf`) and
 * prices it into the sink, the Cursor loop reads its own from the SDK.
 */

import { create, type JsonObject } from "@bufbuild/protobuf";
import type { AgentExecutionStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import {
  AgentMessageSchema,
  ToolCallSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import type { AgentMessage, ToolCall } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { SubAgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/subagent_pb";
import type { ExecutionArtifact } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/artifact_pb";
import type { WorkspaceWriteBack } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/writeback_pb";
import {
  MessageType,
  SubAgentStatus,
  ToolCallStatus,
  ToolCallStreamingSource,
  ToolKind,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { POLICY_ENGINE_VERSION, toProtoPolicySource } from "../../shared/approval-policy.js";
import { SALIENT_ARG_FIELDS, buildElidedArgsPreview } from "../../shared/args-preview.js";
import { classifyTool } from "../../shared/tool-kind.js";
import { applyTodoUpdate } from "../../shared/todos.js";
import { utcTimestamp } from "../../shared/status.js";
import { TranscriptState, type Transcript, type TranscriptSeed } from "./state.js";
import type {
  ApprovalProposedEvent,
  SubAgentFailedEvent,
  SubAgentFinishedEvent,
  SubAgentStartedEvent,
  ToolStartedEvent,
  TranscriptEvent,
} from "./events.js";

export class TranscriptBuilder {
  readonly executionId: string;
  private readonly state: TranscriptState;
  private _dirty = false;
  private _awaitingApproval = false;

  /**
   * Builds INTO `status`, by reference: its `messages`, `subAgentExecutions`
   * and every sub-agent row's `messages` are the arrays indexed and pushed
   * into, never replaced, so a caller that wraps the same status (the
   * runtime's chokepoint, a settle amending rows by identity) keeps seeing
   * every row. Rows already on the status are indexed here; rows a
   * reinvocation carries over arrive later through {@link seed}, indexed by
   * the same routine, so a re-driven event reconciles onto them either way.
   */
  constructor(executionId: string, status: AgentExecutionStatus) {
    this.executionId = executionId;
    this.state = new TranscriptState(status);
  }

  /**
   * The status this builder builds into — the same object as
   * `TurnSink.status` when the runtime constructs the builder; a harness
   * reads rows there. Here for the builder's standalone uses (its tests,
   * the hermetic fold helpers), which hold no sink.
   */
  get status(): AgentExecutionStatus {
    return this.state.proto;
  }

  /**
   * Append a reinvocation's persisted transcript — messages, sub-agent
   * rows, artifacts, write-backs, todos — and index it, so the turn that
   * follows APPENDS onto prior history and a re-issued call reconciles onto
   * its seeded row instead of duplicating it. The runtime calls this once,
   * in its reinvocation phase, before any harness runs; the reasons every
   * collection is seeded are that phase's (`harness/turn-context.ts`
   * `seedFromPersistedStatus`). Seeded rows are last turn's facts: this sets
   * neither {@link dirty} nor {@link awaitingApproval}.
   */
  seed(persisted: TranscriptSeed): void {
    this.state.seed(persisted);
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

  /**
   * True once a discrete, user-visible change has landed since the last
   * persist — a row started or settled, a sub-agent opened or closed, an
   * artifact or write-back registered, a note appended; never a token
   * delta, which rides the streaming cadence. The one fact the adapter's
   * persist decision reads (`shared/persist-decision.ts`); the adapter
   * clears it with {@link markPersisted} as it requests the write, so a
   * change that lands after the write started dirties the next one.
   */
  get dirty(): boolean {
    return this._dirty;
  }

  markPersisted(): void {
    this._dirty = false;
  }

  /** Fold one canonical event into the transcript. Never throws: a handler's error is logged and the stream goes on. */
  apply(event: TranscriptEvent): void {
    try {
      switch (event.kind) {
        case "sub_agent_started":
          this.openSubAgent(event);
          return;
        case "sub_agent_finished":
          this.closeSubAgent(event);
          return;
        case "sub_agent_failed":
          this.failSubAgent(event);
          return;
        default:
          break;
      }

      const scope = this.state.scope(event.subAgentId);
      if (!scope) {
        throw new Error(`event for unknown sub-agent ${event.subAgentId}`);
      }

      switch (event.kind) {
        case "message_start":
          this.handleMessageStart(scope, event.runId);
          break;
        case "text_delta":
          this.appendTextContent(scope, event.runId, event.text);
          break;
        case "reasoning_delta":
          this.appendThinkingContent(scope, event.runId, event.text);
          break;
        case "message_finish":
          this.handleMessageFinish(scope, event.runId);
          break;
        case "tool_started":
          this.handleToolStarted(scope, event);
          break;
        case "tool_arg_delta":
          this.handleToolArgDelta(scope, event.callId, event.argsChunk);
          break;
        case "tool_output_delta":
          this.handleToolOutputDelta(scope, event.callId, event.delta);
          break;
        case "tool_finished":
          this.handleToolFinished(scope, event.callId, event.result, event.observedAt);
          break;
        case "tool_error":
          this.handleToolError(scope, event.callId, event.message, event.observedAt);
          break;
        case "approval_proposed":
          this.handleApprovalProposed(scope, event);
          break;
        case "system_note":
          this.appendSystemNote(scope, event.text);
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

  /**
   * Every streaming flag off, in every scope — messages and rows. What a
   * turn owes the transcript when its stream ends, however it ended: a
   * stopped turn's in-flight message must not persist as still streaming.
   * The sub-agent rows' own CANCELLED transition is the caller's, through
   * the shared `cancelInProgressSubAgentProtos`.
   */
  finalize(): void {
    for (const transcript of this.state.transcripts()) finalizeStreaming(transcript);
  }

  // ── Artifact & WriteBack ───────────────────────────────────────────

  addArtifact(artifact: ExecutionArtifact): void {
    const artifacts = this.state.proto.artifacts;
    const idx = artifacts.findIndex(a => a.sandboxPath === artifact.sandboxPath);

    if (idx >= 0) {
      if (artifacts[idx].contentHash !== artifact.contentHash) {
        artifacts[idx] = artifact;
        this._dirty = true;
      }
      return;
    }

    artifacts.push(artifact);
    this._dirty = true;
  }

  addWriteBack(wb: WorkspaceWriteBack): void {
    const backs = this.state.proto.workspaceWriteBacks;
    const idx = backs.findIndex(b => b.workspaceEntryName === wb.workspaceEntryName);

    if (idx >= 0) {
      backs[idx] = wb;
    } else {
      backs.push(wb);
    }
    this._dirty = true;
  }

  // ── Sub-Agent Rows ─────────────────────────────────────────────────

  private openSubAgent(event: SubAgentStartedEvent): void {
    // A seeded row re-announced by a replayed engine (the memory-checkpointer
    // re-drives the whole graph): the row and its transcript already exist.
    if (this.state.subAgent(event.subAgentId)) return;

    const row = create(SubAgentExecutionSchema, {
      id: event.subAgentId,
      name: event.name,
      subject: event.subject,
      input: event.input,
      status: SubAgentStatus.SUB_AGENT_IN_PROGRESS,
      startedAt: utcTimestamp(),
    });
    this.state.openSubAgent(row);
    this._dirty = true;
  }

  private closeSubAgent(event: SubAgentFinishedEvent): void {
    const scope = this.state.subAgent(event.subAgentId);
    if (!scope) return;
    scope.row.status = SubAgentStatus.SUB_AGENT_COMPLETED;
    scope.row.completedAt = utcTimestamp();
    if (event.output !== undefined) scope.row.output = event.output;
    finalizeStreaming(scope.transcript);
    this._dirty = true;
  }

  private failSubAgent(event: SubAgentFailedEvent): void {
    const scope = this.state.subAgent(event.subAgentId);
    if (!scope) return;
    scope.row.status = SubAgentStatus.SUB_AGENT_FAILED;
    scope.row.completedAt = utcTimestamp();
    scope.row.error = event.error;
    finalizeStreaming(scope.transcript);
    this._dirty = true;
  }

  // ── Message Handlers ───────────────────────────────────────────────

  private handleMessageStart(scope: Transcript, runId: string): void {
    // Record the run for the message boundary but do NOT create the AI
    // message yet: it is created lazily on the first text_delta, so a
    // THINKING row that streams first sits before the text it precedes.
    if (scope.lastRunId && scope.lastRunId !== runId && scope.currentAiMessage) {
      scope.currentAiMessage.isStreaming = false;
    }
    scope.lastRunId = runId;
  }

  private handleMessageFinish(scope: Transcript, runId: string): void {
    // A finished run's text AND its thinking are finished (S4 M4 B1, Q-M4-6;
    // Cursor closes both when a tool call ends the segment). Until B1 only the
    // text closed here and the THINKING row spun until `finalize()` — a live
    // spinner on a block the model had left, on both harnesses.
    const msg = scope.messagesByRun.get(runId);
    if (msg) {
      msg.isStreaming = false;
    }
    const thinking = scope.messagesByRun.get(thinkingKeyOf(runId));
    if (thinking) {
      thinking.isStreaming = false;
    }
  }

  private appendTextContent(scope: Transcript, runId: string, text: string): void {
    const msg = this.ensureAiMessage(scope, runId);
    msg.content += text;
    msg.isStreaming = true;
  }

  private appendThinkingContent(scope: Transcript, runId: string, text: string): void {
    // One THINKING row per run (Q-S4-6), keyed apart from the run's text so
    // the two never share a message.
    const thinkingKey = thinkingKeyOf(runId);
    const existingMsg = scope.messagesByRun.get(thinkingKey);
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
    scope.messages.push(msg);
    scope.messagesByRun.set(thinkingKey, msg);
  }

  // ── Tool Handlers ──────────────────────────────────────────────────

  private handleToolStarted(scope: Transcript, event: ToolStartedEvent): void {
    const { callId, name, input } = event;
    // A re-emitted start reconciles onto the existing row — never a duplicate,
    // never a second gate. Keyed by the provider's tool_call_id, so this is an
    // exact match (no name heuristics). Two shapes reach here: the durable
    // checkpoint re-emitting a seeded WAITING call now that approval is granted
    // (native's resume; the runtime's `seedFromPersistedStatus`), and a
    // recovery replaying a call the server had marked INTERRUPTED when the
    // execution terminalized with it in flight (the enum's supersede rule; the
    // Cursor accumulator's merge). Either way an UNSETTLED row becomes RUNNING
    // (S4 M4 B1, Q-M4-8 — until B1 only WAITING flipped); a settled one keeps
    // its outcome. Args it lacked are filled and previewed, once.
    const existing = scope.toolCalls.get(callId);
    if (existing) {
      if (!isSettled(existing.status)) {
        existing.status = ToolCallStatus.TOOL_CALL_RUNNING;
      }
      if (Object.keys(input).length > 0) {
        if (!existing.args) existing.args = input as JsonObject;
        if (!existing.argsPreview) stampArgsPreview(existing, input);
      }
      this._dirty = true;
      return;
    }

    // The message boundary (Q-S4-5): the row joins the message whose text
    // proposed it — the scope's current AI message — and gets an empty one
    // only when the scope has no message yet.
    const parentMsg = scope.currentAiMessage ?? this.ensureAiMessageForToolCall(scope);

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
      stampArgsPreview(tc, input);
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
    scope.toolCalls.set(callId, tc);

    this._dirty = true;
  }

  private handleToolFinished(scope: Transcript, callId: string, result: string, observedAt?: string): void {
    const tc = scope.toolCalls.get(callId);
    if (!tc) return;

    // An UPSERT, not an overwrite (Q-S4-3(c); Cursor's `mergeToolCallEvent`):
    // the status advances monotonically — a settled row never regresses;
    // `completedAt` is stamped once; only a non-empty result overwrites, so a
    // completion that carries none never wipes the output an earlier one
    // did. Two completions per call is the Cursor shape after stigmer#1053
    // (the SDK's timing delta precedes the stream's completion); on native
    // there is one, and the rules read as the plain write they replace.
    //
    // Store the faithful result; bounding the gRPC payload is owned solely by
    // the persist chokepoint (offload + enforce in status.ts/status-offload.ts).
    // Truncating here would corrupt binary content (e.g. a screenshot's base64)
    // before offload can lift it into a renderable ToolCallOutputRef.
    //
    // A completion that changes nothing — a settled row re-completed with no
    // new result — forces no persist (S4 M4 B1, Q-M4-8; Cursor's "a redundant
    // terminal re-emit is noise, not a state change"). On Cursor every call
    // completes twice (the delta, then the stream), and the second carries the
    // result, so the flush the UI needs still happens exactly once.
    const wasSettled = isSettled(tc.status);
    const resultChanged = !!result && result !== tc.result;
    if (!wasSettled) tc.status = ToolCallStatus.TOOL_CALL_COMPLETED;
    // The instant the harness OBSERVED the completion when it delivers it
    // later (Cursor's queued delta, Q-M4-14); otherwise now.
    if (!tc.completedAt) tc.completedAt = observedAt ?? utcTimestamp();
    if (resultChanged) tc.result = result;
    stopStreaming(tc);
    scope.argBuffers.delete(callId);
    if (wasSettled && !resultChanged) return;

    // Project a completed to-do write into status.todos. deepagents' write_todos
    // runs its state-mutating Command when the tool node COMPLETES, so we mirror
    // it here (not at tool-start) — a call cancelled before finishing correctly
    // projects nothing. Keyed on the harness-agnostic ToolKind.TODO (stamped at
    // tool-start) and fed by the same shared mapper every harness uses; the
    // call's own `merge` flag decides replace-or-merge (Cursor's `updateTodos`
    // sets it; deepagents never does, so native stays a full replace —
    // Q-S4-7); a sub-agent's list is its own, never the execution's. The tool
    // call itself stays in messages (the client filters ToolKind.TODO from the
    // thread).
    if (scope === this.state.root && tc.toolKind === ToolKind.TODO) {
      applyTodoUpdate(this.state.proto.todos, tc.args?.todos, { merge: tc.args?.merge === true });
    }

    this._dirty = true;
  }

  private handleToolError(scope: Transcript, callId: string, message: string, observedAt?: string): void {
    const tc = scope.toolCalls.get(callId);
    if (!tc) return;

    // The same upsert as a finish (Q-S4-3(c)). A gated row that fails is the
    // Cursor boundary's shape — the hook denied the call and the stream
    // reports `error`; the boundary parks it after the stream — so the
    // moment approval became due is stamped here if nothing stamped it yet.
    const wasSettled = isSettled(tc.status);
    const messageChanged = !!message && message !== tc.error;
    const at = observedAt ?? utcTimestamp();
    if (!wasSettled) tc.status = ToolCallStatus.TOOL_CALL_FAILED;
    if (!tc.completedAt) tc.completedAt = at;
    if (messageChanged) tc.error = message;
    if (tc.requiresApproval && !tc.approvalRequestedAt) tc.approvalRequestedAt = at;
    stopStreaming(tc);
    scope.argBuffers.delete(callId);

    // The same no-change rule as a finish (Q-M4-8).
    if (wasSettled && !messageChanged) return;
    this._dirty = true;
  }

  private handleToolArgDelta(scope: Transcript, callId: string, argsChunk: string): void {
    const tc = scope.toolCalls.get(callId);
    if (!tc) return;

    const buffer = (scope.argBuffers.get(callId) ?? "") + argsChunk;
    scope.argBuffers.set(callId, buffer);

    try {
      tc.args = JSON.parse(buffer) as JsonObject;
    } catch {
      // Partial JSON — will parse on next chunk or tool-finished
    }
  }

  private handleToolOutputDelta(scope: Transcript, callId: string, delta: string): void {
    const tc = scope.toolCalls.get(callId);
    if (!tc) return;
    // A chunk for a row that has already settled is stale: the completion's
    // result IS the whole output, and appending would double it (S4 M4 B4,
    // Q-M4-15 — Cursor's delta channel and stream can deliver the output's
    // chunks and the completion in one loop window, completion first).
    if (isSettled(tc.status)) return;
    // Output arriving live: the row streams its OUTPUT (Q-S4-3(d); Cursor's
    // enricher), so the client can show the partial result as it grows;
    // the finish, or `finalize()`, closes it.
    tc.result = (tc.result ?? "") + delta;
    tc.isStreaming = true;
    tc.streamingSource = ToolCallStreamingSource.OUTPUT;
  }

  // ── Post-Stream Facts ──────────────────────────────────────────────

  private handleApprovalProposed(scope: Transcript, event: ApprovalProposedEvent): void {
    const now = utcTimestamp();
    const existing = scope.toolCalls.get(event.callId);
    if (existing) {
      // Reopen (Cursor's `markWaitingApproval`): the boundary is re-proposing
      // a call the stream already showed — an errored built-in the hook
      // denied — so the outcome the stream wrote is not the outcome.
      existing.status = ToolCallStatus.TOOL_CALL_WAITING_APPROVAL;
      existing.requiresApproval = true;
      existing.approvalMessage = event.message;
      if (!existing.approvalRequestedAt) existing.approvalRequestedAt = now;
      existing.completedAt = "";
      existing.error = "";
      existing.result = "";
      // The proposal's args are the authoritative proposed change when the
      // harness carries them (Cursor's `applyGateInput`: the hook's captured
      // input outranks what the stream carried before the first-denial cancel),
      // and they re-derive the preview (S4 M4 B1, Q-M4-7). Absent, the row
      // keeps what it had.
      if (event.args && Object.keys(event.args).length > 0) {
        existing.args = event.args as JsonObject;
        stampArgsPreview(existing, event.args);
      }
      if (event.contentDigest) existing.approvalContentDigest = event.contentDigest;
      stopStreaming(existing);
      this._awaitingApproval = true;
      this._dirty = true;
      return;
    }

    // A call the stream never showed (native: the engine interrupted before
    // the tool started). Its row lands on the text that proposed it, like
    // any other row (Q-S4-20 — until C6 the seed pushed a new empty message).
    const parentMsg = scope.currentAiMessage ?? this.ensureAiMessageForToolCall(scope);
    const tc = create(ToolCallSchema, {
      id: event.callId,
      name: event.name,
      status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
      requiresApproval: true,
      approvalMessage: event.message,
      approvalRequestedAt: now,
      startedAt: now,
    });
    if (event.mcpServerSlug) tc.mcpServerSlug = event.mcpServerSlug;
    tc.toolKind = classifyTool(tc.name, tc.mcpServerSlug);
    if (event.provenance !== undefined) {
      tc.approvalPolicySource = toProtoPolicySource(event.provenance);
      tc.policyEngineVersion = POLICY_ENGINE_VERSION;
    }
    if (event.args && Object.keys(event.args).length > 0) {
      tc.args = event.args as JsonObject;
      stampArgsPreview(tc, event.args);
    }
    if (event.contentDigest) tc.approvalContentDigest = event.contentDigest;

    parentMsg.toolCalls.push(tc);
    scope.toolCalls.set(event.callId, tc);
    this._awaitingApproval = true;
    this._dirty = true;
  }

  private appendSystemNote(scope: Transcript, text: string): void {
    scope.messages.push(create(AgentMessageSchema, {
      type: MessageType.MESSAGE_SYSTEM,
      content: text,
      timestamp: utcTimestamp(),
    }));
    this._dirty = true;
  }

  // ── Content Helpers ───────────────────────────────────────────────

  /** The AI message a run's text streams into, created on its first token; a new run closes the previous message's flag. */
  private ensureAiMessage(scope: Transcript, runId: string): AgentMessage {
    const existingByRun = scope.messagesByRun.get(runId);
    if (existingByRun) return existingByRun;

    if (scope.lastRunId && scope.lastRunId !== runId && scope.currentAiMessage) {
      scope.currentAiMessage.isStreaming = false;
    }

    const msg = create(AgentMessageSchema, {
      type: MessageType.MESSAGE_AI,
      content: "",
      timestamp: utcTimestamp(),
      isStreaming: true,
    });

    scope.messages.push(msg);
    scope.messagesByRun.set(runId, msg);
    scope.currentAiMessage = msg;
    scope.lastRunId = runId;

    return msg;
  }

  /** The message a tool row lands on when the scope has no AI message yet: the latest run's, else a new empty one. */
  private ensureAiMessageForToolCall(scope: Transcript): AgentMessage {
    if (scope.lastRunId) {
      const existing = scope.messagesByRun.get(scope.lastRunId);
      if (existing) {
        scope.currentAiMessage = existing;
        return existing;
      }
    }

    const msg = create(AgentMessageSchema, {
      type: MessageType.MESSAGE_AI,
      content: "",
      timestamp: utcTimestamp(),
      isStreaming: false,
    });

    scope.messages.push(msg);
    scope.currentAiMessage = msg;

    return msg;
  }
}

/** The `messagesByRun` key of a run's THINKING row — apart from the run's text, so the two never share a message. */
function thinkingKeyOf(runId: string): string {
  return `thinking:${runId}`;
}

/** Every streaming flag off in one transcript — messages and rows. */
function finalizeStreaming(transcript: Transcript): void {
  for (const message of transcript.messages) {
    message.isStreaming = false;
    for (const tc of message.toolCalls) stopStreaming(tc);
  }
}

/**
 * The row's `args_preview`, on EVERY row with args (Q-S4-16; S4 M2 C7):
 * `message.proto` promises it sanitized, redacted, at creation, for inline
 * visibility, and the one builder that keeps it small and always valid JSON
 * is `buildElidedArgsPreview` over the platform's salient fields. Until C7
 * native stamped a whole-string-truncating preview on gated rows only and
 * Cursor stamped `JSON.stringify(args)` unredacted. An empty preview (a
 * cycle in the args) leaves the field unset rather than failing the row.
 */
function stampArgsPreview(tc: ToolCall, args: Record<string, unknown>): void {
  const preview = buildElidedArgsPreview(args, SALIENT_ARG_FIELDS);
  if (preview) tc.argsPreview = preview;
}

/** A row no longer streaming: the flag off and the source cleared, so a stale OUTPUT marker never outlives the stream. */
function stopStreaming(tc: ToolCall): void {
  if (!tc.isStreaming) return;
  tc.isStreaming = false;
  tc.streamingSource = ToolCallStreamingSource.UNSPECIFIED;
}

/**
 * A row that has finished, however it finished — the statuses a later event
 * must not move backwards (Cursor's `isTerminalToolStatus`). INTERRUPTED is
 * deliberately NOT here: it is server-authored when an execution
 * terminalized with the call in flight, and a recovery-replayed event must
 * be able to advance the row to its true outcome (the enum's recovery
 * supersede rule; `shared/tool-row.ts` explains the two sets).
 */
function isSettled(status: ToolCallStatus): boolean {
  return (
    status === ToolCallStatus.TOOL_CALL_COMPLETED ||
    status === ToolCallStatus.TOOL_CALL_FAILED ||
    status === ToolCallStatus.TOOL_CALL_SKIPPED
  );
}
