/**
 * The Cursor harness's boundary rows — the post-stream settlements that turn
 * the deny-and-retry primitive's evidence into transcript rows the runtime's
 * review surfaces read: the denial overlay (a hook-denied call becomes the
 * turn's one WAITING_APPROVAL gate), the same-identity twin collapse, the
 * one-gate-per-turn collapse of non-anchor denials, the provisional-narration
 * redaction, the #205 foreign-hook-block detector, the #965 unresolved-row
 * settle, and the unattended-mode SKIPPED stamp.
 *
 * Moved verbatim from the boundary half of `message-translator.ts` at S4 M4
 * B2 (Q-S4-13), so that module's folding half — the `MessageAccumulator`, the
 * second copy of the transcript folding rule — can be deleted whole at the
 * swap (B4) and replaced by `translator.ts` over the shared
 * `TranscriptBuilder`. Nothing here folds engine events: every function
 * AMENDS rows the stream already created, by identity (the token the hook and
 * the runner share); the one row this module ever needs CREATED — the gate for
 * a denial no streamed call matched — and the one it REOPENS — the streamed
 * call the hook denied — go through the shared `TranscriptBuilder` as
 * `approval_proposed`, the one post-stream fact both harnesses produce
 * (Q-S4-3(e), Q-S4-20; B4). `isTerminalToolStatus` below is the twin
 * collapse's own settled set (`shared/tool-row.ts` explains why INTERRUPTED is
 * not in it).
 *
 * The identity this module correlates on lives in `approval-state.ts`
 * (`toolCallIdentityToken` beside `toolIdentity`/`primaryToken`, the same
 * space the hook records denials in); the row predicates it shares with the
 * runtime (`isAdjudicatedRow`, `isDeclinedRow`) in `shared/tool-row.ts`.
 * The pipeline that calls these, and its ordering rationale, is
 * `turn-boundary.ts`.
 */

