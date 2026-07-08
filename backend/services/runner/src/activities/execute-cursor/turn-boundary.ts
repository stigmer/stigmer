/**
 * The Cursor harness's turn boundary — the single post-run pipeline that turns
 * a finished agent run into the durable review surfaces:
 *
 *  1. read the denial ledger the preToolUse hook appended this turn (ALL
 *     kinds — every entry means "this action did not execute"; only the
 *     approval-kind subset may pause, see approval-state.ts);
 *  2. derive the approved-command provenance (DD-28 auto-keep facts);
 *  3. capture the turn's net file change set to the file_review ledger
 *     (CANDIDATE_CAPTURED) and stamp the flowed edit rows;
 *  4. reconcile denied (approval-kind) tool calls to WAITING_APPROVAL gate rows
 *     and redact the model's provisional post-denial narration;
 *  5. detect UNATTRIBUTED hook blocks (issue #205) — a tool blocked by a hook
 *     with no ledger entry of any kind was denied by a FOREIGN hook the merge
 *     preserved, and the caller fails the run rather than completing silently.
 *
 * Extracted from the activity entry point (index.ts Phase 12) so it is directly
 * unit-testable AND re-enterable: the poisoned-handle / transport-timeout
 * recoveries re-run the agent with a fresh handle AFTER the primary boundary
 * already ran, so their edits must flow through this exact pipeline again or
 * they silently escape review (production case aex_01kws27q1e2esvkqjpvectttxf,
 * where a Build-from-plan retry created a file with no review gate).
 *
 * Re-entry is safe by construction: a retry is only reachable when the primary
 * boundary captured nothing (a captured change pauses the turn before
 * run.wait() is ever consulted), `stampFlowedFileEditRows` skips already-stamped
 * rows, and the denial ledger is per-turn append-only.
 *
 * The caller owns everything around the boundary: the stream epilogue
 * (accumulator/enricher finalize), the WAITING_FOR_APPROVAL phase flip +
 * persist, and the terminal result mapping.
 */

