/**
 * Harness-agnostic helpers for a transcript tool-call row's file-review
 * presentation.
 *
 * When file edits are reviewed as a captured `FileChangeSet` (the apply-then-
 * review model), each flowed file-edit row STAYS visible at its transcript
 * position as an observational/audit record — "the agent edited this file,
 * here" — and is stamped with the change set id it contributed to
 * ({@link stampFileEditRow}). The ledger remains the single DECISION surface;
 * the row is never one (the research report's "transcript row references
 * change_set_id" / "tool-call rows are observational/audit-only for file
 * tools"). Both harnesses (Cursor deny-gate + deep-agent middleware) stamp rows
 * the same way, so the operation lives here.
 *
 * {@link hideToolCallRow} / {@link isToolCallRowHidden} remain for the OTHER
 * collapse consumer — a superseded same-turn denial twin — and as the render
 * shape of legacy (pre-stamping) sessions whose flowed edit rows were hidden.
 */

import { ToolCallStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { AgentMessage, ToolCall } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import type { SubAgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/subagent_pb";
import { extractFilePath } from "./file-tools.js";
import { isSecretLikePath } from "./filereview/secret-paths.js";
import { toolApprovalCategory } from "./tool-kind.js";
import { utcTimestamp } from "./status.js";

/**
 * Stamp a flowed file-edit row with the change set that captured its turn.
 * PRESENTATION/AUDIT-ONLY (see `ToolCall.file_change_set_id`): clients badge
 * the row with the set's review state and anchor the set's decision surface
 * after the turn's last stamped row. Never a correlation or enforcement key.
 *
 * Additive by design — the row keeps its args/result/status so the per-edit
 * diff the user watched stream stays rendered in place. The captured net diff
 * on the ledger is the only REVIEWED artifact; the row is a historical record.
 *
 * An already-stamped row is left untouched. This is load-bearing, not hygiene:
 * the turn-boundary pass re-walks the whole transcript, which on a resume
 * includes the prior turn's seeded rows — without this guard, turn N would
 * re-stamp turn N-1's rows with its own per-turn change set id (silent
 * mis-attribution).
 *
 * Defensive secret clear (DD-12 D4 belt-and-braces): flowed rows are never
 * secret in practice — the Cursor hook hard-denies secret-like writes before
 * they flow — but a write to a TRACKED secret-like path (e.g. a committed
 * credentials file) is outside the hook's gitignored scope. Such a row keeps
 * its path (a filename is not itself the secret) and is stripped of content
 * (`args` body, `result` diff, `args_preview`). Fail-closed: a file row whose
 * path cannot be determined is stripped rather than trusted.
 */
export function stampFileEditRow(tc: ToolCall, changeSetId: string): void {
  if (tc.fileChangeSetId) return;
  tc.fileChangeSetId = changeSetId;

  if (withholdSecretFileContent(tc)) {
    // A FLOWED row's `result` is the tool's own output — for an edit that can
    // echo the changed lines — so drop it too. withholdSecretFileContent keeps
    // `result` intact because the deny-gate path (below) uses it for the safe
    // "blocked for security" message; here the row actually ran, so clear it.
    tc.result = "";
  }
}

/**
 * Withhold a file-mutating row's CONTENT while keeping its path visible: reduce
 * `args` to `{ path }` (or `undefined` when the path cannot be determined) and
 * clear `args_preview`. `result` and `status` are left untouched — a caller that
 * needs the diff dropped clears it explicitly (see {@link stampFileEditRow}).
 * Returns whether the row was secret-like (and therefore withheld).
 *
 * The single primitive behind the never-persist-secret-contents contract (design
 * doc 12, D4): a file-mutating tool's `args` holds the full write body, which for
 * a secret-like path must never reach the transcript / Temporal history. A
 * filename is not itself the secret, so the path is kept. Fail-closed: an
 * undeterminable path is treated as secret-like ({@link isSecretLikePath} of "").
 */
export function withholdSecretFileContent(tc: ToolCall): boolean {
  const path = extractFilePath((tc.args ?? {}) as Record<string, unknown>) ?? "";
  if (!isSecretLikePath(path)) return false;
  tc.args = path ? { path } : undefined;
  tc.argsPreview = "";
  return true;
}

/**
 * Universal backstop (DD-26 follow-up #2): withhold secret content from every
 * built-in file-WRITE row in a transcript (top-level + each sub-agent's), across
 * BOTH harnesses, right before the status is persisted.
 *
 * This is the ONLY guarantee that survives `spec.auto_approve_all`, where the
 * approval gate / deny-gate is never installed, so no per-harness hard-block runs
 * — yet a secret write still flows and its content lands on the streamed row. It
 * is a no-op in capture mode (the flowed rows are already content-less after
 * {@link stampFileEditRow}, which shares {@link withholdSecretFileContent}), and
 * is the deny-gate analog of the capture-mode stamping pass, which does not run
 * when there is no change set. Scoped to `write` (FILE_WRITE/FILE_EDIT) because a
 * delete carries no content.
 */
export function withholdSecretContentFromMessages(
  messages: readonly AgentMessage[],
  subAgents?: readonly SubAgentExecution[],
): void {
  for (const msg of messages) {
    for (const tc of msg.toolCalls) {
      if (toolApprovalCategory(tc.name) === "write") {
        withholdSecretFileContent(tc);
      }
    }
  }
  for (const sa of subAgents ?? []) {
    withholdSecretContentFromMessages(sa.messages);
  }
}

/**
 * Collapse a tool-call row to the hidden shape the SDK renders as absent: a
 * SKIPPED row with no approval state, result, error, preview, or args.
 * Idempotent (re-running yields the same shape).
 *
 * `args` is cleared, not just `args_preview`. A hidden row is redundant with the
 * `file_change_set` (the single review surface), so its content must not linger
 * anywhere: for a file-mutating tool `args` holds the full write body, which for
 * a secret-like path would otherwise persist into the transcript / Temporal
 * history in violation of the never-persist-secret-contents contract (design
 * doc 12, D4). Dropping it is safe at resume — identity is carried by
 * `approval_content_digest`, deliberately immune to `args` being absent (the
 * size-limit elision already drops `args`); no consumer reads a hidden row's
 * `args`.
 */
export function hideToolCallRow(tc: ToolCall): void {
  tc.status = ToolCallStatus.TOOL_CALL_SKIPPED;
  tc.requiresApproval = false;
  tc.approvalRequestedAt = "";
  tc.approvalMessage = "";
  tc.error = "";
  tc.result = "";
  tc.argsPreview = "";
  tc.args = undefined;
  if (!tc.completedAt) tc.completedAt = utcTimestamp();
}

/**
 * Whether a tool-call row is already collapsed/hidden (the SDK's absent-row
 * predicate). Used to keep {@link hideToolCallRow} idempotent across re-persists
 * and activity retries.
 */
export function isToolCallRowHidden(tc: ToolCall): boolean {
  return (
    tc.status === ToolCallStatus.TOOL_CALL_SKIPPED &&
    !tc.requiresApproval &&
    tc.args === undefined &&
    !tc.result &&
    !tc.error
  );
}

/**
 * Collect every tool-call id present in a set of sub-agent executions.
 *
 * Used by both harnesses to snapshot, BEFORE a turn's stream, the sub-agent
 * tool-call ids that already existed — so the turn-boundary stamp can scope
 * itself to rows CREATED this turn (a tool-call id absent from the snapshot).
 *
 * Why tool-call-id novelty is the current-turn signal for sub-agent rows (and
 * not the `{unstamped}` heuristic the top-level pass uses): a top-level flowed
 * edit row is guaranteed to be from this turn because prior turns' rows are
 * either already stamped or hidden. Sub-agent rows have neither shield — before
 * sub-agent stamping existed, ALL of them are unstamped and never hidden — so a
 * naive `{unstamped}` walk would mis-attribute a resumed execution's prior
 * sub-agent rows to the current change set. Keying on tool-call-id novelty is
 * also correct for a sub-agent that spans invocations (an internal tool gate):
 * its id pre-exists on resume, but its continuation edit rows carry fresh ids
 * and stamp with the completing turn's set. It is likewise independent of how
 * each harness seeds prior sub-agents (deep-agent replaces per-turn and holds
 * none; Cursor clones them in) — the snapshot reflects whatever is present.
 */
export function collectSubAgentToolCallIds(
  subAgents: readonly SubAgentExecution[],
): Set<string> {
  const ids = new Set<string>();
  for (const sa of subAgents) {
    for (const msg of sa.messages) {
      for (const tc of msg.toolCalls) ids.add(tc.id);
    }
  }
  return ids;
}

/** Terminal tool-call statuses — a row that has finished (however it finished). */
const TERMINAL_TOOL_CALL_STATUSES: ReadonlySet<ToolCallStatus> = new Set([
  ToolCallStatus.TOOL_CALL_COMPLETED,
  ToolCallStatus.TOOL_CALL_FAILED,
  ToolCallStatus.TOOL_CALL_SKIPPED,
]);

/**
 * Collect the ids of tool-call rows that have already SETTLED (reached a terminal
 * state: completed, failed, or skipped) in a transcript.
 *
 * The deep-agent turn-boundary provenance derivation (DD-28) snapshots this
 * BEFORE a turn's stream to scope "this turn's tool calls" by identity: a call
 * whose id is absent from the snapshot is this-turn's — either freshly streamed,
 * or a prior gate that was WAITING_APPROVAL before the stream and executes now on
 * resume (StatusBuilder updates the seeded row in place, so it keeps its id).
 * Unlike the Cursor harness, the deep-agent cannot scope positionally — an
 * approved command executes at its SEEDED position — so identity is the only
 * correct scope, mirroring {@link collectSubAgentToolCallIds}. Terminal (not just
 * completed) so a PRIOR turn's failed/skipped non-shell call is excluded and
 * cannot spuriously disqualify this turn.
 */
export function collectSettledToolCallIds(
  messages: readonly AgentMessage[],
): Set<string> {
  const ids = new Set<string>();
  for (const msg of messages) {
    for (const tc of msg.toolCalls) {
      if (TERMINAL_TOOL_CALL_STATUSES.has(tc.status)) ids.add(tc.id);
    }
  }
  return ids;
}