import type { AgentMessage, ToolCall } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import type { SubAgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/subagent_pb";
import { ApprovalPolicySource, MessageType, ToolCallStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { TranscriptBuilder } from "../../harness/transcript/builder.js";
import type { MergedToolPolicy } from "./approval-policy.js";
import { lookupMcpToolPolicy, resolveApprovalMessage, getBuiltInApprovalMessage } from "./approval-policy.js";
import {
  POLICY_ENGINE_VERSION,
  resolveApprovalProvenance,
  unattendedSkipMessage,
} from "../../shared/approval-policy.js";
import {
  approvalDenials,
  decodeIdentityToken,
  denialKindOf,
  grantToken,
  toolCallArgs,
  toolCallIdentityToken,
  toolIdentity,
  type DeniedLedgerEntry,
} from "./approval-state.js";
import { utcTimestamp } from "../../shared/status.js";
import { hideToolCallRow, isAdjudicatedRow, isToolCallRowHidden } from "../../shared/tool-row.js";
import { toolApprovalCategory, type ToolApprovalCategory } from "../../shared/tool-kind.js";
import { resolveWorkspacePath } from "../../shared/file-change.js";
import { contentDigest, extractFilePath } from "../../shared/file-tools.js";
import { isSecretLikePath } from "../../shared/filereview/secret-paths.js";
import type { WorkspaceBackend } from "../../shared/workspace/types.js";

/** Shared empty set so a synthesized gate's provenance read allocates nothing. */
const NO_LEASED_CATEGORIES: ReadonlySet<ToolApprovalCategory> = new Set();

/**
 * Terminal for the twin collapse's "prefer a settled representative" pick —
 * the same set the merge guard used (`isSettled` in the shared builder):
 * INTERRUPTED is deliberately NOT here; see `shared/tool-row.ts`.
 */
function isTerminalToolStatus(status: ToolCallStatus): boolean {
  return (
    status === ToolCallStatus.TOOL_CALL_COMPLETED ||
    status === ToolCallStatus.TOOL_CALL_FAILED ||
    status === ToolCallStatus.TOOL_CALL_SKIPPED
  );
}

/**
 * Reconcile the denial ledger written by the preToolUse hook against the tool
 * calls accumulated from the stream, marking each denied call as
 * WAITING_APPROVAL.
 *
 * This is the cursor analog of the native harness synthesizing WAITING_APPROVAL
 * tool calls from LangGraph interrupts (execute-deep-agent/turn-settle.ts). The hook
 * ledger — not the SDK-reported tool status — is the authoritative record of
 * what was gated, because the hook is the only component that makes the per-call
 * allow/deny decision. The backend then projects pending_approvals from these
 * WAITING_APPROVAL tool calls (PendingApprovalComputer), so the approval surface
 * is driven entirely by tool-call status, exactly like the native harness.
 *
 * Correlation is by tool identity token (the same space as approvedGrantTokens),
 * not by call id: a denied tool's identity is stable, and a single resource
 * approved once should produce one approval regardless of how many times the
 * agent re-attempted it within the turn.
 *
 * ONE GATE PER TURN (deny-only clean pause). The Cursor harness can only gate by
 * the hook returning `deny`, which Cursor surfaces to the model as a tool
 * *failure* — so a blocked model frequently improvises a workaround (the
 * canonical case: a denied `edit notes.md` followed ~2.5s later by a
 * `shell: cat > notes.md`, in the SAME assistant message with no narration
 * between them — observed in production, exec aex_01kw4p0cqgk0j8vvxbs5t8gv59).
 * The first-denial stop (index.ts) tries to cancel the turn at that first
 * denial, but `run.cancel()` is async and races the SDK's auto-execution, so the
 * workaround can still stream and land a SECOND denial in the ledger. Two
 * denials of distinct identity would otherwise surface two approval cards for
 * one logical intent. Their identities differ (`write\nnotes.md` vs
 * `shell\ncat > notes.md`), so no same-identity twin collapse can join them, and
 * they share one message, so no positional rule can separate them; the only
 * honest signal that the second is a reaction is CAUSALITY — it was emitted
 * after the model saw the first denial. We therefore ANCHOR on the FIRST ledger
 * denial of the turn (the ledger is reset per turn and appended in denial order,
 * so ledger[0] is the original intent) and surface ONLY that identity. Every
 * other denied identity in the turn — a post-denial workaround, or a genuine
 * co-pending sibling the deny-only harness defers — is blanked in place to a
 * hidden SKIPPED row ({@link collapseNonAnchorDenials}). A deferred sibling is
 * not lost: on resume it re-attempts and gates again next turn (sequential
 * gating). The native (LangGraph) harness pauses BEFORE the model can react, so
 * it keeps full in-turn co-pending and is untouched by this rule. This is the
 * near-term, invariant-preserving stepping stone to the Tool Execution Gateway,
 * where an un-leased workaround is refused by construction.
 *
 * Correlation runs in two passes. The first matches the streamed token to a
 * ledger token byte-for-byte (the common case). The hook, however, records its
 * token from the RAW path Cursor hands it — a bash script cannot normalize a
 * path against the workspace root — so an ABSOLUTE hook `file_path` against a
 * RELATIVE stream `path` (or vice versa) yields two different raw tokens for one
 * edit and the exact pass misses. The runner CAN normalize, so a second pass
 * matches any still-unmatched FILE denial to a streamed call by (category,
 * workspace-normalized path) and overlays the REAL streamed call, never appending
 * a content-less placeholder beside it. This is the difference between one honest
 * gate and two cards, one of which reads "No preview available". It reuses the
 * single tool-identity definition + `resolveWorkspacePath`; it introduces no
 * parallel identity.
 *
 * Only after BOTH passes miss is a placeholder WAITING_APPROVAL tool call
 * synthesized (rare — Cursor normally emits a tool_call event for every
 * attempt), so the gate still surfaces and never renders as a silent success.
 * Critically, every match overlays a call IN PLACE (the committed id is
 * preserved): the backend's append-only-at-identity transcript guard rejects a
 * finalize that drops a previously-committed tool-call id, so reconciliation may
 * only reconcile entries in place, never remove them.
 *
 * Every matched/synthesized call is enriched with the hook-captured authoritative
 * input (`ledger.input`) via {@link applyGateInput}: the full proposed args, a
 * compact `args_preview`, and the content digest — so the approval card renders
 * the proposed write/edit content from `args` and a resume re-gates a diverging
 * sibling edit. A missing capture (the hook's grep fallback) degrades to the
 * prior behavior.
 *
 * Every gate this function opens goes through the transcript builder as an
 * `approval_proposed` (S4 M4 B4; Q-S4-3(e), Q-S4-20): a known row REOPENS
 * (WAITING, the outcome the stream wrote cleared, the hook's captured input as
 * its args and preview), an unknown one gets a WAITING row on the message
 * whose text proposed it. The builder is the one writer of a WAITING row on
 * both harnesses; this module supplies the fact and reads the row back.
 *
 * Returns the tool calls now marked WAITING_APPROVAL — the single anchor gate
 * for the turn (overlaid or, rarely, synthesized).
 */
export async function reconcileDeniedToolCalls(
  transcript: TranscriptBuilder,
  ledger: DeniedLedgerEntry[],
  mergedPolicies?: ReadonlyMap<string, MergedToolPolicy>,
  workspaceBackend?: WorkspaceBackend,
): Promise<ToolCall[]> {
  const messages = transcript.currentStatus.messages;
  // Defense-in-depth: only APPROVAL-kind denials may become approval gates.
  // The turn boundary already passes the filtered subset; re-filtering here
  // makes it structurally impossible for a secret/capture-error/fail-closed
  // entry to manufacture a pause the user cannot meaningfully grant, no matter
  // what a future caller passes (an absent kind is the pre-kind format and
  // counts as approval).
  ledger = approvalDenials(ledger);
  if (ledger.length === 0) return [];

  // The workspace the gated files live in; its rootDir normalizes paths for the
  // abs-vs-rel correlation fallback (normalizedFileSalient).
  const workspaceRoot = workspaceBackend?.rootDir;

  // One gate per turn: anchor on the FIRST ledger denial. The ledger is reset
  // per turn and appended in denial order, so ledger[0] is the model's original
  // intent; any later denial of a DIFFERENT identity is a post-denial workaround
  // or a deferred co-pending sibling (see the doc comment). We surface ONLY the
  // anchor identity below and blank every other denied identity to a hidden
  // SKIPPED row. `deniedTokens` still carries every denied identity — it is the
  // scope for that collapse, never an additional gate.
  const anchorToken = ledger[0].token;
  const deniedTokens = new Set(ledger.map((e) => e.token));
  // The authoritative pre-execution args the hook captured for the anchor. A
  // resource re-attempted within the turn shares a token; last write wins (the
  // attempts carry the same proposed change).
  let anchorInput: Record<string, unknown> | undefined;
  for (const e of ledger) {
    if (e.token === anchorToken && e.input) anchorInput = e.input;
  }
  const matchedCalls = new Set<ToolCall>();
  const result: ToolCall[] = [];
  let anchorMatched = false;

  // 1. Exact overlay: a streamed call whose token equals the anchor denial token
  //    byte-for-byte (the path form agreed on both sides). The anchor resource
  //    re-attempted within the turn shares one token and collapses to a single
  //    approval (the first match is the keeper; same-identity twins are blanked
  //    by collapseRedundantToolCallTwins below). A row an earlier invocation's
  //    gate already settled is never the home of THIS turn's denial
  //    (isAdjudicatedRow) — the search moves past it to this turn's attempt.
  for (const msg of messages) {
    if (anchorMatched) break;
    for (const tc of msg.toolCalls) {
      if (isAdjudicatedRow(tc)) continue;
      if (toolCallIdentityToken(tc) !== anchorToken) continue;
      proposeOnStreamedRow(transcript, tc, anchorInput, mergedPolicies);
      matchedCalls.add(tc);
      result.push(tc);
      anchorMatched = true;
      break;
    }
  }

  // 2. Normalized-path fallback (the abs-vs-rel drift fix): if the anchor is a
  //    FILE denial the exact pass missed, match a streamed call by (category,
  //    workspace-normalized path) and overlay the REAL call — never a content-
  //    less placeholder beside it. Requires the workspace root to normalize;
  //    shell/MCP denials (no path) and resumes without a root fall through to
  //    synthesis.
  if (!anchorMatched && workspaceRoot) {
    const decoded = decodeIdentityToken(anchorToken);
    const wanted = decoded
      ? normalizedFileSalient(decoded.key, decoded.salient, workspaceRoot)
      : undefined;
    if (wanted) {
      const tc = findUnmatchedStreamCallByNormalizedSalient(
        messages, matchedCalls, wanted, workspaceRoot,
      );
      if (tc) {
        proposeOnStreamedRow(transcript, tc, anchorInput, mergedPolicies);
        matchedCalls.add(tc);
        result.push(tc);
        anchorMatched = true;
      }
    }
  }

  // 2a. One gate per turn: blank every denied identity OTHER than the anchor to a
  //     hidden SKIPPED row (the workaround shell, or a deferred co-pending
  //     sibling). Runs BEFORE the WAITING_FOR_APPROVAL persist so a reaction is
  //     never persisted as WAITING_APPROVAL — the backend authors an approval
  //     REQUESTED event only from a WAITING_APPROVAL tool call, so collapsing
  //     here keeps the append-only approval-event stream free of an orphan
  //     REQUESTED that would need retraction.
  const nonAnchorCollapsed = collapseNonAnchorDenials(messages, deniedTokens, anchorToken);
  if (nonAnchorCollapsed > 0) {
    console.log(
      `ExecuteCursor reconcile collapsed ${nonAnchorCollapsed} non-anchor denied ` +
        `tool call(s) to hidden SKIPPED (one gate per turn; anchor is the first ` +
        `denial of the turn)`,
    );
  }

  // 2b. Collapse same-turn duplicate edits. When the model emitted the SAME
  //     resource twice in one turn (two call ids, one identity token), only the
  //     FIRST same-token stream call was overlaid into the gate above; any OTHER
  //     same-token call stays a committed row (RUNNING zombie, or a
  //     denied-reported-as-success COMPLETED) that would render as a second,
  //     content-less card beside the gate (the reported "No preview available"
  //     duplicate). The overlaid gate is now WAITING_APPROVAL, so the shared
  //     routine recognizes it as the keeper and blanks the twins IN PLACE to
  //     hidden SKIPPED rows — we cannot drop them, since the backend's
  //     append-only-at-identity guard rejects removing a previously-committed
  //     tool-call id, but the id is preserved so the finalize stays append-only.
  const collapsed = collapseRedundantToolCallTwins(messages);
  if (collapsed > 0) {
    console.log(
      `ExecuteCursor reconcile collapsed ${collapsed} redundant tool-call twin(s) ` +
        `superseded by the approval gate (kept in place as hidden SKIPPED rows)`,
    );
  }

  // 2c. Finalize interrupted rows. The first-denial stop cancelled the run, so
  //     a tool call still PENDING/RUNNING here can never complete — no event
  //     will ever deliver its result, and left alone it persists as a spinner
  //     forever. The canonical victim is a post-denial workaround whose own
  //     hook denial raced (or never reached) the final ledger read, so the
  //     token-scoped collapse in 2a could not see it (production case
  //     aex_01kwj07f7g23c3wp9sn8496z5g: a python-write shell reaction persisted
  //     as RUNNING with requiresApproval=true). Whatever the cause, a
  //     non-terminal row on a turn that is pausing is an interrupted attempt
  //     with no output: collapse it to the same hidden SKIPPED shape as every
  //     other superseded row (in place — the append-only-at-identity guard
  //     forbids dropping a committed id). Runs AFTER the anchor overlay, so the
  //     gate itself (now WAITING_APPROVAL) is never touched.
  const interrupted = finalizeInterruptedToolCalls(messages);
  if (interrupted > 0) {
    console.log(
      `ExecuteCursor reconcile collapsed ${interrupted} interrupted non-terminal ` +
        `tool call(s) that can never complete (run cancelled at first denial)`,
    );
  }

  // 3. Synthesize the anchor gate if it matched NO streamed call in either pass
  //    (rare — Cursor emits a tool_call event for every attempt), so the gate
  //    still surfaces rather than rendering as a silent success. After the
  //    normalized fallback this should be ~0; the caller logs a divergence when
  //    it is not (a synthesized id is prefixed `approval:`). Only the anchor is
  //    ever synthesized: non-anchor denials are deliberately collapsed, never
  //    surfaced (one gate per turn).
  if (!anchorMatched) {
    const anchorEntry = ledger.find((e) => e.token === anchorToken) ?? ledger[0];
    const decoded = decodeIdentityToken(anchorToken);
    // Display the hook's raw tool name; carry the decoded salient so the grant
    // rebuilt from this tool call on reinvocation keys on the same resource.
    const displayName = anchorEntry.toolName || decoded?.key || "tool";
    const salient = decoded?.salient ?? "";
    const tc = proposeSynthesizedGate(transcript, {
      displayName,
      salient,
      digest: decoded?.digest ?? "",
      token: anchorToken,
      input: anchorInput ?? anchorEntry.input,
      mergedPolicies,
    });
    result.push(tc);
  }

  return result;
}

/**
 * Propose the gate ON a streamed tool call the hook denied: the row REOPENS
 * WAITING through the builder and keeps its committed id, so the backend's
 * append-only-at-identity transcript guard accepts the finalize (an in-place
 * status change is a reconcile, not a drop). The single routine for both the
 * exact and the normalized correlation passes, so the gate can never diverge
 * between them. The message is the one the stream already stamped when the
 * policy gated the call, else resolved now; the hook-captured `input` (when
 * present) is the authoritative, complete proposed args — the stream may have
 * carried only partial args before the first-denial cancel — and supplies the
 * args, the preview and the content digest (see {@link proposalArgs}).
 */
function proposeOnStreamedRow(
  transcript: TranscriptBuilder,
  tc: ToolCall,
  input: Record<string, unknown> | undefined,
  mergedPolicies: ReadonlyMap<string, MergedToolPolicy> | undefined,
): void {
  const args = proposalArgs(input);
  transcript.apply({
    kind: "approval_proposed",
    callId: tc.id,
    name: tc.name,
    mcpServerSlug: tc.mcpServerSlug,
    message: tc.approvalMessage || resolveDeniedApprovalMessage(tc.name, tc.mcpServerSlug, toolCallArgs(tc), mergedPolicies),
    ...(args !== undefined ? { args, contentDigest: contentDigest(args) } : {}),
  });
}

/**
 * Propose the gate for a denial that matched NO streamed call: a WAITING row
 * with a synthesized id (`approval:<token>`) on the message whose text proposed
 * it. It displays the hook's raw tool name and carries the decoded salient as
 * its args (so the grant rebuilt from it on reinvocation keys on the same
 * resource) and the anchor's content digest (so its identity equals the
 * anchor's content token); the hook-captured input, when present, upgrades
 * both to the full proposed change. A synthesized call is a ledger denial — it
 * was gated, so it has a governing layer, and a denied call never occurs under
 * a global bypass or a matching lease, so empty leases + no bypass attribute
 * it faithfully (a built-in resolves to builtin_category; an MCP placeholder
 * lacks a reconstructed slug and stays UNSPECIFIED rather than be mislabeled).
 */
function proposeSynthesizedGate(
  transcript: TranscriptBuilder,
  gate: {
    displayName: string;
    salient: string;
    digest: string;
    token: string;
    input: Record<string, unknown> | undefined;
    mergedPolicies: ReadonlyMap<string, MergedToolPolicy> | undefined;
  },
): ToolCall {
  const { displayName, salient, digest, token, input, mergedPolicies } = gate;
  const callId = `approval:${token}`;
  const captured = proposalArgs(input);
  const args = captured ?? (salient ? { path: salient } : undefined);
  const provenance = mergedPolicies
    ? resolveApprovalProvenance(displayName, "", mergedPolicies, NO_LEASED_CATEGORIES, false)
    : undefined;
  transcript.apply({
    kind: "approval_proposed",
    callId,
    name: displayName,
    mcpServerSlug: "",
    message: salient
      ? `Tool requires approval: ${displayName} (${salient})`
      : resolveDeniedApprovalMessage(displayName, "", {}, mergedPolicies),
    ...(args !== undefined ? { args } : {}),
    ...(provenance !== undefined ? { provenance } : {}),
    contentDigest: captured ? contentDigest(captured) : digest,
  });
  const row = findToolCallById(transcript.currentStatus.messages, callId);
  if (!row) throw new Error(`reconcileDeniedToolCalls: the builder did not create the proposed row ${callId}`);
  return row;
}

/** The last row with this id in the root transcript (the builder appends; a synthesized gate is always the newest). */
function findToolCallById(messages: readonly AgentMessage[], id: string): ToolCall | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const found = messages[i].toolCalls.find((tc) => tc.id === id);
    if (found) return found;
  }
  return undefined;
}

