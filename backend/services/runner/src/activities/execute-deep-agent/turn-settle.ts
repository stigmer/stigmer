/**
 * The native deep-agent harness's settle — from a consumed stream to a
 * `TurnOutcome`.
 *
 * In order: drain the inline publishes the stream fired and, on a finished
 * turn, run the auto-publish safety net; settle the gate's unattended skips
 * (the one settlement whose evidence exists only inside this harness); on
 * the runtime's stop, mark in-flight sub-agent rows through the shared act
 * and settle `interrupted` with nothing further; the capture boundary
 * (adapter-side until M4) that authors this turn's change set and stamps
 * the flowed rows; the graph's `structuredResponse` folded onto the status;
 * the interrupts a completed stream left pending seeded as WAITING rows;
 * and the outcome.
 *
 * What this module never does: write a phase, a terminal copy or
 * `completedAt` — those are the runtime's (`harness/run-turn.ts`,
 * `terminal-table.ts`); settle SKIP and REJECT rows — the runtime's
 * (`harness/approval-decisions.ts`, after every outcome); withhold secret
 * content — the runtime's chokepoint does it on every write; finalize the
 * write-back — the runtime's epilogue. It does mutate `sink.status`'s
 * transcript rows and ledger events, which are this harness's to write.
 *
 * Two outcomes end the turn awaiting approval and the runtime tells them
 * apart from the rows: a tool gate (WAITING_APPROVAL rows exist) and a file
 * review with nothing gated (a CANDIDATE was authored). A pure file-review
 * resume then completes in the runtime's reconcile without re-running the
 * engine, from the status persisted here — which is why the structured
 * response is folded BEFORE the outcome is decided. The text fallback for
 * structured output is the runtime's completion epilogue and does not run
 * on a file-review-pending turn (Cursor's posture; F-M2a-6, Q-M2a-5,
 * recorded for M4).
 *
 * Moved from `index.ts` (post-stream through the terminal arms) at S3 M2a;
 * the bodies are the orchestrator's, with the runtime's arms taken out.
 */

