/**
 * The Cursor harness's settle — from a consumed stream to a `TurnOutcome`.
 *
 * In order: the post-stream finalize (transcript, enrichments, sub-agents,
 * the usage snapshot's carrier, the recorder flush, one persist so the UI
 * sees settled rows); the runtime's stop, if it fired, settled as
 * `interrupted` with nothing further; the turn boundary (`turn-boundary.ts`,
 * whole, Q-S2-1) that authors this turn's change set and overlays the hook's
 * denials as WAITING rows, ending `awaiting_approval` when it says so or
 * failing on an unattributed hook block (#205); `run.wait()` and the
 * classifier; the two recovery spines (a poisoned resumed handle, a
 * transport timeout on a created agent), each running the IDENTICAL stream,
 * finalize and boundary against a fresh agent at most once; the collapse of
 * redundant same-identity tool-call twins; and the outcome.
 *
 * What this module never does: write a phase, a terminal copy or
 * `completedAt` — those are the runtime's (`harness/run-turn.ts`,
 * `terminal-table.ts`); the outcome carries what the runtime cannot read
 * from the status (`failed`'s message and surface, `cancelled`). It does
 * mutate `sink.status`'s transcript rows, which are this harness's to write.
 *
 * Moved from `index.ts` `executeCursorInner` phases 11 to 13 at S2 M3b; the
 * bodies are the orchestrator's, with the runtime's arms taken out.
 */