/**
 * Collapse every tool call still in a non-terminal state (PENDING / RUNNING)
 * to the hidden SKIPPED row shape, returning how many were collapsed.
 *
 * Called only on the pause-for-approval path, after the anchor gate has been
 * overlaid to WAITING_APPROVAL: the run was cancelled, so nothing will ever
 * complete these calls, and a permanently-RUNNING row would render as an
 * eternal spinner beside the approval card. This is the causality sibling of
 * {@link collapseNonAnchorDenials}: that collapse is token-scoped (it needs the
 * denial in the ledger), while this one catches the attempt whose hook denial
 * raced the final ledger read or whose execution the cancel interrupted
 * outright — either way an attempt with no output that the turn's end orphaned.
 */
function finalizeInterruptedToolCalls(messages: AgentMessage[]): number {
  let finalized = 0;
  for (const msg of messages) {
    for (const tc of msg.toolCalls) {
      if (
        tc.status !== ToolCallStatus.TOOL_CALL_PENDING &&
        tc.status !== ToolCallStatus.TOOL_CALL_RUNNING
      ) {
        continue;
      }
      hideToolCallRow(tc);
      finalized++;
    }
  }
  return finalized;
}

/**
 * Recognizes a tool call already blanked to a hidden collapsed row, so a second
 * pass never re-collapses it (and never miscounts). Mirrors the SDK's
 * `isCollapsedToolCall` shape without importing across the runner/SDK seam.
 */
