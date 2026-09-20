/**
 * The Cursor harness's settle — from a consumed stream to a `TurnOutcome`.
 *
 * In order: the post-stream finalize (the last queued deltas drained, the
 * transcript's streaming flags closed, a stopped turn's sub-agents cancelled,
 * the recorder flush, one persist so the UI sees settled rows); the runtime's
 * stop, if it fired, settled as
 * `interrupted` with nothing further; the turn boundary (`turn-boundary.ts`)
 * that overlays the hook's denials as WAITING rows, ending `awaiting_approval`
 * when a denial pauses or failing on an unattributed hook block (#205);
 * `run.wait()` and the
 * classifier; the two recovery spines (a poisoned resumed handle, a
 * transport timeout on a created agent), each running the IDENTICAL stream,
 * finalize and boundary against a fresh agent at most once; the collapse of
 * redundant same-identity tool-call twins; and the outcome.
 *
 * What this module never does: write a phase, a terminal copy or
 * `completedAt` — those are the runtime's (`harness/run-turn.ts`,
 * `terminal-table.ts`); capture the turn's file changes or decide whether a
 * review is pending — the runtime's too (`harness/capture.ts`, once over the
 * whole turn after this settle returns, so a recovery's edits reach review
 * without the boundary being re-entered for them; since #1096). The outcome carries
 * what the runtime cannot read from the status (`failed`'s message and
 * surface, `cancelled`). The transcript's rows are CREATED through the shared
 * `TranscriptBuilder` (#1097: this harness's translator emits, the builder
 * folds; until then the accumulator, the enricher and the todo tracker wrote
 * them here); the boundary AMENDS rows it owns by identity and proposes its
 * gate through the same builder.
 *
 * Moved from `index.ts` `executeCursorInner` phases 11 to 13 in #1070; the
 * bodies are the orchestrator's, with the runtime's arms taken out.
 */