import { create } from "@bufbuild/protobuf";
import type { Run } from "@cursor/sdk";
import type { ConversationTurn } from "@cursor/sdk";
import { StreamingUsageSummarySchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/usage_pb";

import type { TurnInput, TurnOutcome, TurnSink } from "../../harness/types.js";
import { TimingRecorder, emitTimingLog } from "../../shared/cold-start-timing.js";
import { StreamingUpdateScheduler, loadStreamingConfig } from "../../shared/streaming-scheduler.js";
import { createCursorEventRecorder } from "./cursor-event-recorder.js";
import { DeltaEnricher } from "./delta-enricher.js";
import {
  extractRunErrorSources,
  formatClassifiedError,
  shouldRetryWithFreshAgent,
  synthesizeError,
} from "./error-classifier.js";
import { closeProxySessions } from "./http2-interceptor.js";
import { MessageAccumulator, collapseRedundantToolCallTwins } from "./message-translator.js";
import { clearCapturedRejection, getCapturedRejection } from "./rejection-capture.js";
import { TodoTracker } from "./todo-tracker.js";
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

  const deltaEnricher = new DeltaEnricher();
  const todoTracker = new TodoTracker(status.todos);
  const eventRecorder = createCursorEventRecorder(executionId);

  // The two recovery retries (poisoned-handle / transport-timeout) below run at
  // most once per turn; this guard is the latch.
  let alreadyRetriedWithFreshAgent = false;

  // The shared onDelta only needs the sink/pricer/enricher/state subset, and
  // it is wired at SEND time — before the accumulator exists — so it takes the
  // narrow deps. The primary send and both retry sends reuse this object.
  const onDeltaDeps: TurnOnDeltaDeps = {
    sink,
    usagePricer: engine.usagePricer,
    deltaEnricher,
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
  // this measures. No delta (immediate pause/failure) → no line.
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
  // positional turn boundary the approved-command provenance (DD-28) scopes
  // its qualification to. Snapshotted before the accumulator can append.
  const turnStartMessageIndex = status.messages.length;

  const accumulator = new MessageAccumulator(status.messages, {
    mergedPolicies: mcp.policies,
    provenance: { globalBypass: mcp.leases.global, leasedCategories: mcp.leases.categories },
    workspaceRoot: workspace.primaryDir,
    seededSubAgents: rows.seededSubAgents,
  });
  // Shared cadence with the native harness: discrete state changes force a
  // flush; high-frequency token deltas ride this scheduler's time cadence
  // (env-tunable via STREAMING_* — see loadStreamingConfig).
  const scheduler = new StreamingUpdateScheduler(loadStreamingConfig());

  // Full deps for the shared stream loop, all keyed off the single stream
  // state. Consumed by the primary stream here and by both recovery retries.
  const streamDeps: CursorTurnStreamDeps = {
    ...onDeltaDeps,
    accumulator,
    todoTracker,
    eventRecorder,
    scheduler,
    progressSubstrate: gate.progressSubstrate,
    progressState: gate.progressState,
    changeSetId: workspace.changeSetId,
    hitlDir: gate.hitlDir,
  };

  // Post-stream finalize, shared by the primary turn and both recovery retries:
  // finalize the transcript + streaming flags, mark any in-flight sub-agent
  // CANCELLED on a stopped turn, keep the usage summary's carrier current,
  // flush the recorder, and persist so the UI sees the settled rows.
  const finalizeStreamPhase = async (): Promise<void> => {
    accumulator.finalize();
    deltaEnricher.finalize(status.messages);
    // A stopped turn (pause, shutdown, stall, cost cap, platform stop) aborts
    // the Cursor SDK run, so any sub-agent the parent had delegated is no
    // longer executing. Mark it CANCELLED rather than leaving a permanent
    // IN_PROGRESS "zombie" in the final snapshot (parity with the native
    // harness's cancelSubAgents()).
    if (sink.stopSignal.aborted) {
      accumulator.cancelInProgressSubAgents();
    }
    status.subAgentExecutions = accumulator.subAgentExecutions;
    await eventRecorder?.flush();
    console.log(
      `ExecuteCursor stream ended: execution=${executionId}, events=${streamState.eventCount}, messages=${status.messages.length}, subAgents=${status.subAgentExecutions.length}`,
    );
    // Persist immediately after finalize so the UI sees correct tool-call
    // statuses before the boundary / run.wait() / the runtime's epilogue.
    await sink.requestPersist();
    sink.recordActivity();
  };

  // The turn boundary — author this turn's change set to the file_review
  // ledger (CANDIDATE_CAPTURED) and overlay the hook's denials as
  // WAITING_APPROVAL gate rows. The full pipeline and its ordering rationale
  // live in turn-boundary.ts; this closure binds the turn's state so the
  // recovery retries (which re-run the agent AFTER this primary call) can
  // re-enter the IDENTICAL pipeline — a retry's edits must reach the ledger
  // or they silently escape review.
  const runBoundary = (denialSettled?: Promise<void>): Promise<TurnBoundaryResult> =>
    runTurnBoundary({
      status,
      executionId,
      changeSetId: workspace.changeSetId,
      hitlDir: gate.hitlDir,
      captureMode: workspace.captureMode,
      baselineTree: gate.baselineTree,
      primaryWorkspaceDir: workspace.primaryDir,
      gitWorkspace: workspace.gitWorkspace,
      turnStartMessageIndex,
      approvalGrants: gate.approvalGrants,
      globalBypass: mcp.leases.global,
      seededSubAgents: rows.seededSubAgents,
      artifactStorage: input.artifactStorage,
      mergedPolicies: mcp.policies,
      denialCancelSettled: denialSettled,
      foreignGatingHooks: gate.hitlGate.foreignGatingHooks,
    });

  // The boundary mutated the transcript in place and asked to pause for
  // review: the runtime flips the phase, persists, and returns to the
  // workflow, which waits for the approval/file-review signal and reinvokes.
  const awaitingApproval = (boundary: TurnBoundaryResult): TurnOutcome => {
    console.log(
      `ExecuteCursor returning WAITING_FOR_APPROVAL: ${boundary.deniedToolCallCount} gated tool(s), ` +
        `${boundary.capturedChangeCount} file card(s) pending`,
    );
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

  // Re-enter the turn boundary for a recovery retry: author the retry's net
  // change set to the file_review ledger and overlay any denials as gates —
  // without this a retry's file edits silently escape review (production case
  // aex_01kws27q1e2esvkqjpvectttxf). Returns undefined for a cancelled retry —
  // there is no review to open. Passes denialCancelSettled so a first denial
  // that stopped the RETRY waits for run.cancel() before the ledger read,
  // exactly like the primary path.
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
          // The retry's edits/denials armed the gate — pause for review. On a
          // retry error this supersedes the failure, exactly as on the primary
          // path (a captured change pauses the turn before run.wait() is
          // consulted).
          console.log(`ExecuteCursor poisoned-handle recovery paused for review: execution=${executionId}`);
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
          // The retry's edits/denials armed the gate — pause for review (see
          // the poisoned-handle branch above for the precedence rationale).
          console.log(`ExecuteCursor transport-timeout recovery paused for review: execution=${executionId}`);
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