function isAlreadyCollapsed(tc: ToolCall): boolean {
  return (
    tc.status === ToolCallStatus.TOOL_CALL_SKIPPED &&
    !tc.requiresApproval &&
    !tc.result &&
    !tc.error &&
    !tc.argsPreview
  );
}

/**
 * Whether a tool call carries a change/output of its own — the signal that it is
 * authoritative for its resource rather than a redundant denial/cancel twin.
 *
 * The notion of "change" is category-aware on purpose:
 *  - A file mutation (`write`/`delete`) never carries an authoritative change on
 *    the tool-call ROW: under apply-then-review its review lives in the
 *    `FileChangeSet` ledger (capture mode), and under the no-storage deny-gate it
 *    is the WAITING_APPROVAL gate itself (kept explicitly by the caller). So a
 *    file row is authoritative only as that gate, never on its own — hence
 *    `false` here. (Before Phase 5 Slice 4 this read `file_changes.length > 0`;
 *    that field is gone, and the row was never the review surface.)
 *  - Every other gated tool (shell, MCP) has no ledger; its "change" is its
 *    execution output, so a genuine run carries a non-empty `result` while a
 *    denied/cancelled attempt that never executed does not. This keeps two
 *    distinct shell runs (each with output) both visible while still collapsing a
 *    same-command denial twin.
 */
function carriesOwnChange(tc: ToolCall): boolean {
  const category = toolApprovalCategory(tc.name);
  if (category === "write" || category === "delete") {
    return false;
  }
  return !!tc.result;
}

/**
 * Collapse redundant same-identity tool-call twins to a single visible row.
 *
 * The model frequently emits the SAME gated action twice in one turn (two
 * tool-call ids, one identity). When the first attempt is gated and the run is
 * cancelled mid-flight, the extra attempt never receives a terminal event and
 * persists as a stuck `RUNNING` row ("No preview available"); other variants are
 * a denied-reported-as-success `COMPLETED` with an empty result, two no-change
 * `COMPLETED` attempts where neither carries a change, or — on the denial path —
 * a `FAILED` twin beside the overlaid gate. All render as a duplicate card beside
 * the real action (or the approval gate). This is the recurring duplicate-card
 * defect, most visible for file edits but shared by every gated tool family.
 *
 * The routine is harness-agnostic and a pure function of `messages`:
 *
 * 1. Scope to GATED identities — file mutations (`write`/`delete`) and shell key
 *    on their cross-taxonomy category; MCP tools are recognized by their server
 *    slug. A same-turn duplicate of a gated tool is a denial/cancel artifact, not
 *    meaningful repetition. The category is name-derived (via {@link toolIdentity}
 *    -> approvalCategory), so a twin cancelled before classification (empty
 *    `toolKind`) is still scoped via its name (`edit` -> `write`). Ungated
 *    read-only tools are left untouched.
 * 2. Group those calls by `toolCallIdentityToken` — the SAME `toolIdentity` used
 *    for denial correlation and resume grants, so scope and grouping cannot drift.
 * 3. In each group the keepers carry authoritative state — a change/output of
 *    their own (see {@link carriesOwnChange}) or the approval gate itself
 *    (`WAITING_APPROVAL`). For a file mutation the gate is the sole authoritative
 *    row: the row carries no diff (review lives in the `FileChangeSet` ledger, or
 *    is the no-storage deny-gate itself), so a denied write's same-identity
 *    siblings — a denied/zombie row or a stale snapshot from a second attempt —
 *    collapse onto the gate. A shell/MCP twin keeps every distinct run with
 *    output. If NO member qualifies (every attempt produced no change), keep
 *    exactly ONE representative — preferring a terminal attempt over a stuck
 *    `RUNNING` zombie — so the resource still shows a single card. Every
 *    non-keeper is blanked in place to a hidden `SKIPPED` row (see
 *    {@link collapseDenialTwin}).
 *
 * It is deliberately subtractive — it only ever HIDES a row, never invents a
 * terminal state. The committed `id` is preserved on every collapse, so the
 * finalize stays append-only by construction and the backend's
 * append-only-at-identity guard accepts it. Returns the number collapsed, for
 * observability.
 */