import { create, type JsonObject } from "@bufbuild/protobuf";
import { AgentMessageSchema, ToolCallSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { FileCaptureClass, MessageType, ToolCallStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

import type { TurnInput, TurnOutcome, TurnSink } from "../../harness/types.js";
import { POLICY_ENGINE_VERSION, toProtoPolicySource } from "../../shared/approval-policy.js";
import { captureCandidateToLedger } from "../../shared/filereview/capture.js";
import { hasCandidateCaptured } from "../../shared/filereview/events.js";
import { utcTimestamp } from "../../shared/status.js";
import { cancelInProgressSubAgentProtos } from "../../shared/subagent-rows.js";
import { classifyTool } from "../../shared/tool-kind.js";
import { captureApprovalArtifacts } from "./approval-file-change.js";
import { autoPublishWrittenFiles } from "./auto-publish.js";
import { buildCasTurnCaptures } from "./cas-capture-observer.js";
import { deriveTurnCommandProvenance } from "./command-provenance.js";
import { DEEP_AGENT_HARNESS_ID } from "./deep-agent-capabilities.js";
import { detectPendingInterrupts, reconcileUnattendedSkips, type GraphStateSnapshot } from "./hitl.js";
import { stampFlowedFileEditRows, stampFlowedSubAgentFileEditRows } from "./stamp-flowed-rows.js";
import type { DeepAgentCapture, DeepAgentEngine, DeepAgentWorkspace } from "./turn-setup.js";
import type { DeepAgentStreamResult, DeepAgentTranscript } from "./turn-stream.js";

export interface DeepAgentSettleDeps {
  readonly input: TurnInput;
  readonly sink: TurnSink;
  readonly engine: DeepAgentEngine;
  readonly workspace: DeepAgentWorkspace;
  readonly capture: DeepAgentCapture;
  readonly transcript: DeepAgentTranscript;
  readonly stream: DeepAgentStreamResult;
}

export async function settleDeepAgentTurn(deps: DeepAgentSettleDeps): Promise<TurnOutcome> {
  const { input, sink, engine, workspace, capture, transcript, stream } = deps;
  const { executionId } = input;
  const { status } = sink;

  // Drain the publishes the stream fired (fire-and-forget completions); the
  // safety net that scans tool calls for files the stream missed runs only
  // on a finished turn, as it always did.
  if (stream.pendingPublishPromises.length > 0) {
    await Promise.allSettled(stream.pendingPublishPromises);
  }
  if (stream.reason === "completed") {
    try {
      await autoPublishWrittenFiles(status, transcript.publisher);
    } catch (err) {
      console.warn(`[turn-settle] execution=${executionId} — auto-publish safety net error: ${err}`);
    }
  }
  sink.recordActivity();

  // Terminalize every tool call the gate auto-skipped under UNATTENDED
  // approval mode (DD-014): the skip has no human decision behind it, so the
  // runtime's terminalizer cannot see it; the gate's registry is this
  // harness's evidence.
  reconcileUnattendedSkips(status, engine.gate.unattendedSkips);

  if (stream.reason === "interrupted") {
    // A stopped turn aborted the graph run, so any sub-agent the parent had
    // delegated is no longer executing: CANCELLED through the one shared act
    // (the runtime marks them itself only on its thrown arms), its messages'
    // streaming flags cleared. There is no review to open.
    cancelInProgressSubAgentProtos(status.subAgentExecutions);
    transcript.builder.finalizeSubAgentStreaming();
    return { kind: "interrupted" };
  }

  const fileReviewPending = await captureTurnBoundary(deps);

  // The graph's structured response, when the run surfaced one: folded now,
  // so a turn that pauses for review persists it and the pure file-review
  // resume completes with it (the runtime's epilogue extracts from the final
  // text only when nothing is folded).
  if (engine.hasStructuredOutput) {
    const sr = stream.runOutput?.structuredResponse;
    if (sr != null && typeof sr === "object" && !Array.isArray(sr)) {
      status.structuredOutput = sr as JsonObject;
    } else if (sr !== undefined) {
      console.warn(`[turn-settle] structuredResponse is not a plain object for execution ${executionId}: type=${typeof sr}`);
    }
  }

  if (stream.reason === "awaiting_approval") {
    return { kind: "awaiting_approval" };
  }

  // A completed stream can still leave the graph interrupted at a gate whose
  // tool start produced no row (the durable savers resume without a
  // tool_started; the replay path never re-drives it): read the checkpoint
  // once more and seed a WAITING row per pending interrupt. Skipped under
  // the global bypass, where no gate is installed.
  if (!engine.gate.globalBypass && (await seedPendingInterrupts(deps))) {
    return { kind: "awaiting_approval" };
  }

  if (fileReviewPending) {
    console.log(`[turn-settle] execution=${executionId} — file edits flowed this turn; awaiting file review`);
    return { kind: "awaiting_approval" };
  }

  return { kind: "completed" };
}

/**
 * Turn boundary (capture mode): capture the candidate change set — the
 * git diff against the pinned baseline composed with the CAS-observed paths
 * (before-bytes from the observer, after-bytes re-read from disk) and the
 * secret-blocked paths — author CANDIDATE_CAPTURED, then stamp the flowed
 * file-edit rows with the change set id so they stay visible in place as
 * observational records while `file_change_sets` remains the single
 * decision surface. Review is pending iff a CANDIDATE was actually authored
 * (the seam drops no-op captures), and stamping is gated on the same
 * signal: a row must never reference a change set that does not exist.
 *
 * Approved-command turn facts (DD-28): when every mutation-capable call this
 * turn was a consented shell command, the provenance is attached so the
 * backend can verify the cited consent rows and auto-keep the set instead of
 * arming a second review gate. Fail-closed: any non-qualifying turn attaches
 * nothing and reviews manually.
 */
async function captureTurnBoundary(deps: DeepAgentSettleDeps): Promise<boolean> {
  const { input, sink, engine, workspace, capture } = deps;
  const { executionId } = input;
  const { primaryDir, gitWorkspace, captureMode, changeSetId } = input.workspace;
  const { status } = sink;
  if (!captureMode) return false;

  const casCaptureClass = gitWorkspace ? FileCaptureClass.GIT_IGNORED_CAPTURED : FileCaptureClass.NON_GIT_CAS;
  const { casCaptures, unreviewablePaths } = await buildCasTurnCaptures(workspace.casObserver, primaryDir, casCaptureClass);
  const commandProvenance = deriveTurnCommandProvenance({
    status,
    priorSettledToolCallIds: capture.priorSettledToolCallIds,
    priorSubAgentToolCallIds: capture.priorSubAgentToolCallIds,
    globalBypass: engine.gate.globalBypass,
  });
  if (commandProvenance) {
    console.log(
      `[turn-settle] capture: turn qualifies for approved-command auto-keep ` +
      `(consent rows: ${commandProvenance.consentToolCallIds.join(",") || "(auto_approve_all)"}); ` +
      `attaching provenance to candidate (execution=${executionId})`,
    );
  }
  await captureCandidateToLedger({
    status,
    gitRoot: primaryDir,
    executionId,
    changeSetId,
    baselineTree: capture.baselineTree,
    harnessId: DEEP_AGENT_HARNESS_ID,
    casCaptures,
    storage: input.artifactStorage,
    unreviewablePaths,
    unreviewableCaptureClass: casCaptureClass,
    gitWorkspace,
    commandProvenance,
  });
  sink.recordActivity();

  const pending = hasCandidateCaptured(status, changeSetId);
  if (pending) {
    stampFlowedFileEditRows(status.messages, changeSetId);
    stampFlowedSubAgentFileEditRows(status.subAgentExecutions, changeSetId, capture.priorSubAgentToolCallIds);
  }
  return pending;
}

/**
 * Seed one WAITING_APPROVAL row per interrupt the graph left pending, on one
 * AI message, with the sanitized args preview AND the redacted args read
 * from the AI message in graph state (the single source of truth for the
 * proposed call; issue #754: a placeholder without args rendered a pathless
 * header). Returns whether any was seeded.
 */
async function seedPendingInterrupts(deps: DeepAgentSettleDeps): Promise<boolean> {
  const { input, sink, engine } = deps;
  const graphState: GraphStateSnapshot = await engine.graph.getState(engine.langgraphConfig);
  const pending = detectPendingInterrupts(graphState);
  if (pending.length === 0) return false;

  const graphMessages = (graphState.values as { messages?: unknown }).messages;
  const aiMessages = Array.isArray(graphMessages) ? graphMessages : [];
  console.log(`[turn-settle] Detected ${pending.length} pending interrupt(s) for execution ${input.executionId} — awaiting approval`);

  const aiMsg = create(AgentMessageSchema, {
    type: MessageType.MESSAGE_AI,
    content: "",
    timestamp: utcTimestamp(),
    isStreaming: false,
  });
  for (const intr of pending) {
    const toolCall = create(ToolCallSchema, {
      id: intr.toolCallId,
      name: intr.toolName,
      status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
      requiresApproval: true,
      approvalMessage: intr.message,
      approvalRequestedAt: utcTimestamp(),
      mcpServerSlug: intr.mcpServerSlug,
      startedAt: utcTimestamp(),
      toolKind: classifyTool(intr.toolName, intr.mcpServerSlug),
      approvalPolicySource: toProtoPolicySource(intr.policySource),
      policyEngineVersion: intr.policySource ? POLICY_ENGINE_VERSION : "",
    });
    const { argsPreview, args } = captureApprovalArtifacts({ toolCallId: intr.toolCallId, messages: aiMessages });
    if (argsPreview) toolCall.argsPreview = argsPreview;
    if (args) toolCall.args = args as typeof toolCall.args;
    aiMsg.toolCalls.push(toolCall);
  }
  sink.status.messages.push(aiMsg);
  return true;
}
