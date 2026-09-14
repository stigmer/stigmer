/**
 * The Cursor harness's turn boundary — the post-run pipeline that turns the
 * deny-and-retry primitive's evidence into the runtime's review surfaces:
 *
 *  1. read the denial ledger the preToolUse hook appended this turn (ALL
 *     kinds — every entry means "this action did not execute"; only the
 *     approval-kind subset may pause, see approval-state.ts);
 *  2. reconcile denied (approval-kind) tool calls to WAITING_APPROVAL gate rows
 *     and redact the model's provisional post-denial narration;
 *  3. settle unattended-mode denials as SKIPPED (DD-014);
 *  4. detect UNATTRIBUTED hook blocks (issue #205) — a tool blocked by a hook
 *     with no ledger entry of any kind was denied by a FOREIGN hook the merge
 *     preserved, and the caller fails the run rather than completing silently;
 *  5. settle UNRESOLVED tool calls (issue #965) — a this-turn row still
 *     non-terminal on a completing turn with no ledger attribution hung inside
 *     the harness and can never complete; it is settled to an honest
 *     TOOL_CALL_INTERRUPTED and disclosed on the transcript instead of being
 *     silently stamped by the server's terminal settle after the fact.
 *
 * `waiting` means "a denial pauses": a gated tool call the user must decide.
 * The turn's FILE CHANGES are not this boundary's since S3 M4 — the runtime
 * captures them once, over whatever the whole turn left on the tree, after
 * `runTurn` returns (`harness/capture.ts`), and decides the review pause
 * itself. Two consequences the boundary used to suppress when it could see
 * the capture: steps 4 and 5 now run on a turn whose only pause would have
 * been a file review, so a hung row is disclosed and a foreign-hook block is
 * failed BEFORE the review rather than after it (F-M4-P9, F-M4-P10, Q-M4-11).
 *
 * Extracted from the activity entry point (index.ts Phase 12) so it is directly
 * unit-testable AND re-enterable: the poisoned-handle / transport-timeout
 * recoveries re-run the agent with a fresh handle AFTER the primary boundary
 * already ran, so their denials must flow through this exact pipeline again.
 * Re-entry is safe by construction: the denial ledger is per-turn append-only
 * and the reconcile is idempotent over it.
 *
 * The caller owns everything around the boundary: the stream epilogue
 * (accumulator/enricher finalize), the WAITING_FOR_APPROVAL phase flip +
 * persist, and the terminal result mapping.
 */