export function collapseRedundantToolCallTwins(messages: AgentMessage[]): number {
  const groups = new Map<string, ToolCall[]>();
  for (const msg of messages) {
    for (const tc of msg.toolCalls) {
      const id = toolIdentity(tc.name, tc.mcpServerSlug, toolCallArgs(tc));
      const gated = tc.mcpServerSlug
        ? true
        : id.key === "write" || id.key === "delete" || id.key === "shell";
      if (!gated) continue;
      const token = grantToken(id.key, id.salient);
      const bucket = groups.get(token);
      if (bucket) bucket.push(tc);
      else groups.set(token, [tc]);
    }
  }

  let collapsed = 0;
  for (const group of groups.values()) {
    if (group.length < 2) continue; // a lone call is never a twin

    // Keepers carry authoritative state: a change/output of their own
    // (carriesOwnChange), the approval gate itself, or a gate an earlier
    // invocation already settled (isAdjudicatedRow — the transcript's record of
    // what the user decided and what ran; a same-identity act in a later turn
    // is a new act, never this row's twin). For a file mutation the gate is the
    // sole authoritative row (the row carries no diff — review lives in the
    // ledger, or the row IS the no-storage deny-gate), so a denied write's
    // same-identity siblings collapse onto it; a shell/MCP twin keeps every
    // distinct run with output.
    const keepers = new Set<ToolCall>(
      group.filter(
        (tc) =>
          carriesOwnChange(tc) ||
          isAdjudicatedRow(tc) ||
          tc.status === ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
      ),
    );
    // All attempts produced no change (e.g. denied-reported-as-success): keep one
    // representative, preferring a settled outcome over a stuck RUNNING zombie.
    if (keepers.size === 0) {
      const terminal = [...group].reverse().find((tc) => isTerminalToolStatus(tc.status));
      keepers.add(terminal ?? group[0]);
    }

    for (const tc of group) {
      if (keepers.has(tc)) continue;
      if (isAlreadyCollapsed(tc)) continue;
      collapseDenialTwin(tc);
      collapsed++;
    }
  }
  return collapsed;
}

/**
 * One gate per turn: blank every DENIED tool call whose identity differs from
 * the anchor (the first denial of the turn) to a hidden SKIPPED row.
 *
 * This is the cross-identity complement of {@link collapseRedundantToolCallTwins}
 * (which only joins SAME-identity duplicates). The canonical target is the
 * deny-only workaround — a denied `edit notes.md` followed by a `shell:
 * cat > notes.md` whose identity (`shell\n…`) differs from the edit's
 * (`write\nnotes.md`), so no twin collapse can join them and (since they share
 * one assistant message) no positional rule can separate them. The honest signal
 * that the shell is redundant is that it is a DIFFERENT denied identity in the
 * same turn as the anchor; under the one-gate-per-turn contract every such
 * identity is either a post-denial reaction or a co-pending sibling the harness
 * defers to the next turn, so it is hidden, not surfaced.
 *
 * Scoped strictly to identities present in `deniedTokens`: a non-denied tool
 * (an earlier read/glob, or an already-granted call that ran) is never touched.
 * Subtractive and id-preserving (via {@link collapseDenialTwin}), so the finalize
 * stays append-only. Returns the number collapsed, for observability.
 */
function collapseNonAnchorDenials(
  messages: AgentMessage[],
  deniedTokens: ReadonlySet<string>,
  anchorToken: string,
): number {
  let collapsed = 0;
  for (const msg of messages) {
    for (const tc of msg.toolCalls) {
      if (isAdjudicatedRow(tc)) continue;
      const token = toolCallIdentityToken(tc);
      if (token === anchorToken) continue;
      if (!deniedTokens.has(token)) continue;
      if (isAlreadyCollapsed(tc)) continue;
      collapseDenialTwin(tc);
      collapsed++;
    }
  }
  return collapsed;
}

/**
 * Blank a superseded denial twin in place to a hidden SKIPPED row. Keeps the
 * committed `id` (append-only), `name`, and `toolKind`; clears every renderable
 * surface and the approval flags so the SDK's `isCollapsedToolCall` predicate
 * recognizes it and renders nothing. The structured `args` are left as the honest
 * stored record of the redundant attempt (never rendered, since the row is
 * hidden; the gate carries the authoritative proposed change).
 */
function collapseDenialTwin(tc: ToolCall): void {
  hideToolCallRow(tc);
}

// `hideToolCallRow` (the "hidden row" shape, shared by the denial-twin collapse
// and the capture flow) lives in shared/tool-row.ts so both harnesses collapse
// rows identically; imported at the top of this module.

/**
 * The hook-captured authoritative tool input as a proposal's args, so the
 * approval card can show the proposed change before the user approves.
 *
 * When present it becomes the single source for the preview: the full
 * structured `args` (the approval card renders the proposed write/edit content
 * from these), the compact-but-always-valid `args_preview` the builder derives
 * from them (the field a resumed turn parses to rebuild the grant salient — so
 * salient fields are never elided), and the content digest the caller stamps
 * beside them. The digest is the resume identity: it binds the grant to
 * (category, path, content) so a sibling edit to the same file re-gates rather
 * than riding an earlier approval through. It is also the identity the Cursor
 * deny-gate's exact-apply reads on resume — together with the whole-file bytes
 * in `args` — to write exactly what was approved (see exact-apply.ts). There is
 * no separate captured `file_changes` mirror; `args` is the single source for
 * both the preview and the applied bytes.
 *
 * Defense-in-depth (DD-26 #2): a secret-like write's content never reaches the
 * persisted approval preview. Normally unreachable — the hook hard-blocks a
 * secret write and records no ledger input — but if a hook classify failure
 * fell one through, its content must still never reach args/args_preview; the
 * Invariant-A backstop is the final net, this closes the path at the source.
 * With no input (the hook's grep fallback) there is nothing authoritative and
 * the row keeps its existing args.
 */
function proposalArgs(input: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!input) return undefined;
  const gatePath = extractFilePath(input);
  if (gatePath !== null && isSecretLikePath(gatePath)) return undefined;
  return input;
}

/**
 * The workspace-normalized identity of a FILE approval category's salient, or
 * undefined for a non-file category (shell, whose salient is a command, not a
 * path) or an empty salient. Both the hook-decoded denial salient and a streamed
 * call's salient pass through this, so an absolute-vs-relative path difference
 * collapses to one comparable key (`category + "\n" + relPath`). Restricting to
 * write/delete keeps a shell command from being mangled by path normalization.
 */
function normalizedFileSalient(
  category: string,
  salient: string,
  workspaceRoot: string,
): string | undefined {
  if ((category !== "write" && category !== "delete") || !salient) return undefined;
  const { path } = resolveWorkspacePath(salient, workspaceRoot, /* virtualRoot */ false);
  return `${category}\n${path}`;
}

/**
 * Find the first not-yet-overlaid streamed tool call whose workspace-normalized
 * (category, path) equals `wanted`. Skips calls already claimed by an earlier
 * denial so several concurrent file denials each overlay a distinct stream call.
 */
function findUnmatchedStreamCallByNormalizedSalient(
  messages: AgentMessage[],
  matchedCalls: ReadonlySet<ToolCall>,
  wanted: string,
  workspaceRoot: string,
): ToolCall | undefined {
  for (const msg of messages) {
    for (const tc of msg.toolCalls) {
      if (matchedCalls.has(tc) || isAdjudicatedRow(tc)) continue;
      const id = toolIdentity(tc.name, tc.mcpServerSlug, toolCallArgs(tc));
      if (normalizedFileSalient(id.key, id.salient, workspaceRoot) === wanted) {
        return tc;
      }
    }
  }
  return undefined;
}