import type { AgentExecutionStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { SubAgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/subagent_pb";
import { collectSubAgentToolCallIds } from "../../shared/tool-row.js";
import { LocalWorkspaceBackend } from "../../shared/workspace/local-backend.js";
import type { ArtifactStorage } from "../../shared/artifact-storage.js";
import type { MergedToolPolicy } from "../../shared/approval-policy.js";
import {
  approvalDenials,
  denialKindOf,
  primaryToken,
  readDenialLedger,
  type ApprovalGrant,
} from "./approval-state.js";
import { deriveTurnCommandProvenance } from "./command-provenance.js";
import { captureTurnToLedger } from "./capture-flow.js";
import {
  clearProvisionalPostDenialNarration,
  detectUnattributedHookBlocks,
  reconcileDeniedToolCalls,
  type UnattributedHookBlock,
} from "./message-translator.js";

// How long the boundary waits for the first-denial-stop's run.cancel() to
// settle before reading the final denial ledger and capturing the turn's tree.
// Long enough for the SDK's normal teardown, short enough that a wedged cancel
// cannot noticeably delay the approval pause the user is already waiting on.
const FIRST_DENIAL_CANCEL_TIMEOUT_MS = 5_000;

export interface TurnBoundaryOptions {
  /** Mutated in place: gate rows overlaid, edit rows stamped, narration redacted. */
  readonly status: AgentExecutionStatus;
  readonly executionId: string;
  /** This turn's change set id (`{executionId}:{turnSeq}`). */
  readonly changeSetId: string;
  /** Session HITL dir holding the denial ledger + CAS sidecar; undefined → no gate installed. */
  readonly hitlDir: string | undefined;
  /** Whether this turn runs apply-then-review capture (vs. the deny-gate fallback). */
  readonly captureMode: boolean;
  /**
   * The baseline authored at turn start — the git tree sha for a git workspace,
   * or "" (empty, but authored) for a non-git one. `undefined` means no baseline
   * was authored this turn, which skips capture entirely; a plain truthiness
   * check would wrongly skip the non-git capture.
   */
  readonly baselineTree: string | undefined;
  readonly primaryWorkspaceDir: string;
  /** True for a git work tree; false for a CAS-only non-git workspace. */
  readonly gitWorkspace: boolean;
  /**
   * Index of the first message produced by THIS turn's stream — the positional
   * turn boundary the approved-command provenance (DD-28) scopes to.
   */
  readonly turnStartMessageIndex: number;
  /** Reinvocation grants; their tokens map back to the consent rows for DD-28. */
  readonly approvalGrants: ApprovalGrant[] | undefined;
  /** spec.auto_approve_all — qualifies every command as consented for DD-28. */
  readonly globalBypass: boolean;
  /**
   * Sub-agent executions that existed BEFORE this turn's stream (cloned in on
   * resume); their rows are skipped when stamping so a resume never re-stamps a
   * prior turn's sub-agent rows.
   */
  readonly seededSubAgents: readonly SubAgentExecution[];
  /** CAS blob store for gitignored/non-git captures; undefined → git-only capture. */
  readonly artifactStorage: ArtifactStorage | undefined;
  /** Merged approval policies, threaded to the denied-call reconcile for gate provenance. */
  readonly mergedPolicies: Map<string, MergedToolPolicy>;
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
   * True when the turn must pause for human review — at least one gated tool
   * call or one captured file change. The caller flips the phase to
   * WAITING_FOR_APPROVAL, persists, and returns without consulting run.wait().
   */
  readonly waiting: boolean;
  /** File changes authored to the file_review ledger this call (0 = no candidate). */
  readonly capturedChangeCount: number;
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
}

/**
 * Run the turn boundary: author this turn's change set to the file_review
 * ledger and overlay the hook's denials as approval gates. Mutates
 * `opts.status` in place and reports whether the turn must pause.
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
    changeSetId,
    hitlDir,
    captureMode,
    baselineTree,
    primaryWorkspaceDir,
    gitWorkspace,
    turnStartMessageIndex,
    approvalGrants,
    globalBypass,
    seededSubAgents,
    artifactStorage,
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
  // feeds capture stamping, DD-28 provenance, and foreign-hook attribution;
  // only approval-kind entries may become WAITING_APPROVAL gates (a secret
  // hard-block or fail-closed deny is attributable but never pausable).
  const deniedLedger = await readDenialLedger(hitlDir ?? "");
  const approvalLedger = approvalDenials(deniedLedger);

  // Capture mode: author the net change set to the file_review ledger as the
  // CANDIDATE_CAPTURED event (projected server-side to a file_change_set
  // AWAITING_REVIEW — the single review surface). The runner-owned gate files
  // are excluded from the capture. The agent's edits are LEFT applied on the
  // working tree (Cursor parity — the user reviews the real change; nothing is
  // committed and the next turn is blocked until approval, and a reject snaps
  // each file back on resume). Runs BEFORE the denial reconcile so a denied
  // (gitignored) write stays on the deny-gate path while every flowed edit is
  // captured to the ledger.
  let capturedChangeCount = 0;
  if (captureMode && baselineTree !== undefined && primaryWorkspaceDir) {
    const deniedTokens = new Set(deniedLedger.map((e) => e.token));
    // Approved-command turn facts (DD-28): when every mutation-capable call
    // this turn was a consented shell command, attach the provenance so the
    // backend can verify the cited consent rows and auto-keep the set instead
    // of arming a second gate. Fail-closed: any non-qualifying turn attaches
    // nothing and reviews manually exactly as before.
    const commandProvenance = deriveTurnCommandProvenance({
      messages: status.messages,
      turnStartIndex: turnStartMessageIndex,
      deniedTokens,
      grantTokenToConsentId: new Map(
        (approvalGrants ?? []).map((g) => [
          primaryToken(g.key, g.salient, g.contentDigest),
          g.sourceToolCallId,
        ]),
      ),
      globalBypass,
    });
    if (commandProvenance) {
      console.log(
        `ExecuteCursor capture: turn qualifies for approved-command auto-keep ` +
        `(consent rows: ${commandProvenance.consentToolCallIds.join(",") || "(auto_approve_all)"}); ` +
        `attaching provenance to candidate (execution=${executionId})`,
      );
    }
    const captured = await captureTurnToLedger({
      status,
      gitRoot: primaryWorkspaceDir,
      executionId,
      changeSetId,
      baselineTree,
      messages: status.messages,
      deniedTokens,
      commandProvenance,
      // Scope sub-agent row stamping to this turn: the seeded prior sub-agents
      // (cloned in on resume) are the "before this turn" rows to skip.
      priorSubAgentToolCallIds: collectSubAgentToolCallIds(seededSubAgents),
      // The CAS half: read the sidecar the hook staged this turn and compose it
      // into the change set. hitlDir + storage are present when captureIgnored
      // was on (a git tree's gitignored writes, or ALL writes in a non-git
      // workspace). In a git tree this composes with the git diff (HYBRID); in a
      // non-git workspace it IS the whole change set (CAS-only).
      hitlDir,
      storage: artifactStorage,
      gitWorkspace,
    });
    capturedChangeCount = captured.length;
    if (capturedChangeCount > 0) {
      console.log(
        `ExecuteCursor capture: ${capturedChangeCount} file change(s) authored to the ` +
        `file_review ledger (change_set=${changeSetId}), working tree left applied ` +
        `for review (execution=${executionId})`,
      );
    }
  }

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
  const waiting = deniedToolCalls.length > 0 || capturedChangeCount > 0;
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
    capturedChangeCount,
    deniedToolCallCount: deniedToolCalls.length,
    unattributedHookBlocks,
  };
}
