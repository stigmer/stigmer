/**
 * The native deep-agent harness's settle — from a consumed stream to a
 * `TurnOutcome`.
 *
 * In order: drain the inline publishes the stream fired and, on a finished
 * turn, run the auto-publish safety net; settle the gate's unattended skips
 * (the one settlement whose evidence exists only inside this harness); on
 * the runtime's stop, mark in-flight sub-agent rows through the shared act
 * and settle `interrupted` with nothing further; the graph's
 * `structuredResponse` folded onto the status; the interrupts a completed
 * stream left pending proposed through the builder as WAITING rows; and the
 * outcome.
 *
 * What this module never does: write a phase, a terminal copy or
 * `completedAt` — those are the runtime's (`harness/run-turn.ts`,
 * `terminal-table.ts`); close the transcript's streaming flags — the
 * runtime's, once `runTurn` returns, on every path (since #1097; until then this
 * settle finalized the builder itself, and a turn that threw before
 * reaching it left its last message streaming); settle SKIP and REJECT rows — the runtime's
 * (`harness/approval-decisions.ts`, after every outcome); withhold secret
 * content — the runtime's chokepoint does it on every write; finalize the
 * write-back — the runtime's epilogue; capture the turn's file changes or
 * decide whether a review is pending — the runtime's (`harness/capture.ts`,
 * once, over whatever the whole turn left on the tree, after this settle
 * returns; since #1096). Transcript rows it CREATES go through the builder
 * (`approval_proposed`, since #1097); the one row it AMENDS by identity is the
 * gate's unattended skip (`reconcileUnattendedSkips`), whose evidence exists
 * only inside this harness.
 *
 * The structured response is folded BEFORE the outcome is decided, so a turn
 * the runtime then pauses for file review persists it and the pure
 * file-review resume completes with it (the runtime's text fallback runs on
 * the review-pending path too).
 *
 * Moved from `index.ts` (post-stream through the terminal arms) in #1096,
 * where the capture boundary also left for the runtime.
 */

import type { JsonObject } from "@bufbuild/protobuf";

import type { TurnInput, TurnOutcome, TurnSink } from "../../harness/types.js";
import { cancelInProgressSubAgentProtos } from "../../shared/subagent-rows.js";
import { captureApprovalArtifacts } from "./approval-file-change.js";
import { autoPublishWrittenFiles } from "./auto-publish.js";
import { detectPendingInterrupts, reconcileUnattendedSkips, type GraphStateSnapshot } from "./hitl.js";
import type { DeepAgentEngine } from "./turn-setup.js";
import type { DeepAgentStreamResult, DeepAgentTranscript } from "./turn-stream.js";

export interface DeepAgentSettleDeps {
  readonly input: TurnInput;
  readonly sink: TurnSink;
  readonly engine: DeepAgentEngine;
  readonly transcript: DeepAgentTranscript;
  readonly stream: DeepAgentStreamResult;
}

export async function settleDeepAgentTurn(deps: DeepAgentSettleDeps): Promise<TurnOutcome> {
  const { input, sink, engine, transcript, stream } = deps;
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
    // (the runtime marks them itself only on its thrown arms). There is no
    // review to open.
    cancelInProgressSubAgentProtos(status.subAgentExecutions);
    return { kind: "interrupted" };
  }

  // The graph's structured response, when the run surfaced one: folded now,
  // so a turn the runtime pauses for review persists it and the pure
  // file-review resume completes with it.
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

  return { kind: "completed" };
}

/**
 * Propose, through the builder, one approval per interrupt the graph left
 * pending — the gate's hold reaching the transcript as `approval_proposed`
 * (since #1097). LangGraph's `interrupt()` ran before the tool
 * handler, so the stream showed no row for the call; the builder creates
 * the WAITING row on the message whose text proposed it, with the redacted
 * args read from the AI message in graph state (the single source of truth
 * for the proposed call; issue #754: a placeholder without args rendered a
 * pathless header). Until #1097 this settle built the message and the rows
 * itself, on a new empty AI message of its own, with no by-id check against
 * rows the stream had created (the upsert closes it).
 * Returns whether any was proposed.
 */
async function seedPendingInterrupts(deps: DeepAgentSettleDeps): Promise<boolean> {
  const { input, sink, engine } = deps;
  const graphState: GraphStateSnapshot = await engine.graph.getState(engine.langgraphConfig);
  const pending = detectPendingInterrupts(graphState);
  if (pending.length === 0) return false;

  const graphMessages = (graphState.values as { messages?: unknown }).messages;
  const aiMessages = Array.isArray(graphMessages) ? graphMessages : [];
  console.log(`[turn-settle] Detected ${pending.length} pending interrupt(s) for execution ${input.executionId} — awaiting approval`);

  for (const intr of pending) {
    const { args } = captureApprovalArtifacts({ toolCallId: intr.toolCallId, messages: aiMessages });
    sink.transcript.apply({
      kind: "approval_proposed",
      callId: intr.toolCallId,
      name: intr.toolName,
      mcpServerSlug: intr.mcpServerSlug,
      message: intr.message,
      ...(args ? { args } : {}),
      ...(intr.policySource ? { provenance: intr.policySource } : {}),
    });
  }
  return sink.transcript.awaitingApproval;
}