/**
 * Redact provisional post-denial narration when a Cursor turn pauses for approval.
 *
 * THE PROBLEM. Unlike the native harness — which gates with a LangGraph
 * `interrupt()` *before* the tool runs, so the model never sees a denial — the
 * Cursor harness can only gate via the file-based `beforeMCPExecution`/
 * `preToolUse` hook returning `deny`. Cursor surfaces that deny to the model as
 * a tool *failure* (often its own generic "blocked by a hook" text; see the
 * Phase 0 ground-truth capture in cursor_hitl_test.go), and there is no
 * non-leaky SDK approval primitive to use instead (the `request` event is
 * opaque and carries no responder). So a well-behaved model frequently reacts by
 * narrating defeat — "I couldn't do this; enable the hook in your Cursor
 * settings" — which would otherwise be persisted as the assistant's verdict and
 * rendered right next to the approval card that is, in fact, asking the user to
 * approve. Contradictory and alarming.
 *
 * THE GUARANTEE. The runner's job is to simplify this data, not mirror its
 * complexity: a turn that pauses for approval must read the SAME shape the
 * native harness produces — `[pre-tool text][tool calls WAITING_APPROVAL]`, with
 * no post-denial verdict. We therefore BLANK (clear the `content` of, and mark
 * non-streaming) the trailing assistant/thinking messages that (a) appear
 * positionally AFTER the last message bearing a WAITING_APPROVAL tool call and
 * (b) carry no tool calls of their own. The approval card (projected from the
 * WAITING_APPROVAL tool-call status) becomes the single, unambiguous source of
 * truth. The blanked messages are already invisible on every surface via the
 * existing empty-message handling (`buildThreadItems` skips empty `MESSAGE_AI`;
 * `MessageEntry` renders nothing for empty `MESSAGE_THINKING`), so the shared
 * `@stigmer/react`/Ink components stay harness-agnostic with zero per-harness UI
 * special-casing — the cleanliness lives in the data, not in each consumer.
 *
 * WHY BLANK INSTEAD OF REMOVE. Removing the messages would make the persisted
 * WAITING_FOR_APPROVAL transcript SHORTER than the in-progress transcript the
 * runner already streamed. The backend's append-only message guard rejects a
 * shrink for a non-terminal execution (it protects against regressed/partial
 * writes). Blanking keeps the message COUNT identical, so the finalize is
 * append-only BY CONSTRUCTION and the guard accepts it with no special case —
 * which is why this phase deletes the backend's former `isApprovalFinalize`
 * shrink exception in both editions. The transcript is the authoritative *raw*
 * record; the verbatim narration text remains recoverable from the runner logs
 * and the recorded cursor-event stream.
 *
 * WHY THIS IS DETERMINISTIC. `attachToolCallToLastAi` calls
 * `finalizeStreaming(run_id)` before attaching a tool call, so any assistant
 * text the model emits *after* the denied tool call always starts a NEW message
 * — post-denial narration is never merged into the message that holds the gated
 * call. We stop at the first non-narration message — one bearing a VISIBLE tool
 * call — so legitimately-executed tools after the gate and any text around them
 * are never touched; only the contiguous trailing reaction block is blanked. A
 * message whose every tool call was collapsed to the hidden SKIPPED row (a
 * post-denial workaround or an interrupted attempt — see
 * collapseNonAnchorDenials / finalizeInterruptedToolCalls, which run first) IS
 * trailing narration: its rows render as absent, so only its text remains, and
 * that text is precisely the reaction this redaction exists to blank. Treating
 * it as a stop would strand every reaction message behind it (the production
 * shape in aex_01kwj07f7g23c3wp9sn8496z5g: [gate][thinking][narration+workaround
 * row] — the old walk stopped at the workaround message and redacted nothing).
 * The first-denial stop in index.ts is the primary mechanism that keeps this
 * block small (it ends the turn before the model produces inter-tool
 * narration); this redaction is the backstop for any token that streamed before
 * the cancel landed.
 *
 * Returns the blanked messages (for diagnostics); mutates `messages` in place.
 */
export function clearProvisionalPostDenialNarration(
  messages: AgentMessage[],
  deniedToolCalls: ToolCall[],
): AgentMessage[] {
  if (deniedToolCalls.length === 0) return [];

  // reconcileDeniedToolCalls returns the very ToolCall protos held inside
  // messages[].toolCalls (overlaid) or appended to the last AI message
  // (synthesized), so object identity is a stable, exact match.
  const denied = new Set(deniedToolCalls);

  let lastGatedIdx = -1;
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].toolCalls.some((tc) => denied.has(tc))) {
      lastGatedIdx = i;
    }
  }
  if (lastGatedIdx < 0) return [];

  const redacted: AgentMessage[] = [];
  for (let i = messages.length - 1; i > lastGatedIdx; i--) {
    const msg = messages[i];
    const isProvisionalNarration =
      (msg.type === MessageType.MESSAGE_AI || msg.type === MessageType.MESSAGE_THINKING) &&
      msg.toolCalls.every((tc) => isToolCallRowHidden(tc));
    // Stop at the first message that is NOT trailing narration: a message
    // bearing a visible (non-collapsed) tool call marks real activity we must
    // preserve, and anything before it is no longer "trailing".
    if (!isProvisionalNarration) break;
    // Blank in place — keep the message so the transcript count never shrinks,
    // but drop its provisional content so no consumer renders the defeatist
    // verdict. Empty AI/THINKING messages are hidden by the SDK already; hidden
    // SKIPPED rows already render as absent.
    msg.content = "";
    msg.isStreaming = false;
    redacted.unshift(msg);
  }
  return redacted;
}

/**
 * Substrings of the error text Cursor stamps onto a tool call blocked by a
 * `preToolUse`/`beforeMCPExecution` hook (its generic replacement for the
 * hook's own agent_message — confirmed by the Phase 0 ground-truth capture in
 * cursor_hitl_test.go). The SDK has NO structured "denied by hook" signal, so
 * this marker family is the only stream-side trace of a hook block and is
 * single-sourced here for every consumer (the issue #205 attribution detector
 * below; tests). Matched case-insensitively against the FAILED call's error.
 */
export const HOOK_BLOCK_ERROR_MARKERS: readonly string[] = ["blocked by a hook"];

/** True when a tool call's error text reads as a hook block. */
function isHookBlockError(errorText: string): boolean {
  if (!errorText) return false;
  const lowered = errorText.toLowerCase();
  return HOOK_BLOCK_ERROR_MARKERS.some((marker) => lowered.includes(marker));
}

/** One hook-blocked tool call that no ledger entry accounts for (issue #205). */
export interface UnattributedHookBlock {
  toolCallId: string;
  toolName: string;
  /** The hook-block error text Cursor stamped on the call. */
  error: string;
}