import { create } from "@bufbuild/protobuf";
import type { Run } from "@cursor/sdk";
import type { ConversationTurn } from "@cursor/sdk";
import { StreamingUsageSummarySchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/usage_pb";

import type { TurnInput, TurnOutcome, TurnSink } from "../../harness/types.js";
import { TimingRecorder, emitTimingLog } from "../../shared/cold-start-timing.js";
import { StreamingUpdateScheduler, loadStreamingConfig } from "../../shared/streaming-scheduler.js";
import { cancelInProgressSubAgentProtos } from "../../shared/subagent-rows.js";
import { createCursorEventRecorder } from "./cursor-event-recorder.js";
import {
  extractRunErrorSources,
  formatClassifiedError,
  shouldRetryWithFreshAgent,
  synthesizeError,
} from "./error-classifier.js";
import { closeProxySessions } from "./http2-interceptor.js";
import { collapseRedundantToolCallTwins } from "./boundary-rows.js";
import { clearCapturedRejection, getCapturedRejection } from "./rejection-capture.js";
import { CursorTranslator } from "./translator.js";
import { runTurnBoundary, type TurnBoundaryResult } from "./turn-boundary.js";
import {
  consumeCursorTurnStream,
  makeCursorTurnOnDelta,
  type CursorTurnStreamDeps,
  type TurnOnDeltaDeps,
  type TurnStreamState,
} from "./turn-stream.js";
import type { AdjudicatedRows, CursorEngine, CursorGate, CursorPrompt, CursorAdapterConfig } from "./turn-setup.js";
import { createFreshAgent } from "./turn-setup.js";

/** Everything the settle reads that setup produced. */
export interface CursorTurnFrame {
  readonly input: TurnInput;
  readonly sink: TurnSink;
  readonly config: CursorAdapterConfig;
  readonly engine: CursorEngine;
  readonly gate: CursorGate;
  readonly prompt: CursorPrompt;
  readonly rows: AdjudicatedRows;
  readonly streamState: TurnStreamState;
}

/**
 * Send the primary prompt, consume the stream, and settle. The one entry the
 * adapter calls after setup; every collaborator the stream loop needs is
 * built here, once, and shared with both recovery spines.
 */
export async function streamAndSettle(frame: CursorTurnFrame): Promise<TurnOutcome> {
  const { input, sink, config, engine, gate, prompt, rows, streamState } = frame;
  const { executionId, sessionId, blueprint, workspace, mcp } = input;
  const { status } = sink;

  // The runtime's one transcript builder over the turn's status, and this
  // harness's translator over the run's approval posture and the seeded
  // transcript (a resumed agent's re-issued call is matched onto its seeded
  // WAITING row by identity). Both live for the whole turn — the
  // primary stream and both recovery retries fold into them.
  const transcript = sink.transcript;
  const translator = new CursorTranslator({
    policies: mcp.policies,
    leases: { global: mcp.leases.global, categories: mcp.leases.categories },
    seeded: status.messages,
  });
  // The raw recording of both SDK channels, on only when the env names a dir
  // (the recorder reads no process state itself, so its tests need no env).
  const eventRecorder = createCursorEventRecorder(executionId, process.env.CURSOR_EVENT_RECORD_DIR);

  // The two recovery retries (poisoned-handle / transport-timeout) below run at
  // most once per turn; this guard is the latch.
  let alreadyRetriedWithFreshAgent = false;

  // The shared onDelta needs the sink/pricer/translator/recorder/state subset
  // and is wired at SEND time. The primary send and both retry sends reuse this object.
  const onDeltaDeps: TurnOnDeltaDeps = {
    sink,
    usagePricer: engine.usagePricer,
    translator,
    eventRecorder,
    promptEstimatedTokens: prompt.promptEstimatedTokens,
    executionId,
    state: streamState,
  };

  // Issue #209 forensics: the SDK acquires the local executor — the piece
  // that actually spawns stdio MCP servers — inside send(), AFTER the
  // execution_setup timeline has already been emitted. This one-shot
  // timeline makes that previously invisible window measurable:
  // `send_returned` covers the send() call itself, `first_delta` the wait
  // until the SDK's first delta. Primary send only — the recovery retries
  // below rebuild the agent and would skew the user-perceived turn start
  // this measures. No delta (immediate pause/failure) → no line. This line is
  // the SDK's send window and nothing else: the cross-harness instants (first
  // visible token, rounds, tool spans) are the runtime's `turn_phases` line
  // (`harness/turn-timeline.ts`), written for every harness alike.
  const turnStartTiming = new TimingRecorder();
  let turnFirstEventEmitted = false;
  const primaryOnDelta = makeCursorTurnOnDelta(onDeltaDeps);

  const run = await engine.resolution.agent.send(prompt.toSendMessage(prompt.effectivePrompt, prompt.primarySendImages), {
    onDelta: (event) => {
      if (!turnFirstEventEmitted) {
        turnFirstEventEmitted = true;
        turnStartTiming.mark("first_delta");
        emitTimingLog("turn_first_event", {
          execution_id: executionId,
          session_id: sessionId,
          harness: "cursor",
          agent_resumed: engine.resolution.resumed,
          mcp_server_count: blueprint.mergedMcpServerUsages.length,
        }, turnStartTiming);
      }
      primaryOnDelta(event);
    },
  });
  sink.recordActivity();
  // Normally send() resolves before any delta arrives, making send_returned
  // the first segment; if a delta beat it, the line is already emitted and
  // adding a mark now would be meaningless.
  if (!turnFirstEventEmitted) {
    turnStartTiming.mark("send_returned");
  }

  // Everything at an index >= this was produced by THIS turn's stream — the
  // positional scope the boundary's #205 attribution and #965 settle read.
  // Snapshotted before the builder can append.
  const turnStartMessageIndex = status.messages.length;

  // Shared cadence with the native harness: discrete state changes force a
  // flush; high-frequency token deltas ride this scheduler's time cadence
  // (env-tunable via STREAMING_* — see loadStreamingConfig).
  const scheduler = new StreamingUpdateScheduler(loadStreamingConfig());

  // Full deps for the shared stream loop, all keyed off the single stream
  // state. Consumed by the primary stream here and by both recovery retries.
  const streamDeps: CursorTurnStreamDeps = {
    ...onDeltaDeps,
    scheduler,
    hitlDir: gate.hitlDir,
  };

  // Post-stream finalize, shared by the primary turn and both recovery retries:
  // fold the deltas that arrived after the last stream event (a completion
  // the delta channel reported last was lost before #1097), close every
  // streaming flag, mark any in-flight sub-agent CANCELLED on a stopped turn,
  // flush the recorder, and persist so the UI sees the settled rows.
  const finalizeStreamPhase = async (): Promise<void> => {
    for (const fact of translator.drainDeltas()) transcript.apply(fact);
    // The runtime finalizes once `runTurn` returns, on every path; this
    // harness finalizes EARLIER too because it persists on the settled rows
    // right below, before `run.wait()` and the boundary, and the console's
    // spinner must stop before that wait. Idempotent.
    transcript.finalize();
    // A stopped turn (pause, shutdown, stall, cost cap, platform stop) aborts
    // the Cursor SDK run, so any sub-agent the parent had delegated is no
    // longer executing. Mark it CANCELLED rather than leaving a permanent
    // IN_PROGRESS "zombie" in the final snapshot, through the one shared act
    // (parity with the native settle).
    if (sink.stopSignal.aborted) {
      cancelInProgressSubAgentProtos(status.subAgentExecutions);
    }
    await eventRecorder?.flush();
    console.log(
      `ExecuteCursor stream ended: execution=${executionId}, events=${streamState.eventCount}, messages=${status.messages.length}, subAgents=${status.subAgentExecutions.length}`,
    );
    // Persist immediately after finalize so the UI sees correct tool-call
    // statuses before the boundary / run.wait() / the runtime's epilogue.
    await sink.requestPersist();
    sink.recordActivity();
  };

  // The turn boundary — overlay the hook's denials as WAITING_APPROVAL gate
  // rows and settle what the ledger accounts for. The pipeline and its
  // ordering rationale live in turn-boundary.ts; this closure binds the
  // turn's state so the recovery retries (which re-run the agent AFTER this
  // primary call) re-enter the IDENTICAL pipeline for their denials.
  const runBoundary = (denialSettled?: Promise<void>): Promise<TurnBoundaryResult> =>
    runTurnBoundary({
      status,
      transcript,
      executionId,
      hitlDir: gate.hitlDir,
      primaryWorkspaceDir: workspace.primaryDir,
      turnStartMessageIndex,
      mergedPolicies: mcp.policies,
      denialCancelSettled: denialSettled,
      foreignGatingHooks: gate.hitlGate.foreignGatingHooks,
    });

  // The boundary mutated the transcript in place and a denial pauses the
  // turn: the runtime flips the phase, persists, and returns to the
  // workflow, which waits for the approval signal and reinvokes.
  const awaitingApproval = (boundary: TurnBoundaryResult): TurnOutcome => {
    console.log(`ExecuteCursor returning WAITING_FOR_APPROVAL: ${boundary.deniedToolCallCount} gated tool(s)`);
    return { kind: "awaiting_approval" };
  };

  // Issue #205: a tool was blocked by a hook Stigmer does not own (the merge
  // preserves the user's own gating hooks, and Cursor runs every one), so no
  // approval can unblock it — an approval grants a token only OUR hook reads,
  // and the foreign hook would deny the re-attempt forever. Completing would
  // be the silent-failure shape the issue describes; instead fail with a
  // diagnosable reason naming the blocked tools and the likely culprit. The
  // user can fix this one: the `actionable` surface.
  const unattributedHookBlock = (boundary: TurnBoundaryResult): TurnOutcome => {
    const blockedTools = [...new Set(boundary.unattributedHookBlocks.map((b) => b.toolName))].join(", ");
    const foreign = gate.hitlGate.foreignGatingHooks;
    const culprit = foreign.length > 0
      ? ` The workspace's .cursor/hooks.json registers hook(s) outside Stigmer's control ` +
        `[${foreign.join(", ")}], which most likely denied it.`
      : "";
    const message =
      `A Cursor hook outside Stigmer's approval gate blocked tool(s): ${blockedTools}.` +
      culprit +
      ` Stigmer cannot request approval on a foreign hook's behalf — remove or adjust ` +
      `the hook in .cursor/hooks.json and retry.`;
    console.error(
      `ExecuteCursor failed (unattributed hook block): execution=${executionId}, ` +
        `tools=[${blockedTools}], foreignHooks=[${foreign.join(", ")}]`,
    );
    return { kind: "failed", surface: "actionable", message };
  };

  // Re-enter the turn boundary for a recovery retry: overlay the retry's
  // denials as gates. (Its file edits need no re-entry: the runtime captures
  // the whole turn's tree once after `runTurn` returns — the shape production
  // case aex_01kws27q1e2esvkqjpvectttxf asked for, now by construction.)
  // Returns undefined for a cancelled retry — there is no gate to open.
  // Passes denialCancelSettled so a first denial that stopped the RETRY waits
  // for run.cancel() before the ledger read, exactly like the primary path.
  const settleRetryTurn = async (retryResultStatus: string): Promise<TurnBoundaryResult | undefined> =>
    retryResultStatus === "cancelled"
      ? undefined
      : runBoundary(streamState.firstDenialDetected ? streamState.denialCancelSettled : undefined);

  // The shared recovery spine. A fresh agent runs the IDENTICAL stream loop,
  // finalize, and stop check as the primary turn, then — on a normal
  // completion or a first denial — waits and re-enters the boundary. The two
  // recovery call sites below differ only in how they build the fresh
  // agent/prompt and how they classify a retry ERROR.
  type RecoveryOutcome =
    | { proceeded: false; outcome: TurnOutcome }
    | {
        proceeded: true;
        retryRun: Run;
        retryResult: Awaited<ReturnType<Run["wait"]>>;
        retryBoundary: TurnBoundaryResult | undefined;
      };
  const runRecoveryStream = async (freshAgent: typeof engine.resolution.agent, retryPrompt: string): Promise<RecoveryOutcome> => {
    // The fresh agent is now the live handle: point the resolution at it so
    // the adapter's disposition parks or closes THIS agent rather than the
    // disposed one it replaced.
    engine.resolution = { ...engine.resolution, agent: freshAgent, agentId: freshAgent.agentId, isNew: true };
    streamState.streamErrorMessage = undefined;
    // The retry always carries the turn's full image payload — never the
    // primary send's HITL-trimmed set: the fresh agent's conversation is
    // empty, so skipping them here would silently lose the user's photo on
    // a recovered turn (issue #366's vision corollary).
    const retryRun = await freshAgent.send(prompt.toSendMessage(retryPrompt, prompt.turnImages), {
      onDelta: makeCursorTurnOnDelta(onDeltaDeps),
    });
    sink.recordActivity();
    const reason = await consumeCursorTurnStream(retryRun, streamDeps);
    await finalizeStreamPhase();
    if (reason === "interrupted") return { proceeded: false, outcome: { kind: "interrupted" } };
    const retryResult = await retryRun.wait();
    sink.recordActivity();
    console.log(`ExecuteCursor retry run.wait(): execution=${executionId}, retryResult=${JSON.stringify(retryResult)}`);
    const retryBoundary = await settleRetryTurn(retryResult.status);
    return { proceeded: true, retryRun, retryResult, retryBoundary };
  };

  // ── The primary stream ────────────────────────────────────────────────────

  const reason = await consumeCursorTurnStream(run, streamDeps);
  await finalizeStreamPhase();
  if (reason === "interrupted") return { kind: "interrupted" };

  // The denial-settle wait applies only when a first denial stopped THIS run;
  // a normal completion passes no promise.
  const boundary = await runBoundary(streamState.firstDenialDetected ? streamState.denialCancelSettled : undefined);
  sink.recordActivity();
  if (boundary.waiting) {
    // A pausing turn is never silent, so an unattributed block alongside our
    // own gate only warns (logged by the boundary) — the pause wins.
    return awaitingApproval(boundary);
  }
  if (boundary.unattributedHookBlocks.length > 0) {
    return unattributedHookBlock(boundary);
  }

  // ── run.wait() ────────────────────────────────────────────────────────────

  const result = await run.wait();
  sink.recordActivity();
  console.log(`ExecuteCursor run.wait() result: execution=${executionId}, result=${JSON.stringify(result)}`);
  // Echo sanity check only: result.model ECHOES the requested selection —
  // the SDK never reports the variant that actually served the call
  // (verified against the billing ledger, #357). A mismatch here means the
  // SDK rewrote our selection (contract change), not variant drift; the
  // authoritative requested-vs-billed reconciliation is the cloud billing
  // handler's pricing_variant mismatch metric.
  const echoedSelection = result.model;
  if (echoedSelection) {
    const idMatches = echoedSelection.id === engine.validatedModel;
    // Compare id/value pairs explicitly, never serialized objects: the SDK
    // may add fields to ModelParameterValue or reorder keys, and neither
    // is contract drift.
    const echoedParams = [...(echoedSelection.params ?? [])].sort((a, b) => a.id.localeCompare(b.id));
    const paramsMatch =
      echoedParams.length === engine.modelParams.length &&
      echoedParams.every((p, i) => p.id === engine.modelParams[i].id && p.value === engine.modelParams[i].value);
    if (!idMatches || !paramsMatch) {
      console.warn(
        `ExecuteCursor model selection echo mismatch (SDK contract drift?): ` +
          `execution=${executionId}, ` +
          `requested=${JSON.stringify({ id: engine.validatedModel, params: engine.modelParams })}, ` +
          `echoed=${JSON.stringify(echoedSelection)}`,
      );
    }
  }

  let outcome: TurnOutcome;
  switch (result.status) {
    case "finished":
      outcome = { kind: "completed" };
      break;
    case "cancelled":
      outcome = { kind: "cancelled" };
      break;
    case "error": {
      // Shape-aware extraction, NOT String(): the result's error fields are
      // structured at runtime often enough that a bare coercion showed users
      // "[object Object]" and shadowed every fallback source below (oss#299).
      const runErrorSources = extractRunErrorSources(result);

      // The SDK frequently resolves run.wait() to a bare { status: "error" }
      // while the real reason (e.g. the original grpc-status 12 routing
      // failure) lives on the failing conversation turn. Capture it here so
      // the classified error is actionable instead of "no detail from SDK".
      const conversationErrorText = await introspectConversation(run, executionId);

      const capturedRejection = getCapturedRejection(executionId);
      if (capturedRejection) clearCapturedRejection(executionId);

      const classified = synthesizeError({
        sdkError: runErrorSources.sdkError,
        sdkResultFields: runErrorSources.sdkResultFields,
        streamErrorMessage: streamState.streamErrorMessage,
        capturedRejection,
        conversationErrorText,
        isResumedHandle: engine.resolution.reason === "resumed_successfully",
        fallbackContext: { model: engine.validatedModel, mode: engine.agentMode, agentId: engine.resolution.agentId },
        durationMs: (result as unknown as Record<string, unknown>).durationMs as number | undefined,
        messageCount: status.messages.length,
        proxyMode: !!config.proxyEndpoint,
      });

      console.error(
        `ExecuteCursor agent error: execution=${executionId}, ` +
          `classified=${JSON.stringify(classified)}, rawResult=${JSON.stringify(result)}`,
      );

      if (shouldRetryWithFreshAgent(classified) && engine.resolution.reason === "resumed_successfully" && !alreadyRetriedWithFreshAgent) {
        alreadyRetriedWithFreshAgent = true;
        console.warn(
          `ExecuteCursor poisoned-handle recovery: execution=${executionId}, ` +
            `disposing agent ${engine.resolution.agentId} and creating fresh agent`,
        );

        try { engine.resolution.agent.close(); } catch { /* best effort */ }

        const freshAgent = await createFreshAgent(engine);
        const freshPrompt = await prompt.buildRecoveryPrompt({
          ...engine.resolution,
          agent: freshAgent,
          agentId: freshAgent.agentId,
          isNew: true,
          resumed: false,
          reason: "created_after_resume_failure",
          resumeFailureDetail: `poisoned-handle recovery: ${classified.message}`,
        });
        console.log(`ExecuteCursor retry with fresh agent: execution=${executionId}, newAgentId=${freshAgent.agentId}`);
        await sink.bindHarnessState(freshAgent.agentId);

        const recovery = await runRecoveryStream(freshAgent, freshPrompt);
        if (!recovery.proceeded) return recovery.outcome;

        const { retryRun, retryResult, retryBoundary } = recovery;
        if (retryBoundary?.waiting) {
          // The retry's denials armed the gate — pause for approval. On a
          // retry error this supersedes the failure, exactly as on the
          // primary path.
          console.log(`ExecuteCursor poisoned-handle recovery paused for approval: execution=${executionId}`);
          return awaitingApproval(retryBoundary);
        }
        if (retryBoundary && retryBoundary.unattributedHookBlocks.length > 0) {
          return unattributedHookBlock(retryBoundary);
        }

        if (retryResult.status === "finished") {
          console.log(`ExecuteCursor poisoned-handle recovery SUCCEEDED: execution=${executionId}`);
          outcome = { kind: "completed" };
          break;
        }
        if (retryResult.status === "cancelled") {
          outcome = { kind: "cancelled" };
          break;
        }

        const retryRejection = getCapturedRejection(executionId);
        if (retryRejection) clearCapturedRejection(executionId);
        const retryConversationErrorText = await introspectConversation(retryRun, executionId);
        // Same shape-aware extraction as the primary error arm — the retry
        // previously String()-coerced result.result alone, so a structured
        // retry failure both read "[object Object]" and ignored the
        // error/message/reason fields the primary arm consults.
        const retryErrorSources = extractRunErrorSources(retryResult);
        const retryClassified = synthesizeError({
          sdkError: retryErrorSources.sdkError,
          sdkResultFields: retryErrorSources.sdkResultFields,
          streamErrorMessage: streamState.streamErrorMessage,
          capturedRejection: retryRejection,
          conversationErrorText: retryConversationErrorText,
          isResumedHandle: false,
          fallbackContext: { model: engine.validatedModel, mode: engine.agentMode, agentId: freshAgent.agentId },
          proxyMode: !!config.proxyEndpoint,
        });
        const message = formatClassifiedError(retryClassified);
        console.error(`ExecuteCursor poisoned-handle recovery FAILED: execution=${executionId}, retryError=${message}`);
        outcome = { kind: "failed", surface: "engine", message };
        break;
      }

      // Transport-timeout retry: fresh agent got 0 messages (degraded h2 session).
      // Reset proxy sessions and try once with a new connection.
      if (classified.category === "network" && classified.retryable && engine.resolution.reason !== "resumed_successfully" && !alreadyRetriedWithFreshAgent) {
        alreadyRetriedWithFreshAgent = true;
        console.warn(
          `ExecuteCursor transport-timeout recovery: execution=${executionId}, ` +
            `resetting proxy sessions and retrying with fresh agent`,
        );

        try { engine.resolution.agent.close(); } catch { /* best effort */ }
        closeProxySessions();

        const freshAgent = await createFreshAgent(engine);
        await sink.bindHarnessState(freshAgent.agentId);

        const recovery = await runRecoveryStream(freshAgent, prompt.effectivePrompt);
        if (!recovery.proceeded) return recovery.outcome;

        const { retryResult, retryBoundary } = recovery;
        if (retryBoundary?.waiting) {
          // The retry's denials armed the gate — pause for approval (see the
          // poisoned-handle branch above for the precedence rationale).
          console.log(`ExecuteCursor transport-timeout recovery paused for approval: execution=${executionId}`);
          return awaitingApproval(retryBoundary);
        }
        if (retryBoundary && retryBoundary.unattributedHookBlocks.length > 0) {
          return unattributedHookBlock(retryBoundary);
        }

        if (retryResult.status === "finished") {
          outcome = { kind: "completed" };
          break;
        }
        outcome = { kind: "failed", surface: "engine", message: `Transport recovery failed: ${formatClassifiedError(classified)}` };
        break;
      }

      outcome = { kind: "failed", surface: "engine", message: formatClassifiedError(classified) };
      break;
    }
    default:
      outcome = { kind: "completed" };
  }

  // Collapse any redundant same-identity tool-call twin born this turn before
  // the terminal persist. On a resume turn the gated tool is already granted, so
  // there is no denial ledger and reconcileDeniedToolCalls never runs — the
  // extra attempt the model emits beside the approved action (a stuck RUNNING
  // zombie, a denied-reported-as-success COMPLETED, or an all-no-change double)
  // would otherwise persist as a second "No preview available" card. The shared
  // routine keeps the diff/output carrier and blanks the rest to hidden SKIPPED
  // rows in place, preserving each committed id so the finalize stays append-only.
  const collapsedTwins = collapseRedundantToolCallTwins(status.messages);
  if (collapsedTwins > 0) {
    console.log(
      `ExecuteCursor collapsed ${collapsedTwins} redundant tool-call twin(s) at ` +
        `terminal finalize (kept in place as hidden SKIPPED rows): execution=${executionId}`,
    );
  }

  return outcome;
}

/**
 * Best-effort: read the failing run's conversation to recover the real error
 * reason the SDK swallowed in run.wait(). Logs the (bounded) raw turns for deep
 * diagnostics and returns a concise error string for the classifier.
 *
 * Strictly non-fatal — any failure (unsupported operation, transport error)
 * returns undefined and never propagates into the execution's error path.
 */
async function introspectConversation(run: Run, executionId: string): Promise<string | undefined> {
  try {
    if (!run.supports("conversation")) {
      console.log(
        `ExecuteCursor conversation introspection unsupported: execution=${executionId}, ` +
          `reason=${run.unsupportedReason("conversation") ?? "n/a"}`,
      );
      return undefined;
    }
    const turns = await run.conversation();
    const raw = JSON.stringify(turns);
    const bounded = raw.length > 8000 ? `${raw.slice(0, 8000)}…(truncated ${raw.length} chars)` : raw;
    console.error(`ExecuteCursor conversation introspection: execution=${executionId}, turns=${turns.length}, raw=${bounded}`);
    return extractConversationErrorText(turns);
  } catch (introspectErr) {
    console.warn(
      `ExecuteCursor conversation introspection failed (non-fatal): execution=${executionId}, ` +
        `error=${introspectErr instanceof Error ? introspectErr.message : String(introspectErr)}`,
    );
    return undefined;
  }
}

/**
 * Walk the last conversation turn and collect human-meaningful error text
 * (error-status payloads and `text`/`message`/`reason` strings). Schema-agnostic
 * by design so it tolerates SDK conversation-shape changes. Returns undefined
 * when nothing useful is found.
 */
function extractConversationErrorText(turns: ConversationTurn[]): string | undefined {
  if (!turns || turns.length === 0) return undefined;
  const collected: string[] = [];

  const visit = (node: unknown, depth: number): void => {
    if (node == null || depth > 6 || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1);
      return;
    }
    const obj = node as Record<string, unknown>;
    if (obj.status === "error" && obj.error != null) {
      collected.push(typeof obj.error === "string" ? obj.error : JSON.stringify(obj.error));
    }
    for (const [key, value] of Object.entries(obj)) {
      if ((key === "text" || key === "message" || key === "reason") && typeof value === "string" && value.trim().length > 0) {
        collected.push(value.trim());
      } else if (typeof value === "object" && value != null) {
        visit(value, depth + 1);
      }
    }
  };

  visit(turns[turns.length - 1], 0);
  if (collected.length === 0) return undefined;

  const joined = [...new Set(collected)].join(" | ");
  return joined.length > 600 ? `${joined.slice(0, 600)}…` : joined;
}

/** The `streaming_usage` carrier the OTel span end reads; the runtime keeps it current on every write. */
export function usageSnapshotFor(sink: TurnSink): { inputTokens: bigint; outputTokens: bigint } {
  const summary = sink.status.streamingUsage ?? create(StreamingUsageSummarySchema, {});
  return { inputTokens: summary.inputTokens, outputTokens: summary.outputTokens };
}
