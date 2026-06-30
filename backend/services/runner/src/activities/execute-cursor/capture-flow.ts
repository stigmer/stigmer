/**
 * Cursor adapter over the harness-agnostic capture-mode orchestration
 * ({@link ../../shared/filereview/capture.js}).
 *
 * The substrate (git snapshot/restore) and the orchestration (baseline/candidate/
 * reconcile authoring) live in `shared/filereview/` so the Cursor and deep-agent
 * harnesses author IDENTICAL ledger entries. This adapter binds the Cursor
 * specifics:
 *  - `harnessId = "cursor"` (stamped on the BASELINE payload the projection reads);
 *  - the Cursor gate files written into the workspace, excluded from the captured
 *    diff (`CURSOR_RUNNER_OWNED_PATHS`);
 *  - hiding the streamed file-edit transcript rows that flowed this turn, so
 *    `file_change_sets` is the single review surface (`hideFlowedFileEditRows`).
 *
 * The three turn-boundary functions keep their original signatures so the
 * activity wiring (index.ts) and the cutover tests are unchanged.
 */

import type { AgentMessage } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import type { AgentExecutionStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { FileChangeSet } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/filereview_pb";
import { approvalCategory } from "./approval-policy.js";
import { toolIdentity, primaryToken } from "./approval-state.js";
import { contentDigest } from "../../shared/file-tools.js";
import { hideToolCallRow, isToolCallRowHidden } from "../../shared/tool-row.js";
import {
  applyCaptureDecisions as sharedApplyCaptureDecisions,
  captureBaselineToLedger as sharedCaptureBaselineToLedger,
  captureCandidateToLedger as sharedCaptureCandidateToLedger,
  type CaptureResumeResult,
} from "../../shared/filereview/capture.js";
import type { CapturedFileChange as GitCapturedChange } from "../../shared/filereview/git-substrate.js";

export type { CaptureResumeResult };

/** The harness id the projection reads from the BASELINE payload (load-bearing). */
const HARNESS_ID = "cursor";

/**
 * Workspace-relative paths the Cursor gate writes into the repo. They are excluded
 * from capture so a turn's diff never shows the gate's own machinery. (The
 * workspace-scoped gate dir and SDK state live under `~/.stigmer` / the
 * git-excluded `.stigmer`, so they need no exclusion here.)
 */
const CURSOR_RUNNER_OWNED_PATHS: readonly string[] = [
  ".cursor/hooks.json",
  ".cursor/rules/stigmer-tool-approval.mdc",
];

/**
 * Turn start: pin the pre-turn working tree behind the baseline ref and author
 * BASELINE_CAPTURED (harnessId "cursor"). Returns the baseline tree sha for the
 * turn-end diff.
 */
export function captureBaselineToLedger(opts: {
  readonly status: AgentExecutionStatus;
  readonly gitRoot: string;
  readonly executionId: string;
  readonly changeSetId: string;
}): Promise<string> {
  return sharedCaptureBaselineToLedger({
    ...opts,
    harnessId: HARNESS_ID,
    excludePaths: CURSOR_RUNNER_OWNED_PATHS,
  });
}

/**
 * Turn end: capture the change set + author CANDIDATE_CAPTURED, then hide the
 * streamed file-edit rows that flowed this turn so `file_change_sets` is the
 * single review surface. The working tree is LEFT applied (Cursor parity).
 *
 * `deniedTokens` are the identities the hook gated this turn (shell/MCP, or a
 * gitignored write/delete). A streamed file-edit row whose identity is in that
 * set is left for the deny-gate reconcile path — it did NOT flow (the hook denied
 * it), so it must not be hidden as a flowed edit.
 *
 * Mutates `messages` and `status` in place. Returns the captured changes.
 */
export async function captureTurnToLedger(opts: {
  readonly status: AgentExecutionStatus;
  readonly gitRoot: string;
  readonly executionId: string;
  readonly changeSetId: string;
  readonly baselineTree: string;
  readonly messages: AgentMessage[];
  readonly deniedTokens: ReadonlySet<string>;
}): Promise<readonly GitCapturedChange[]> {
  const { status, gitRoot, executionId, changeSetId, baselineTree, messages, deniedTokens } = opts;

  const changes = await sharedCaptureCandidateToLedger({
    status,
    gitRoot,
    executionId,
    changeSetId,
    baselineTree,
    harnessId: HARNESS_ID,
    excludePaths: CURSOR_RUNNER_OWNED_PATHS,
  });

  // Single review surface: the per-file edits now live on the file_review ledger
  // (projected to file_change_sets), so hide the streamed file-edit rows that
  // flowed this turn. Denied (gitignored/shell) rows stay on the deny-gate path.
  // Runs regardless of the change count (a denied-only turn still hides nothing
  // and is a no-op).
  hideFlowedFileEditRows(messages, deniedTokens);

  return changes;
}

/**
 * Resume: reconcile the working tree to the change set's DECIDED decisions
 * (keep approved "after" bytes, snap rejected/undecided back to baseline,
 * hash-verified), author RECONCILED / FAILED, and release the refs. Delegates to
 * the shared orchestration with the Cursor harness id + exclude paths.
 */
export function applyCaptureDecisions(opts: {
  readonly status: AgentExecutionStatus;
  readonly gitRoot: string;
  readonly executionId: string;
  readonly changeSet: FileChangeSet;
}): Promise<CaptureResumeResult> {
  return sharedApplyCaptureDecisions({
    ...opts,
    harnessId: HARNESS_ID,
    excludePaths: CURSOR_RUNNER_OWNED_PATHS,
  });
}

// ---------------------------------------------------------------------------
// Cursor-specific presentation
// ---------------------------------------------------------------------------

/**
 * Hide every streamed file-edit row (category write/delete) that flowed this
 * turn, so the file_change_sets projection is the single review surface. Skips:
 *  - already-hidden rows (idempotent across re-persists / activity retries);
 *  - denied identities (the deny-gate reconcile path owns those rows).
 */
function hideFlowedFileEditRows(
  messages: AgentMessage[],
  deniedTokens: ReadonlySet<string>,
): void {
  for (const msg of messages) {
    for (const tc of msg.toolCalls) {
      if (isToolCallRowHidden(tc)) continue;
      const category = approvalCategory(tc.name);
      if (category !== "write" && category !== "delete") continue;
      const args = (tc.args ?? {}) as Record<string, unknown>;
      const id = toolIdentity(tc.name, tc.mcpServerSlug, args);
      const token = primaryToken(id.key, id.salient, contentDigest(args));
      if (deniedTokens.has(token)) continue; // denied -> reconcile path owns it
      hideToolCallRow(tc);
    }
  }
}