/**
 * Detect tool calls blocked by a hook that STIGMER'S OWN hook did not deny —
 * the issue #205 invariant check "a blocked tool must never silently complete".
 *
 * Cursor runs EVERY hook registered in the workspace's `.cursor/hooks.json`
 * and a deny from any of them blocks the tool. Our hook records every deny it
 * issues to the denial ledger (all kinds — see {@link DeniedLedgerEntry}), so a
 * FAILED tool call carrying Cursor's hook-block error text with NO matching
 * ledger entry was blocked by a FOREIGN hook (a user/team `preToolUse` policy
 * hook the merge deliberately preserves) — or, equally fatally, by our own
 * hook whose best-effort ledger append failed. Either way the runner cannot
 * pause for approval (an approval grants a token only OUR hook reads; the
 * foreign hook would deny the re-attempt forever), so the caller surfaces an
 * explicit failure instead of completing with the work silently undone.
 *
 * Attribution, in order:
 *  1. Any `fail-closed` ledger entry → the gate itself was broken this turn and
 *     denied EVERYTHING it saw; per-call correlation is meaningless, so every
 *     hook block is attributed to our own (broken) gate. Nothing is reported.
 *  2. Exact identity: the call's {@link toolCallIdentityToken} appears in the
 *     ledger (any kind — approval gates were overlaid to WAITING_APPROVAL or
 *     collapsed by the reconcile that runs first, so a still-FAILED row here is
 *     typically a secret/capture-error deny, correctly attributed as ours).
 *  3. Normalized-path fallback: the same abs-vs-rel drift the reconcile's
 *     second pass handles — a FILE call matches a ledger entry by (category,
 *     workspace-normalized path) even when the raw tokens differ.
 *
 * Scoped to THIS turn's messages (from `turnStartMessageIndex`): seeded
 * prior-turn rows were already adjudicated and must never re-trigger.
 * Deliberately conservative: an ordinary tool failure (no hook-block text)
 * is never reported, and a foreign hook denying with fully custom text evades
 * the marker match (the documented residual — the install-time
 * foreignGatingHooks warning still fires for diagnosability).
 */
export function detectUnattributedHookBlocks(
  messages: readonly AgentMessage[],
  turnStartMessageIndex: number,
  ledger: readonly DeniedLedgerEntry[],
  workspaceRoot?: string,
): UnattributedHookBlock[] {
  if (ledger.some((e) => denialKindOf(e) === "fail-closed")) return [];

  const ledgerTokens = new Set(ledger.map((e) => e.token));
  const ledgerNormalizedSalients = new Set<string>();
  if (workspaceRoot) {
    for (const entry of ledger) {
      const decoded = decodeIdentityToken(entry.token);
      if (!decoded) continue;
      const normalized = normalizedFileSalient(decoded.key, decoded.salient, workspaceRoot);
      if (normalized) ledgerNormalizedSalients.add(normalized);
    }
  }

  const blocks: UnattributedHookBlock[] = [];
  for (const msg of messages.slice(Math.max(0, turnStartMessageIndex))) {
    for (const tc of msg.toolCalls) {
      if (tc.status !== ToolCallStatus.TOOL_CALL_FAILED) continue;
      if (!isHookBlockError(tc.error)) continue;
      if (ledgerTokens.has(toolCallIdentityToken(tc))) continue;
      if (workspaceRoot) {
        const id = toolIdentity(tc.name, tc.mcpServerSlug, toolCallArgs(tc));
        const normalized = normalizedFileSalient(id.key, id.salient, workspaceRoot);
        if (normalized && ledgerNormalizedSalients.has(normalized)) continue;
      }
      blocks.push({ toolCallId: tc.id, toolName: tc.name, error: tc.error });
    }
  }
  return blocks;
}

/**
 * The honest terminal error stamped on a tool call that never resolved (issue
 * #965). Deliberately states all three negatives — not executed, not approved,
 * not denied — because the incident's harm was the model claiming an approval
 * was pending: this text is what the transcript shows INSTEAD of a spinner or
 * a silent after-the-fact interruption, and it must leave no room for an
 * approval-is-coming reading.
 */
export const UNRESOLVED_TOOL_CALL_ERROR =
  "The tool did not return a result before the turn ended. It was never " +
  "executed, approved, or denied — no approval is pending for it.";

/** One never-resolved tool call the turn boundary settled (issue #965). */
export interface UnresolvedToolCall {
  toolCallId: string;
  toolName: string;
}

/**
 * Settle this-turn tool calls that are still NON-TERMINAL when a turn
 * completes without pausing — the issue #965 invariant, the sibling of
 * {@link detectUnattributedHookBlocks}' #205 invariant ("a blocked tool must
 * never silently complete" → "an unresolved tool must never silently
 * complete").
 *
 * THE SHAPE THIS CATCHES. A tool that hangs INSIDE the Cursor agent runtime —
 * the production case is `generateImage`, which rides the SDK's
 * interaction-query channel rather than the ordinary tool path — streams a
 * tool_call start, never streams a result, and is invisible to every Stigmer
 * seam: the hook never denied it (no ledger entry), so the reconcile never
 * gated it, and the turn completes with the row still PENDING/RUNNING. Before
 * this sweep, the server's terminal settle (issue #207) stamped such rows
 * TOOL_CALL_INTERRUPTED silently AFTER the runner reported completion — the
 * transcript's last word stayed whatever the model claimed, which in
 * aex_01m1a6ww3nmp4952ar5v0g4g85 was a promise that an approval was pending
 * when none existed.
 *
 * Settling here instead makes the runner the author of the honest record: the
 * row gets TOOL_CALL_INTERRUPTED with {@link UNRESOLVED_TOOL_CALL_ERROR}, and
 * the caller (turn-boundary.ts) appends a system disclosure naming what never
 * ran.
 *
 * WHY INTERRUPTED AND NEVER FAILED. TOOL_CALL_INTERRUPTED is deliberately the
 * one settled status the monotonic merge guard lets live execution evidence
 * supersede (see the guard's note in this file, ~line 331): if this FAILED
 * execution is later RECOVERED, the harness checkpoint may re-execute the call
 * under its original id, and the replayed events must be able to advance the
 * row to its true outcome. A boundary-stamped FAILED would freeze it forever.
 *
 * WHY IT NEVER FAILS THE RUN (unlike #205). A foreign hook block is provably
 * adversarial — approval semantics are permanently broken, so completing would
 * always be a lie. An unresolved row can also be benign stream event-loss
 * where the tool actually ran; failing the run would convert those into
 * regressions. Disclosure restores honesty at zero regression risk.
 *
 * Scope and exclusions, in order:
 *  - THIS turn's parent-transcript rows only (from `turnStartMessageIndex`):
 *    seeded prior-turn rows were adjudicated by their own execution's settle,
 *    and sub-agent inner rows are the server settle's concern — the parent row
 *    (e.g. the Task call) is what the user sees. Mirrors #205's scoping.
 *  - Only PENDING/RUNNING rows: every terminal row was adjudicated, and
 *    WAITING_APPROVAL rows belong to the pause machinery (the caller only runs
 *    this sweep on a NON-pausing turn, so none should exist here anyway).
 *  - Only rows with NO denial-ledger entry of ANY kind (exact token, then the
 *    normalized-path fallback — the same two identities every sweep in this
 *    file uses): a ledger-attributed row is the unattended/secret/fail-closed
 *    machinery's to settle, not ours.
 *
 * Returns the settled calls so the boundary can disclose and log them.
 */