import type { AgentExecutionStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { LocalWorkspaceBackend } from "../../shared/workspace/local-backend.js";
import type { MergedToolPolicy } from "../../shared/approval-policy.js";
import {
  approvalDenials,
  denialKindOf,
  readDenialLedger,
  unattendedDenials,
} from "./approval-state.js";
import {
  clearProvisionalPostDenialNarration,
  detectUnattributedHookBlocks,
  reconcileDeniedToolCalls,
  settleUnresolvedToolCalls,
  stampUnattendedSkippedToolCalls,
  type UnattributedHookBlock,
} from "./boundary-rows.js";
import { utcTimestamp } from "../../shared/status.js";
import { create } from "@bufbuild/protobuf";
import { AgentMessageSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { MessageType } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

// How long the boundary waits for the first-denial-stop's run.cancel() to
// settle before reading the final denial ledger. Long enough for the SDK's
// normal teardown, short enough that a wedged cancel cannot noticeably delay
// the approval pause the user is already waiting on. (The runtime's capture
// runs after the adapter's whole turn, its gate already torn down, so a late
// tool can no longer mutate the tree mid-capture.)
const FIRST_DENIAL_CANCEL_TIMEOUT_MS = 5_000;

export interface TurnBoundaryOptions {
  /** Mutated in place: gate rows overlaid, narration redacted. */
  readonly status: AgentExecutionStatus;
  readonly executionId: string;
  /** Session HITL dir holding the denial ledger; undefined → no gate installed. */
  readonly hitlDir: string | undefined;
  readonly primaryWorkspaceDir: string;
  /**
   * Index of the first message produced by THIS turn's stream — the positional
   * scope the #205 attribution and the #965 settle read.
   */
  readonly turnStartMessageIndex: number;
  /** Merged approval policies, threaded to the denied-call reconcile for gate provenance. */
  readonly mergedPolicies: ReadonlyMap<string, MergedToolPolicy>;
  /**
   * The first-denial-stop's run.cancel() promise, when a denial stopped this
   * run. Awaited (timeboxed) before the ledger read: run.cancel() races the
   * SDK's auto-execution — until it lands, the agent process may still attempt
   * a post-denial workaround whose hook denial would land AFTER a premature
   * ledger read (the row then never collapses and renders as RUNNING forever —
   * production case aex_01kwj07f7g23c3wp9sn8496z5g), or a late tool could
   * mutate the tree mid-capture. Omit when no denial stopped the run (the
   * normal completion path and the recovery retries, which have no early stop).
   */
  readonly denialCancelSettled?: Promise<void>;
  /**
   * Foreign (non-Stigmer) hook commands the gate install preserved on the
   * gating events (see HitlGateHandle.foreignGatingHooks). Used only for
   * diagnostics: when an unattributed hook block is detected, these name the
   * likely culprit in the logs and the caller's failure message.
   */
  readonly foreignGatingHooks?: readonly string[];
}

export interface TurnBoundaryResult {
  /**
   * True when a denial pauses the turn — at least one gated tool call the
   * user must decide. The caller ends the turn `awaiting_approval` without
   * consulting run.wait().
   */
  readonly waiting: boolean;
  /** Denied tool calls reconciled to WAITING_APPROVAL gate rows this call. */
  readonly deniedToolCallCount: number;
  /**
   * Hook-blocked tool calls this turn that NO denial-ledger entry accounts for
   * (issue #205): a foreign `.cursor/hooks.json` hook — or our own hook with a
   * failed ledger append — denied them, and Stigmer cannot approve on its
   * behalf. When the turn is not otherwise pausing, the caller must surface an
   * explicit EXECUTION_FAILED instead of completing with the work silently
   * undone (a pausing turn is not silent — the caller logs and pauses as usual).
   */
  readonly unattributedHookBlocks: readonly UnattributedHookBlock[];
  /**
   * This-turn tool calls settled to TOOL_CALL_INTERRUPTED because they were
   * still non-terminal on a completing turn with no ledger attribution (issue
   * #965) — the harness returned no result for them and the platform holds no
   * approval for them. Informational: the boundary already settled the rows
   * and appended the transcript disclosure; the run is NOT failed for these
   * (unlike #205's unattributed blocks, an unresolved row can be benign
   * stream event-loss, so failing would over-punish).
   */
  readonly settledUnresolvedCount: number;
}

/**
 * Run the turn boundary: overlay the hook's denials as approval gates and
 * settle what the ledger accounts for. Mutates `opts.status` in place and
 * reports whether a denial pauses the turn.
 *
 * The hook records each denial to the ledger; we mark the corresponding tool
 * calls WAITING_APPROVAL. The backend projects pending_approvals from that
 * tool-call status (PendingApprovalComputer), so — exactly like the native
 * harness — the approval surface is driven entirely by tool-call status. We
 * deliberately do NOT set status.pendingApprovals here: any value would be
 * discarded by the backend's recompute on the next updateStatus.
 */
export async function runTurnBoundary(opts: TurnBoundaryOptions): Promise<TurnBoundaryResult> {
  const {
    status,
    executionId,
    hitlDir,
    primaryWorkspaceDir,
    turnStartMessageIndex,
    mergedPolicies,
    denialCancelSettled,
    foreignGatingHooks,
  } = opts;

  // The timebox keeps a wedged cancel from hanging the pause; the reconcile
  // trims below remain the backstop for that degraded case.
  if (denialCancelSettled) {
    await Promise.race([
      denialCancelSettled,
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, FIRST_DENIAL_CANCEL_TIMEOUT_MS);
        timer.unref();
      }),
    ]);
  }
  // The FULL ledger (all kinds) vs its APPROVAL subset — the kind split:
  // every ledger entry means "this action did NOT execute", so the full set
  // feeds the unattended settle and the foreign-hook attribution;
  // only approval-kind entries may become WAITING_APPROVAL gates (a secret
  // hard-block or fail-closed deny is attributable but never pausable).
  const deniedLedger = await readDenialLedger(hitlDir ?? "");
  const approvalLedger = approvalDenials(deniedLedger);

  // The gate reads each denied file's pre-edit `before` from the workspace the
  // runner is co-located with (local FS for OSS; the sandbox in cloud), so a
  // whole-file rewrite gate renders a true before/after diff. The tool was
  // DENIED, so disk still holds the old content. User files are never platform
  // paths, so no platformDir routing is needed here.
  const gateWorkspaceBackend = new LocalWorkspaceBackend(primaryWorkspaceDir);
  const deniedToolCalls = await reconcileDeniedToolCalls(
    status.messages,
    approvalLedger,
    mergedPolicies,
    gateWorkspaceBackend,
  );
  // Observability: a synthesized placeholder (id `approval:*`) means a denial
  // correlated to NO streamed tool call in either the exact or the normalized
  // pass. After the normalized-path fallback this should be ~0; a non-zero rate
  // is the early-warning signal of a NEW identity drift (the gate would then
  // show "No preview available" with no diff). Logged, not thrown — the
  // synthesized gate still safely surfaces the approval.
  const synthesizedGateCount = deniedToolCalls.filter((tc) =>
    tc.id.startsWith("approval:"),
  ).length;
  if (synthesizedGateCount > 0) {
    console.warn(
      `ExecuteCursor reconcile synthesized ${synthesizedGateCount} placeholder gate(s) ` +
        `with no correlated stream call (execution=${executionId}); ` +
        `possible hook/stream identity drift — gate(s) will lack a diff`,
    );
  }
  if (deniedToolCalls.length > 0) {
    // Deterministic clean-pause: a turn that pauses for approval must read as
    // the same shape the native harness produces — pre-tool text + the gated
    // tool calls — never the model's provisional reaction to Cursor's deny
    // (e.g. "blocked by a hook; enable it in your Cursor settings"). We blank
    // that reaction in place (keeping the message count, so the finalize stays
    // append-only) rather than removing it. See
    // clearProvisionalPostDenialNarration for the full rationale.
    const redactedNarration = clearProvisionalPostDenialNarration(status.messages, deniedToolCalls);
    if (redactedNarration.length > 0) {
      console.log(
        `ExecuteCursor redacted ${redactedNarration.length} provisional post-denial narration message(s) before pausing for approval`,
      );
    }
  }

  // Unattended approval mode (DD-014): denials the hook resolved with the
  // non-pausing "unattended" kind never became gates above; settle their
  // streamed rows (FAILED-with-hook-error or interrupted non-terminal) to
  // honest TOOL_CALL_SKIPPED + UNATTENDED_SKIP provenance — the same shape
  // the native harness's reconcileUnattendedSkips persists. Runs before the
  // #205 attribution pass, which then never sees them as hook-block FAILED
  // rows (they are in the full ledger regardless, so attribution was safe
  // either way).
  const stampedUnattended = stampUnattendedSkippedToolCalls(
    status.messages,
    status.subAgentExecutions,
    unattendedDenials(deniedLedger),
    primaryWorkspaceDir,
  );
  if (stampedUnattended > 0) {
    console.log(
      `ExecuteCursor turn boundary: ${stampedUnattended} unattended-mode tool call(s) ` +
      `settled as SKIPPED (no approver on this surface; execution=${executionId})`,
    );
  }

  // Issue #205 invariant: a blocked tool must never silently complete. Match
  // this turn's hook-blocked FAILED rows against the FULL ledger (all kinds) —
  // anything left over was denied by a hook that is not ours (or by our hook
  // with a failed ledger append). The reconcile above ran first, so our own
  // approval gates are already WAITING_APPROVAL/collapsed and cannot appear
  // here as false positives.
  const unattributedHookBlocks = detectUnattributedHookBlocks(
    status.messages,
    turnStartMessageIndex,
    deniedLedger,
    primaryWorkspaceDir,
  );
  const waiting = deniedToolCalls.length > 0;

  // Issue #965 invariant: an unresolved tool must never silently complete.
  // On a COMPLETING (non-pausing) turn, any this-turn row still PENDING /
  // RUNNING with no ledger attribution hung inside the harness (the production
  // case: `generateImage`, which rides the SDK's interaction-query channel and
  // is invisible to the hook). Settle it to an honest TOOL_CALL_INTERRUPTED —
  // never FAILED, so a recovery replay can still supersede it (#207) — and
  // disclose it on the transcript, so the model's own narration (which may
  // have promised an approval the platform does not hold) is never the last
  // word. A PAUSING turn is skipped: its non-terminal rows belong to the
  // reconcile/collapse machinery above. Runs AFTER the unattended stamp so a
  // ledger-attributed row is already SKIPPED and cannot double-settle, and
  // AFTER the #205 detection so a hook-block FAILED row keeps its distinct,
  // run-failing treatment. Deliberately does NOT fail the run (unlike #205):
  // an unresolved row can also be benign stream event-loss where the tool
  // actually ran, and converting those into failures would be a regression.
  let settledUnresolved: readonly { toolCallId: string; toolName: string }[] = [];
  if (!waiting) {
    settledUnresolved = settleUnresolvedToolCalls(
      status.messages,
      turnStartMessageIndex,
      deniedLedger,
      primaryWorkspaceDir,
    );
    if (settledUnresolved.length > 0) {
      const names = [...new Set(settledUnresolved.map((s) => s.toolName))].join(", ");
      status.messages.push(create(AgentMessageSchema, {
        type: MessageType.MESSAGE_SYSTEM,
        content:
          `Note: the following tool call(s) never completed and were not executed: ${names}. ` +
          `No approval is pending for them — if the agent said otherwise, disregard that. ` +
          `You can ask the agent to try again.`,
        timestamp: utcTimestamp(),
      }));
      console.warn(
        `ExecuteCursor turn boundary: settled ${settledUnresolved.length} unresolved ` +
        `tool call(s) to INTERRUPTED with disclosure [${names}] — the harness returned ` +
        `no result for them and no ledger entry accounts for them (issue #965; ` +
        `execution=${executionId})`,
      );
    }
  }

  if (unattributedHookBlocks.length > 0) {
    const culprits = (foreignGatingHooks?.length ?? 0) > 0
      ? ` — likely foreign workspace hook(s): ${foreignGatingHooks!.join(", ")}`
      : "";
    console.warn(
      `ExecuteCursor turn boundary: ${unattributedHookBlocks.length} tool call(s) blocked ` +
      `by a hook with NO matching denial-ledger entry ` +
      `[${unattributedHookBlocks.map((b) => b.toolName).join(", ")}]${culprits} ` +
      `(execution=${executionId})${waiting ? " — turn pauses anyway; not failing" : ""}`,
    );
  }
  // Diagnosability for the broken-gate shape: fail-closed entries mean the
  // approval state file was missing and the gate denied everything it saw.
  // Attribution treats those blocks as ours (never a foreign-hook failure),
  // but the condition itself deserves a loud log.
  if (deniedLedger.some((e) => denialKindOf(e) === "fail-closed")) {
    console.warn(
      `ExecuteCursor turn boundary: fail-closed denial(s) in the ledger — the approval ` +
      `state file was missing during this turn and gated tools were denied ` +
      `(execution=${executionId})`,
    );
  }

  return {
    waiting,
    deniedToolCallCount: deniedToolCalls.length,
    unattributedHookBlocks,
    settledUnresolvedCount: settledUnresolved.length,
  };
}