export function settleUnresolvedToolCalls(
  messages: readonly AgentMessage[],
  turnStartMessageIndex: number,
  ledger: readonly DeniedLedgerEntry[],
  workspaceRoot?: string,
): UnresolvedToolCall[] {
  const ledgerTokens = new Set(ledger.map((e) => e.token));
  const ledgerNormalizedSalients = new Set<string>();
  if (workspaceRoot) {
    for (const entry of ledger) {
      const decoded = decodeIdentityToken(entry.token);
      if (!decoded) continue;
      const normalized = normalizedFileSalient(decoded.key, decoded.salient, workspaceRoot);
      if (normalized) ledgerNormalizedSalients.add(normalized);
    }
  }

  const matchesLedger = (tc: ToolCall): boolean => {
    if (ledgerTokens.has(toolCallIdentityToken(tc))) return true;
    if (!workspaceRoot) return false;
    const id = toolIdentity(tc.name, tc.mcpServerSlug, toolCallArgs(tc));
    const normalized = normalizedFileSalient(id.key, id.salient, workspaceRoot);
    return !!normalized && ledgerNormalizedSalients.has(normalized);
  };

  const settled: UnresolvedToolCall[] = [];
  for (const msg of messages.slice(Math.max(0, turnStartMessageIndex))) {
    for (const tc of msg.toolCalls) {
      if (
        tc.status !== ToolCallStatus.TOOL_CALL_PENDING &&
        tc.status !== ToolCallStatus.TOOL_CALL_RUNNING
      ) {
        continue;
      }
      if (matchesLedger(tc)) continue;
      tc.status = ToolCallStatus.TOOL_CALL_INTERRUPTED;
      tc.error = UNRESOLVED_TOOL_CALL_ERROR;
      tc.isStreaming = false;
      if (!tc.completedAt) tc.completedAt = utcTimestamp();
      settled.push({ toolCallId: tc.id, toolName: tc.name });
    }
  }
  return settled;
}

/**
 * Stamp the tool calls the hook denied under UNATTENDED approval mode
 * (DD-014) as terminal TOOL_CALL_SKIPPED rows with UNATTENDED_SKIP
 * provenance — the Cursor twin of the native harness's
 * `reconcileUnattendedSkips`, so both harnesses persist the same honest
 * shape for a platform-resolved skip.
 *
 * An unattended denial never pauses the run (its ledger kind is excluded
 * from {@link approvalDenials}), so the stream leaves the denied call as a
 * FAILED row carrying Cursor's generic hook-block error — dishonest ("the
 * tool broke") and alarming in a transcript an org admin reviews. This pass
 * correlates the unattended ledger entries to their streamed calls with the
 * SAME two identities the rest of the file uses — exact token, then
 * (category, workspace-normalized path) for the abs-vs-rel drift — and
 * settles each match to SKIPPED with a result explaining the skip.
 *
 * Scope: hook-blocked FAILED rows and still-non-terminal (PENDING/RUNNING)
 * rows only — a COMPLETED row is a real execution and is never rewritten
 * (an unattended deny cannot produce one). `approval_action`/`approved_by`
 * stay untouched: server-owned, human-decision-only fields (DD-014 D-e).
 * Unmatched ledger entries need no synthesis — there is no pause to
 * surface; the model already saw the deny and adapted in-turn.
 *
 * Returns how many tool calls were stamped.
 */
export function stampUnattendedSkippedToolCalls(
  messages: readonly AgentMessage[],
  subAgentExecutions: readonly SubAgentExecution[],
  unattendedLedger: readonly DeniedLedgerEntry[],
  workspaceRoot?: string,
): number {
  if (unattendedLedger.length === 0) return 0;

  const ledgerTokens = new Set(unattendedLedger.map((e) => e.token));
  const ledgerNormalizedSalients = new Set<string>();
  if (workspaceRoot) {
    for (const entry of unattendedLedger) {
      const decoded = decodeIdentityToken(entry.token);
      if (!decoded) continue;
      const normalized = normalizedFileSalient(decoded.key, decoded.salient, workspaceRoot);
      if (normalized) ledgerNormalizedSalients.add(normalized);
    }
  }

  const matchesLedger = (tc: ToolCall): boolean => {
    if (ledgerTokens.has(toolCallIdentityToken(tc))) return true;
    if (!workspaceRoot) return false;
    const id = toolIdentity(tc.name, tc.mcpServerSlug, toolCallArgs(tc));
    const normalized = normalizedFileSalient(id.key, id.salient, workspaceRoot);
    return !!normalized && ledgerNormalizedSalients.has(normalized);
  };

  let stamped = 0;
  const apply = (msgs: readonly AgentMessage[]): void => {
    for (const msg of msgs) {
      for (const tc of msg.toolCalls) {
        const deniedShape =
          (tc.status === ToolCallStatus.TOOL_CALL_FAILED && isHookBlockError(tc.error)) ||
          tc.status === ToolCallStatus.TOOL_CALL_PENDING ||
          tc.status === ToolCallStatus.TOOL_CALL_RUNNING;
        if (!deniedShape || !matchesLedger(tc)) continue;
        tc.status = ToolCallStatus.TOOL_CALL_SKIPPED;
        tc.approvalPolicySource = ApprovalPolicySource.UNATTENDED_SKIP;
        tc.policyEngineVersion = POLICY_ENGINE_VERSION;
        tc.error = "";
        tc.result = unattendedSkipMessage(tc.name);
        tc.isStreaming = false;
        if (!tc.completedAt) tc.completedAt = utcTimestamp();
        stamped++;
      }
    }
  };

  apply(messages);
  for (const subAgent of subAgentExecutions) {
    apply(subAgent.messages);
  }
  return stamped;
}

/**
 * Resolve a human-readable approval message for a denied tool, preferring the
 * MCP policy template, then the built-in template, then a generic fallback.
 */
function resolveDeniedApprovalMessage(
  name: string,
  mcpServerSlug: string,
  args: Record<string, unknown>,
  mergedPolicies?: ReadonlyMap<string, MergedToolPolicy>,
): string {
  if (mergedPolicies && mcpServerSlug) {
    const policy = lookupMcpToolPolicy(name, mcpServerSlug, mergedPolicies);
    if (policy) return resolveApprovalMessage(policy.approvalMessage, name, args);
  }
  if (!mcpServerSlug) {
    const template = getBuiltInApprovalMessage(name);
    if (template) return resolveApprovalMessage(template, name, args);
  }
  return `Tool requires approval: ${name}`;
}
