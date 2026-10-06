/**
 * Approval state management for the hook-deny + reinvoke HITL model.
 *
 * Before starting a Cursor Agent run, the cursor-runner writes a state file
 * into the session's runner-owned HITL directory (outside the user's
 * workspace). The preToolUse hook script reads this file to decide whether to
 * allow or deny each tool call.
 *
 * State file format (JSON):
 * {
 *   "autoApproveAll": false,
 *   "leasedCategories": ["shell"],
 *   "mcpDestructiveTools": {
 *     "planton/apply_cloud_resource": { "message": "Execute apply_cloud_resource" }
 *   },
 *   "toolListsRestricted": true,
 *   "toolScope": "<base64(JSON)>",
 *   "approvedGrants": [{ "toolName": "edit", "mcpServerSlug": "", "key": "write", "salient": "a.txt", "contentDigest": "<sha256>" }],
 *   "approvedGrantTokens": ["<base64(key\nsalient[\ncontentDigest])>"]
 * }
 *
 * A grant token is the action's PRIMARY token: base64(key \n salient \n digest)
 * for a content-identified file edit (so a DIFFERENT edit to the same file does
 * not match), or base64(key \n salient) for shell/delete/MCP and the rare
 * content-less fallback. See {@link primaryToken}.
 *
 * Two questions, answered in this order. First, may this agent call the tool
 * at all (`toolScope`, its tool lists compiled by `hook-scope.ts`)? A tool out
 * of scope is refused whatever the approval posture. Then, does the call ask
 * first? The hook gates the dangerous built-in set and the MCP tools whose
 * server marks them destructive (`mcpDestructiveTools`, keyed by server and
 * tool); every other tool is allowed. The gated built-in set and its
 * name->category mapping are baked into the generated hook script (from
 * approval-policy.ts), not carried in the state file — only the dynamic inputs
 * live here. Both halves are computed by the runner from the turn's one
 * source each (`TurnMcp.mcpDefault`, `TurnMcp.toolScope`), so this file adds
 * no rule of its own.
 *
 * Approval leases (the scoped successor to autoApproveAll): `autoApproveAll` is
 * ONLY the pre-armed spec.auto_approve_all global bypass. An interactive
 * "approve all" of a given class becomes a run-lifetime lease: a built-in
 * category lease is listed in `leasedCategories` (the hook allows any built-in of
 * that category), and an MCP-server lease leaves the server's tools out of
 * mcpDestructiveTools, so the hook lets them through.
 *
 * Why grants instead of tool-call ids: a resumed Cursor agent re-issues the
 * approved tool with a BRAND NEW call id, so matching on the original call id
 * can never let the re-attempt through. Instead we grant by canonical tool
 * identity — the approval category plus a "salient" resource value (the file
 * path, the shell command; see {@link toolIdentity}). On reinvocation the hook
 * allows a tool call only if its (category, salient) matches an approved grant;
 * rejected/skipped tools and any newly proposed dangerous tool are re-gated.
 *
 * Tokens: the hook is a self-contained bash script, so it cannot parse an array
 * of grant objects. `approvedGrantTokens` is the flat, base64-encoded form of
 * each grant that the hook matches by simple string membership. The structured
 * `approvedGrants` is retained for readability, debugging, and tests; the two
 * are always generated together from the same source.
 *
 * Denial ledger (hook → runner):
 * The state file is the runner's INPUT to the hook. Its symmetric OUTPUT is the
 * denial ledger (denials.jsonl): EVERY deny the hook issues appends the call's
 * identity token to this file, tagged with a `kind` (see {@link DenialKind}) —
 * so the ledger is the complete, authoritative record of what THIS hook blocked
 * this turn (the cursor analog of the native harness's LangGraph interrupts).
 * The kinds split by consumer semantics:
 *
 * - Only APPROVAL-kind entries pause the run (the first-denial stop and
 *   reconcileDeniedToolCalls filter to them via {@link approvalDenials}); a
 *   secret hard-block or a fail-closed deny must never surface an approval the
 *   user cannot meaningfully grant.
 * - The FULL ledger (all kinds) means "these actions did NOT execute": it feeds
 *   capture stamping and approved-command provenance, and it is the ATTRIBUTION set for
 *   issue #205 — a hook-blocked tool call with NO ledger entry of any kind was
 *   blocked by a FOREIGN hook (or a failed ledger append), an invariant
 *   violation the turn boundary surfaces instead of completing silently.
 *
 * The token uses the SAME identity space as approvedGrantTokens, so a denial
 * token approved this turn becomes a grant token next turn.
 */

import { createHash } from "node:crypto";
import { watch } from "node:fs";
import { writeFile, readFile, mkdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { create } from "@bufbuild/protobuf";
import { ApprovalAction, ApprovalPolicySource, ToolCallStatus } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/enum_pb";
import { PendingApprovalSchema } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/approval_pb";
import type { PendingApproval } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/approval_pb";
import type { AgentMessage, ToolCall } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/message_pb";
import type { ApprovalCategory, McpApprovalDefault } from "./approval-policy.js";
import { extractArgKey, approvalCategory, resolveApprovalMessage, POLICY_ENGINE_VERSION } from "./approval-policy.js";
import { DESTRUCTIVE_MCP_APPROVAL_MESSAGE } from "../../shared/approval-policy.js";
import { encodeHookToolScope, SCOPE_KEY_PREFIX, UNRESTRICTED_HOOK_SCOPE, type HookToolScope } from "./hook-scope.js";
import { contentDigest } from "../../shared/file-tools.js";
import {
  fingerprintCoarseIdentity,
  type FingerprintKey,
} from "../../shared/approval-fingerprint.js";

/** One MCP tool that asks first because its server marks it destructive. */
export interface McpDestructiveToolEntry {
  /** The approval card's message. */
  message: string;
}

/**
 * The canonical, taxonomy-agnostic identity of a tool call.
 *
 * The Cursor preToolUse hook and the SDK stream name the same operation
 * differently (hook `Write`/`Shell`/`Delete`; stream `edit`/`shell`/`delete`),
 * so the raw tool name cannot be a cross-layer identity. Instead:
 * - `key` is the {@link approvalCategory} (`write`/`delete`/`shell`) for gated
 *   built-ins; the hook's name for any other built-in (a hook may ask on any
 *   tool), the stream's name mapped to it ({@link STREAM_TO_HOOK_NAME});
 *   and `server/tool` for an MCP tool, so a grant for one server's tool
 *   never lets an equal tool name through on another server.
 * - `salient` is the resource the tool acts on (the absolute file path or the
 *   shell command) — identical on both sides because it is the argument VALUE,
 *   not the field name. Empty for MCP tools, matched by `key` alone.
 *
 * The denial ledger (hook) and the stream reconciliation (runner) both reduce a
 * tool call to this identity, so they correlate exactly; an approval grant uses
 * the same identity so the agent's re-attempt is allowed on reinvocation even
 * though it carries a fresh tool-call id and a different-taxonomy name.
 */
export interface ToolIdentity {
  key: string;
  salient: string;
}

export function toolIdentity(
  toolName: string,
  mcpServerSlug: string,
  args: Record<string, unknown> | undefined,
): ToolIdentity {
  if (mcpServerSlug) {
    return { key: `${mcpServerSlug}/${toolName}`, salient: "" };
  }
  const category = approvalCategory(toolName);
  // A gated built-in keys on its category; any other built-in on the hook's
  // name for it, the one a hook asked under.
  return { key: category ?? STREAM_TO_HOOK_NAME.get(toolName) ?? toolName, salient: extractArgKey(args) };
}

/**
 * The hook's name for each built-in the stream names otherwise and that has
 * no approval category: what a hook's ask on it is keyed by on both sides
 * (`@cursor/sdk` 1.0.31, live: a read streams as `read`, a search as `grep`,
 * a glob as `glob`, and the hook sees `Read`, `Grep`, and `Grep` with an
 * empty pattern; from its bundle and tool vocabulary: a directory listing
 * streams as `ls` and a lint read as `readLints`, and the hook sees `List`
 * and `ReadLints`). `hook-views.ts` `rowNameOf` is the inverse.
 */
const STREAM_TO_HOOK_NAME: ReadonlyMap<string, string> = new Map([
  ["read", "Read"],
  ["grep", "Grep"],
  ["glob", "Grep"],
  ["ls", "List"],
  ["readLints", "ReadLints"],
]);

/**
 * The identity of an approved tool call, stable across agent resume.
 *
 * - `key`/`salient` are the canonical {@link ToolIdentity} the hook matches on.
 * - `toolName`/`mcpServerSlug` are retained for readability, debugging, and the
 *   structured-vs-token cross-check (the two are always generated together).
 */
export interface ApprovalGrant {
  toolName: string;
  mcpServerSlug: string;
  key: string;
  salient: string;
  /**
   * Content digest of the approved edit (see {@link contentDigest}), or "" when
   * the action is not content-identified (shell/delete/MCP, or a content-less
   * fallback). When present, the grant authorizes the {@link contentToken} so a
   * DIFFERENT edit to the same path does NOT match; when "", it authorizes the
   * coarse {@link grantToken} (the documented degrade).
   */
  contentDigest: string;
  /**
   * Id of the adjudicated tool call this grant was minted from — the transcript
   * row carrying the SERVER-authored approval_action. The approved-command
   * auto-keep provenance cites this row as the consent the backend can
   * verify; the hook itself never reads it.
   */
  sourceToolCallId: string;
}

export interface ApprovalStateFile {
  /** Pre-armed spec.auto_approve_all: the whole-run global bypass. */
  autoApproveAll: boolean;
  /**
   * Built-in approval categories with a run-lifetime lease (the scoped successor
   * to a global "approve all"). The hook allows any built-in whose category is
   * listed. MCP-server leases are NOT listed here — a leased server's tools are
   * left out of mcpDestructiveTools instead.
   */
  leasedCategories: string[];
  /**
   * The MCP tools that ask first, keyed `server/tool` (`mcpToolKey`): every
   * tool its server marks destructive, minus the leased servers'. Keyed by
   * server as well as tool because the beforeMCPExecution payload carries
   * mcp_server_name, so equal tool names on two servers never share a verdict.
   */
  mcpDestructiveTools: Record<string, McpDestructiveToolEntry>;
  /** Whether the agent has tool lists: the hook's bash half reads it to fail closed when its Node half cannot run. */
  toolListsRestricted: boolean;
  /**
   * The agent's tool lists as the hook evaluates them (`hook-scope.ts`),
   * encoded opaque (`encodeHookToolScope` says why). The hook's scope arm runs
   * BEFORE the capture arms, autoApproveAll and every grant, because a list
   * says what the agent may call at all: no approval posture may resurrect an
   * excluded tool, and no human is ever offered "approve" on one. A refusal is
   * recorded kind "disabled".
   */
  toolScope: string;
  approvedGrants: ApprovalGrant[];
  approvedGrantTokens: string[];
  /**
   * Capture mode (git workspaces): when true, the hook ALLOWS file mutations
   * (write/edit/delete) to flow during the turn, because the runner captures the
   * whole change set with git at the turn boundary and gates it per-file for
   * review (see shared/filereview/git-substrate.ts). The ONLY exception is a
   * write/delete whose
   * path is gitignored — the git snapshot cannot capture or revert it, so the
   * hook keeps gating those (it runs `git check-ignore`). shell and MCP stay
   * gated as always. False (the default) keeps the classic deny-gate behavior
   * for every file mutation (non-git workspaces / the fallback path).
   */
  captureMode: boolean;
  /**
   * CAS capture for gitignored writes (the deep-agent parity switch). When true,
   * a non-secret gitignored write/edit no longer stays on the deny-gate: the hook
   * stages its pre-write bytes into the runner-owned cas-observations sidecar and
   * ALLOWS it to flow, and the runtime's capture (`harness/capture.ts`, reading
   * the sidecar as this adapter's CAS observations) stores it as a
   * `GIT_IGNORED_CAPTURED` change for per-file review (the deep-agent's
   * `CasCaptureFilesystemBackend` observer is the same fact, in-process). A secret-like gitignored
   * path is instead hard-blocked (denied, nothing written) and recorded as an
   * unreviewable observation, so its bytes never reach durable storage.
   *
   * Set only when `captureMode` AND an artifact storage is configured — CAS blob
   * persistence requires it. When false, gitignored writes keep the classic
   * deny-gate behavior (gitignored deletes and shell/MCP always do). Independent
   * of `autoApproveAll`: capture is a property of the turn, not authorization, so
   * the hook honors this switch even under the global bypass.
   */
  captureIgnored: boolean;
  /**
   * Whether the primary workspace is a git work tree. Selects the
   * hook's capture substrate:
   *  - `true` (default): git tree — git-tracked write/edit/delete flow freely
   *    (the runner captures them from the git diff at the turn boundary); only a
   *    GITIGNORED write is CAS-staged (when `captureIgnored`), a gitignored delete
   *    stays gated.
   *  - `false`: non-git workspace — there is no git snapshot, so EVERY file write
   *    is CAS-staged and flowed for review (`captureIgnored` is on in this mode),
   *    a delete stays gated (no CAS delete-capture path, parity with the
   *    deep-agent), and shell/MCP gate as always.
   */
  gitWorkspace: boolean;
  /**
   * Unattended approval mode (`status.approval_mode` = UNATTENDED):
   * the lane the turn came through — a schedule, a messaging channel, a
   * guest share — has no approver. What is gated is UNCHANGED; only the resolution differs: a
   * deny that would be recorded kind "approval" (pausing) is recorded kind
   * "unattended" (non-pausing) with an adapt-and-explain agent message, so
   * the first-denial stop never fires, no WAITING_APPROVAL gate is
   * reconciled, and the run continues to normal completion. The secret
   * hard-block and fail-closed arms are mode-independent and unchanged.
   */
  unattendedSkip: boolean;
}

/**
 * Compute the flat token the bash hook matches on. The hook recomputes the same
 * token from the incoming tool call (`base64(key \n salient)` — see
 * {@link toolIdentity}), so the encoding here must stay byte-identical to the
 * hook script in hook-script.ts.
 */
export function grantToken(key: string, salient: string): string {
  return Buffer.from(`${key}\n${salient}`, "utf-8").toString("base64");
}

/**
 * The ledger token of a scope refusal: the TOOL (`key`: the stream name's
 * `scopeKey`, `hook-scope.ts`, or `mcpToolKey(server, tool)` for an MCP call),
 * plus, for a tool the lists may exclude only in part (`READ_SCOPE_KEY`,
 * `AGENT_SCOPE_KEY`), the call's discriminator: the path as given, or the
 * normalized sub-agent type. An empty discriminator names the whole tool.
 * The hook records the same bytes (`grantToken` of the prefixed key and the
 * discriminator); the turn boundary decodes them (`decodeIdentityToken`).
 */
export function scopeRefusalToken(key: string, discriminator = ""): string {
  return grantToken(`${SCOPE_KEY_PREFIX}${key}`, discriminator);
}

/**
 * The content-exact wire token: `base64(key \n salient \n contentDigest)`. This
 * is the exact-identity grant the hook matches for a file-mutating tool, so an
 * approval of one edit does NOT authorize a DIFFERENT edit to the same file (a
 * different digest yields a different token). The hook recomputes the identical
 * token from `tool_input` (it appends the same `\n<digest>` only when the digest
 * is non-empty — see hook-script.ts), so this encoding must stay byte-identical
 * to the hook's, exactly as {@link grantToken} already is.
 */
export function contentToken(key: string, salient: string, contentDigest: string): string {
  return Buffer.from(`${key}\n${salient}\n${contentDigest}`, "utf-8").toString("base64");
}

/**
 * The single token a tool call authorizes (as a grant) and is recorded under (as
 * a denial): the {@link contentToken} when a content digest is present (file
 * edits/writes), else the coarse {@link grantToken} (shell, delete, MCP, or a
 * content-less grep-fallback). One definition, used by the runner for both grant
 * building and denial correlation and mirrored by the hook, so the deny-time and
 * reinvoke-time identities can never drift.
 */
export function primaryToken(key: string, salient: string, contentDigest: string): string {
  return contentDigest ? contentToken(key, salient, contentDigest) : grantToken(key, salient);
}

/**
 * Compute a streamed tool call's identity token in the same canonical space the
 * preToolUse hook records denials in (see {@link toolIdentity} / primaryToken).
 * The token keys on the cross-taxonomy category + salient resource PLUS, for a
 * file edit/write, the {@link contentDigest} of the edit content — so a stream
 * `edit` correlates to the hook's `Write` deny for the same path AND content,
 * and an approval of one edit does not match a DIFFERENT edit to the same file.
 *
 * The digest is read from the persisted `approval_content_digest` field when
 * present (a seeded gate carries it, stable even if `args` was elided), and is
 * recomputed from the call's args otherwise (a freshly-streamed call). For a
 * shell/delete/MCP call (no content) it falls back to the coarse token, exactly
 * as before — so those identities are unchanged.
 *
 * Exported so the resume-grant round-trip can be locked against it: the grant a
 * resume mints for an approved tool (buildApprovalGrants -> primaryToken) must
 * equal THIS denial/overlay identity, or the re-issued call is re-gated forever
 * (the dual-path drift the approval-state round-trip suite guards against).
 */
export function toolCallIdentityToken(tc: ToolCall): string {
  const id = toolIdentity(tc.name, tc.mcpServerSlug, toolCallArgs(tc));
  // A hook ask's digest binds the grant, not the row's identity: the model's
  // retry streams with the coarse identity and resumes onto this row.
  const persisted = tc.approvalContentDigest.startsWith(HOOK_ASK_DIGEST_PREFIX) ? "" : tc.approvalContentDigest;
  const digest = persisted || contentDigest(toolCallArgs(tc));
  return primaryToken(id.key, id.salient, digest);
}

/** Marks a {@link hookAskDigest}, apart from a file edit's content digest. */
export const HOOK_ASK_DIGEST_PREFIX = "args:";

/**
 * What a hook's ask is approved under when the call carries no file content
 * (an MCP tool, a shell command, a read or a search): the whole input as the
 * hook saw it. The native engine asks for every call a hook asks on; here an
 * approval leaves a grant, and keyed to the tool alone it would let through
 * the same tool with any arguments. The gate's script computes the same
 * digest from the payload (`hook-script.ts`, the hook arm's grant check), so
 * the two must stay byte-identical: SHA-256 of the input's JSON, prefixed.
 */
export function hookAskDigest(input: Record<string, unknown>): string {
  return HOOK_ASK_DIGEST_PREFIX + createHash("sha256").update(JSON.stringify(input), "utf8").digest("hex");
}

/**
 * Decode a primary token back into its (key, salient, digest) for the synthesis
 * fallback. The token is `base64(key \n salient)` (coarse) or
 * `base64(key \n salient \n digest)` (content-exact); the digest is the optional
 * third segment. salient never contains a newline (a path or shell command), so
 * splitting on the first two newlines is unambiguous.
 */
export function decodeIdentityToken(
  token: string,
): { key: string; salient: string; digest: string } | undefined {
  try {
    const decoded = Buffer.from(token, "base64").toString("utf-8");
    const first = decoded.indexOf("\n");
    if (first < 0) return undefined;
    const key = decoded.slice(0, first);
    const rest = decoded.slice(first + 1);
    const second = rest.indexOf("\n");
    if (second < 0) return { key, salient: rest, digest: "" };
    return { key, salient: rest.slice(0, second), digest: rest.slice(second + 1) };
  } catch {
    return undefined;
  }
}

/** Best-effort args record for a tool call (proto struct, else parsed preview). */
export function toolCallArgs(tc: ToolCall): Record<string, unknown> {
  if (tc.args && typeof tc.args === "object") {
    return tc.args as Record<string, unknown>;
  }
  if (tc.argsPreview) {
    try {
      const parsed = JSON.parse(tc.argsPreview);
      if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
    } catch {
      // fall through
    }
  }
  return {};
}

/**
 * The shared HMAC coarse fingerprint of an approval grant.
 *
 * This is the SAME canonical coarse identity the wire token (grantToken) encodes
 * — `(key, salient)` plus the MCP slug — run through the one shared HMAC+canonical
 * path ({@link fingerprintCoarseIdentity}). It is NOT the hook's wire-match value:
 * the hook matches on the mechanically-reproducible base64 token (a bash script
 * can recompute base64 but not a keyed HMAC over a workspace-root-normalized
 * salient). This fingerprint is the cross-substrate, anti-forgery identity used
 * for the runner-side shadow receipt today and as the successor wire token once a
 * lease becomes a server-issued bearer token. Because it shares the
 * exact category + salient the token uses, the hook-side and stream-side
 * fingerprints of one action are equal by construction (see the parity tests).
 */
export function grantFingerprint(key: FingerprintKey, grant: ApprovalGrant): string {
  return fingerprintCoarseIdentity(key, {
    // An MCP grant's `key` is `server/tool`; the fingerprint names the tool
    // and the server apart, as the native engine's does.
    tool: grant.mcpServerSlug ? grant.toolName : grant.key,
    mcpServerSlug: grant.mcpServerSlug,
    salient: grant.salient,
  });
}

/**
 * Emit a best-effort shadow ExecutionReceipt for each grant the runner issues
 * this turn (the mirror of the deep-agent gateway's receipt).
 *
 * Cursor executes tools out-of-process, so unlike the in-process deep-agent
 * gateway the runner cannot observe the actual side effect — the receipt is
 * issued when the authorization GRANT is written (best-effort, `verified:false`),
 * not at execution. Structured log only: never persisted, no proto. Shares the
 * one HMAC+canonical fingerprint path so the value matches the deep-agent and
 * cross-language corpus definitions.
 */
export function emitCursorGrantReceipts(
  grants: readonly ApprovalGrant[],
  fingerprintKey: FingerprintKey,
  executionId: string,
): void {
  for (const g of grants) {
    console.log(
      "[hitl-gateway] receipt " +
      JSON.stringify({
        executionId,
        toolName: g.toolName,
        mcpServerSlug: g.mcpServerSlug,
        category: g.mcpServerSlug ? "" : g.key,
        authorization: "approval",
        policyEngineVersion: POLICY_ENGINE_VERSION,
        fingerprint: grantFingerprint(fingerprintKey, g),
        substrate: "cursor",
        verified: false,
      }),
    );
  }
}

/**
 * Build approval grants from the pending approvals the user adjudicated and
 * their decisions. Only APPROVE / APPROVE_ALL decisions produce grants. Each
 * grant carries the canonical {@link ToolIdentity} (category + salient resource)
 * so the hook allows the exact approved resource on the resumed turn.
 */
export function buildApprovalGrants(
  pendingApprovals: PendingApproval[],
  decisions: ReadonlyMap<string, ApprovalAction>,
  contentDigests?: Map<string, string>,
): ApprovalGrant[] {
  const grants: ApprovalGrant[] = [];
  for (const pa of pendingApprovals) {
    // Both APPROVE and APPROVE_ALL allow the adjudicated tool through on the
    // resumed turn. APPROVE_ALL additionally grants a run-lifetime lease for the
    // clicked action's class (handled by the caller via deriveActiveLeases ->
    // leasedCategories / dropped MCP server), but we still emit a grant here so
    // the clicked tool itself is allowed regardless of how the hook reads state.
    const decision = decisions.get(pa.toolCallId);
    if (decision !== ApprovalAction.APPROVE && decision !== ApprovalAction.APPROVE_ALL) continue;

    const id = toolIdentity(pa.toolName, pa.mcpServerSlug, parseArgs(pa.argsPreview));
    grants.push({
      toolName: pa.toolName,
      mcpServerSlug: pa.mcpServerSlug,
      key: id.key,
      salient: id.salient,
      // The content digest comes from the gate's authoritative captured input
      // (carried on the tool call, see reconstructAdjudicatedApprovals) — NOT
      // from argsPreview, which elides heavy edit content. Empty when the gate
      // had no content (shell/delete/MCP) or it was unrecoverable, in which case
      // the grant degrades to the coarse token (a same-file sibling can ride it,
      // the documented bounded residual).
      contentDigest: contentDigests?.get(pa.toolCallId) ?? "",
      sourceToolCallId: pa.toolCallId,
    });
  }
  return grants;
}

/** A call a person skipped or rejected this run: what they decided, and the tool as the row named it. */
export interface PersonRefusal {
  readonly action: "skip" | "reject";
  readonly toolName: string;
}

/**
 * The calls a person skipped or rejected (SKIP / REJECT), by identity token
 * (the primary one, and the coarse one a content-less retry of the same
 * resource carries), so a hook's allow or ask never runs one of them again:
 * the person's refusal binds on the model's retry, as it does on the native
 * engine (`middleware/approval-gate.ts`). Only a hook's deny comes before
 * it (`hook-server.ts`).
 */
export function buildPersonRefusals(
  pendingApprovals: PendingApproval[],
  decisions: ReadonlyMap<string, ApprovalAction>,
  contentDigests?: Map<string, string>,
  hookAsked: ReadonlySet<string> = new Set(),
): Map<string, PersonRefusal> {
  const refusals = new Map<string, PersonRefusal>();
  for (const pa of pendingApprovals) {
    const decision = decisions.get(pa.toolCallId);
    if (decision !== ApprovalAction.REJECT && decision !== ApprovalAction.SKIP) continue;
    const refusal: PersonRefusal = { action: decision === ApprovalAction.SKIP ? "skip" : "reject", toolName: pa.toolName };
    const id = toolIdentity(pa.toolName, pa.mcpServerSlug, parseArgs(pa.argsPreview));
    const digest = contentDigests?.get(pa.toolCallId) ?? "";
    refusals.set(primaryToken(id.key, id.salient, digest), refusal);
    // A hook's ask was refused for that exact call, as it is granted for one.
    if (!hookAsked.has(pa.toolCallId) && !digest.startsWith(HOOK_ASK_DIGEST_PREFIX)) refusals.set(grantToken(id.key, id.salient), refusal);
  }
  return refusals;
}

function parseArgs(argsPreview: string): Record<string, unknown> | undefined {
  if (!argsPreview) return undefined;
  try {
    const parsed = JSON.parse(argsPreview);
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Build the approval state file content from the turn's approval default, its
 * tool scope and any approval grants from a previous HITL cycle.
 *
 * The state file carries the hook script's DYNAMIC inputs:
 * - globalBypass: the pre-armed spec.auto_approve_all (written as autoApproveAll)
 * - leasedCategories: built-in categories with a run-lifetime lease
 * - mcpDestructiveTools: the MCP tools that ask, keyed by server and tool,
 *   leased servers left out
 * - approvedGrants / approvedGrantTokens: tools approved in the current HITL
 *   cycle, allowed through on reinvocation
 * - toolScope: the agent's tool lists, compiled (`hook-scope.ts`)
 *
 * The static gated built-in set and its category mapping are baked into the
 * generated hook script (from approval-policy.ts), not carried here.
 */
export function buildApprovalState(
  mcpDefault: McpApprovalDefault,
  globalBypass: boolean,
  leasedCategories: ReadonlySet<ApprovalCategory>,
  grants?: ApprovalGrant[],
  captureMode = false,
  captureIgnored = false,
  gitWorkspace = true,
  unattendedSkip = false,
  toolScope: HookToolScope = UNRESTRICTED_HOOK_SCOPE,
): ApprovalStateFile {
  const approvedGrants = grants ?? [];

  const mcpDestructiveTools: Record<string, McpDestructiveToolEntry> = {};
  for (const key of mcpDefault.destructive) {
    // `mcpToolKey` joins a slug (no "/") and a tool name, so the first "/" splits them.
    const sep = key.indexOf("/");
    const server = key.slice(0, sep);
    if (mcpDefault.leasedServers.has(server)) continue;
    const tool = key.slice(sep + 1);
    mcpDestructiveTools[key] = { message: resolveApprovalMessage(DESTRUCTIVE_MCP_APPROVAL_MESSAGE, tool, {}) };
  }

  return {
    autoApproveAll: globalBypass,
    leasedCategories: [...leasedCategories],
    mcpDestructiveTools,
    toolListsRestricted: toolScope.restricted,
    toolScope: encodeHookToolScope(toolScope),
    approvedGrants,
    // The hook matches a tool call's PRIMARY token (content when it can compute a
    // digest from tool_input, else coarse). A content-identified grant authorizes
    // only its exact content; a content-less grant authorizes the coarse token.
    approvedGrantTokens: approvedGrants.map((g) => primaryToken(g.key, g.salient, g.contentDigest)),
    captureMode,
    captureIgnored,
    gitWorkspace,
    unattendedSkip,
  };
}

const STATE_FILE_NAME = "approval-state.json";

/**
 * Write the approval state file into the session's HITL directory for the hook
 * script to read.
 *
 * The HITL directory is runner-owned and lives outside the user's workspace
 * (`~/.stigmer/sessions/{id}/hitl/`), so this file never lands in the attached
 * repo — only a minimal `.cursor/hooks.json` pointing here by absolute path does
 * (see issue #173). The hook reads this file fresh on every tool call, so its
 * dynamic policy is always current even if the SDK caches `hooks.json`.
 *
 * Written as COMPACT JSON (no indentation): the bash hook parses it with
 * line-oriented grep patterns that assume `"key":value` with no spaces or
 * newlines (e.g. `"autoApproveAll":true`, `"name":{...}`). Pretty-printing
 * would break every lookup.
 */
export async function writeApprovalStateFile(
  hitlDir: string,
  state: ApprovalStateFile,
): Promise<string> {
  await mkdir(hitlDir, { recursive: true });
  const filePath = join(hitlDir, STATE_FILE_NAME);
  await writeFile(filePath, JSON.stringify(state), "utf-8");
  return filePath;
}

// ─────────────────────────────────────────────────────────────────────────────
// Denial ledger (hook → runner): the authoritative record of what the hook gated
// ─────────────────────────────────────────────────────────────────────────────

const DENIAL_LEDGER_FILE = "denials.jsonl";

/**
 * The attribution taxonomy of a hook denial (mirrored byte-for-byte by the
 * generated bash script — see hook-script.ts record_denial):
 *
 * - `approval`      — the normal gate: the runner surfaces it as a
 *                     WAITING_APPROVAL pause. The ONLY kind that pauses.
 * - `unattended`    — the same gate resolved under UNATTENDED approval mode
 *                     — the surface has no approver, so the deny is
 *                     final for this turn — non-pausing, the agent was told
 *                     to adapt, and the turn boundary stamps the call
 *                     TOOL_CALL_SKIPPED with UNATTENDED_SKIP provenance.
 * - `secret`        — secret hard-block: intentional, non-pausing (the
 *                     agent was told to move on), recorded content-free.
 * - `capture-error` — CAS staging failed; the write stayed on the deny-gate.
 *                     Content-free (the staging error means secret
 *                     classification may never have run).
 * - `fail-closed`   — the approval state file was missing, so everything gated
 *                     denied. A turn-level "the gate itself was broken" fact.
 * - `disabled`      — the agent's tool lists exclude this tool, or the
 *                     sub-agent type it starts. Permanent for the run and
 *                     mode-independent: NOT an approval (a human must never be
 *                     offered "approve" on an excluded tool), so it is
 *                     non-pausing and the model adapts — the same consumer
 *                     semantics as `secret`. Recorded under the tool's
 *                     {@link scopeRefusalToken}, with the refusal text the
 *                     model read (`message`), which the turn boundary writes
 *                     onto the refused row.
 *
 * - `hook`          — refused before it ran by the hook layer: an agent's hook
 *                     denied it (`hook` names which), or the call is one a
 *                     person skipped or rejected earlier this run and a hook
 *                     would have let it run (no `hook`). Non-pausing, like
 *                     `disabled`: the model read the refusal (`message`),
 *                     which the turn boundary writes onto the refused row.
 *
 * - `hook-unavailable` — refused because the runner's hook server did not
 *                     answer (or its client failed), so the agent's hooks
 *                     could not be asked. Non-pausing; unlike `fail-closed`
 *                     the gate itself worked, so the turn's other blocks are
 *                     still checked for a foreign hook.
 *
 * An `approval` entry a hook asked for carries `hook` too, and the hook's
 * reason as its `message`, so the card names the hook and says why.
 *
 * An unknown kind string is preserved as-is: it is treated as non-pausing (an
 * unknown deny must never manufacture an approval) but still attributes the
 * blocked call to our own hook.
 */
export type DenialKind = "approval" | "unattended" | "secret" | "capture-error" | "fail-closed" | "disabled" | "hook" | "hook-unavailable";

/** The one kind that pauses the run for user approval. */
export const APPROVAL_DENIAL_KIND: DenialKind = "approval";

/** The unattended-mode resolution kind (non-pausing; stamped SKIPPED). */
export const UNATTENDED_DENIAL_KIND: DenialKind = "unattended";

/** The tool-list refusal kind (non-pausing, permanent for the run). */
export const DISABLED_DENIAL_KIND: DenialKind = "disabled";

/** The hook-layer refusal kind (non-pausing). */
export const HOOK_DENIAL_KIND: DenialKind = "hook";

/**
 * One denial recorded by the preToolUse hook. `token` is the call's identity in
 * the same space as grantToken() (base64 of `toolName \n salientArg`), used to
 * correlate the denial back to the streamed tool call. `toolName` is carried raw
 * for human-readable debugging of the ledger file.
 *
 * `kind` is the attribution taxonomy entry (see {@link DenialKind}). Optional
 * for tolerance: an entry written without one (the pre-kind ledger format, or a
 * hand-built test fixture) is an approval-kind denial — see
 * {@link denialKindOf}.
 *
 * `input` is the authoritative pre-execution tool arguments the hook captured
 * from the Cursor `tool_input` payload (decoded from the ledger's base64 form).
 * It is the cursor analog of the native harness reading the AI-message tool-call
 * args out of graph state at the LangGraph interrupt — the one place the COMPLETE
 * proposed change is in hand before the tool runs. The runner overlays it onto
 * the gated tool call so the approval card can show the proposed content/diff
 * before the user approves. Absent when the hook ran its grep fallback (the Node
 * binary was unavailable) — the gate then degrades to stream-recovered args —
 * and ALWAYS absent for non-approval kinds (only an approval-kind entry
 * may carry proposed content).
 *
 * `message` is a tool-list refusal's text (kind `disabled`), decoded from the
 * ledger's base64 form: the exact words the model read, which the turn
 * boundary stamps as the refused row's error.
 */
export interface DeniedLedgerEntry {
  toolName: string;
  token: string;
  kind?: string;
  input?: Record<string, unknown>;
  message?: string;
  /** The plugin whose hook refused or asked (`""` for the agent's own hooks block); absent when no hook did. */
  hook?: string;
}

/** The effective kind of a ledger entry (absent → approval, the pre-kind format). */
export function denialKindOf(entry: DeniedLedgerEntry): string {
  return entry.kind || APPROVAL_DENIAL_KIND;
}

/**
 * The entries that pause the run for user approval — the ONLY kind
 * reconcileDeniedToolCalls may turn into WAITING_APPROVAL gates and the only
 * kind the first-denial stop may cancel the run for. Every other consumer
 * (capture stamping, approved-command provenance, foreign-hook attribution)
 * wants the FULL
 * ledger: all kinds mean "this action did not execute".
 */
export function approvalDenials(entries: readonly DeniedLedgerEntry[]): DeniedLedgerEntry[] {
  return entries.filter((e) => denialKindOf(e) === APPROVAL_DENIAL_KIND);
}

/**
 * The entries the UNATTENDED approval mode resolved — never pausing,
 * consumed by the turn boundary's `stampUnattendedSkippedToolCalls` to
 * terminalize the corresponding streamed tool calls as TOOL_CALL_SKIPPED with
 * UNATTENDED_SKIP provenance, so both harnesses persist the same honest shape.
 */
export function unattendedDenials(entries: readonly DeniedLedgerEntry[]): DeniedLedgerEntry[] {
  return entries.filter((e) => denialKindOf(e) === UNATTENDED_DENIAL_KIND);
}

/**
 * Absolute path of the per-turn denial ledger the hook appends to, inside the
 * session's runner-owned HITL directory (never the user's workspace).
 */
export function denialLedgerPath(hitlDir: string): string {
  return join(hitlDir, DENIAL_LEDGER_FILE);
}

/**
 * Truncate the denial ledger to empty for a fresh turn, returning its path.
 *
 * Called every turn alongside writeApprovalStateFile (the HITL directory is
 * durable and reused across HITL reinvocations), so the runner only ever reads
 * denials produced by the current run. A Temporal activity retry re-runs this
 * reset before re-running the agent, so the read stays deterministic under
 * retries.
 */
export async function resetDenialLedger(hitlDir: string): Promise<string> {
  await mkdir(hitlDir, { recursive: true });
  const filePath = denialLedgerPath(hitlDir);
  await writeFile(filePath, "", "utf-8");
  return filePath;
}

/**
 * Watch the denial ledger so the stream loop learns about a hook denial the
 * moment it is written — not on the next tool_call event.
 *
 * The hook appends to denials.jsonl BEFORE Cursor surfaces the failure to the
 * model, so a filesystem notification is the earliest possible signal that a
 * turn must pause. The watcher deliberately does NOT read the file itself: it
 * only flips the caller's dirty flag, and the stream loop confirms with a
 * readDenialLedger() — a notification can fire for the per-turn reset
 * truncation too, and only a read distinguishes "reset to empty" from "denial
 * appended". Watching the DIRECTORY (not the file) survives the file being
 * replaced/truncated between turns.
 *
 * fs.watch is best-effort by platform contract, so this is an accelerator,
 * never the only trigger: the stream loop keeps its tool_call-event read as
 * the backstop. On any watcher error we fall back to that backstop silently.
 *
 * Returns a close function, idempotent and safe to call on every exit path.
 */
export function watchDenialLedger(hitlDir: string, onDirty: () => void): () => void {
  try {
    const watcher = watch(hitlDir, (_eventType, filename) => {
      if (!filename || filename === DENIAL_LEDGER_FILE) onDirty();
    });
    // Without an error listener a watcher error crashes the process; with one,
    // the watcher just goes quiet and the tool_call backstop takes over.
    watcher.on("error", () => {});
    return () => {
      try {
        watcher.close();
      } catch {
        // Already closed — nothing to release.
      }
    };
  } catch {
    // Watch unsupported on this platform/filesystem — backstop only.
    return () => {};
  }
}

/**
 * Read the denial ledger written by the hook during the turn. Missing file →
 * no denials. Blank or partially-written lines are tolerated (the hook appends
 * line-by-line and a run can be interrupted), so a malformed tail never hides
 * the valid denials before it.
 */
export async function readDenialLedger(
  hitlDir: string,
): Promise<DeniedLedgerEntry[]> {
  let raw: string;
  try {
    raw = await readFile(denialLedgerPath(hitlDir), "utf-8");
  } catch {
    return [];
  }

  const entries: DeniedLedgerEntry[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const obj = JSON.parse(trimmed) as {
        toolName?: unknown;
        token?: unknown;
        kind?: unknown;
        input?: unknown;
        message?: unknown;
        hook?: unknown;
      };
      if (typeof obj.token === "string" && obj.token) {
        entries.push({
          toolName: typeof obj.toolName === "string" ? obj.toolName : "",
          token: obj.token,
          // A garbled/missing kind degrades to undefined → approval (the
          // pre-kind format); see denialKindOf.
          kind: typeof obj.kind === "string" && obj.kind ? obj.kind : undefined,
          input: decodeLedgerInput(obj.input),
          ...(typeof obj.message === "string" && obj.message
            ? { message: Buffer.from(obj.message, "base64").toString("utf-8") }
            : {}),
          // base64 of the plugin's slug; "" (the agent's own block) is written as a lone "=" sentinel.
          ...(typeof obj.hook === "string" && obj.hook
            ? { hook: obj.hook === "=" ? "" : Buffer.from(obj.hook, "base64").toString("utf-8") }
            : {}),
        });
      }
    } catch {
      // Tolerate a partial trailing line from an interrupted hook append.
    }
  }
  return entries;
}

/**
 * Decode the hook's base64(JSON(tool_input)) into the authoritative args object,
 * or undefined when absent/garbage. Tolerant by construction: a bad capture must
 * never drop the denial it rides on — the gate still surfaces, just without the
 * richer preview.
 */
function decodeLedgerInput(raw: unknown): Record<string, unknown> | undefined {
  if (typeof raw !== "string" || raw.length === 0) return undefined;
  try {
    const json = Buffer.from(raw, "base64").toString("utf-8");
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Active-turn pointer (runner → stable hook): the per-turn indirection that makes
// a single, process-cached hook script resolve the CURRENT execution's artifacts
// ─────────────────────────────────────────────────────────────────────────────

const ACTIVE_POINTER_FILE = "active.json";

/**
 * The current turn's artifact paths, written by the runner into the WORKSPACE's
 * gate directory and read by the stable hook script on every invocation.
 *
 * Why this exists: the Cursor SDK caches `.cursor/hooks.json` (the hook script
 * PATH) for the runner process, so the script must be STABLE across executions
 * (a per-session script gets cached at the first execution and reused for all
 * later ones — recording their denials to the FIRST session's ledger, leaving the
 * current runner's ledger empty so it completes instead of pausing). The stable
 * script bakes in NO per-session paths; it reads this pointer instead, which the
 * runner repoints every turn to the current execution's state file, denial
 * ledger, and runner PID.
 */
export interface ActiveTurnPointer {
  /** Absolute path of THIS turn's approval-state file (hook input). */
  stateFile: string;
  /** Absolute path of THIS turn's denial ledger (hook output the runner reads). */
  ledgerFile: string;
  /** PID of the runner that owns THIS turn (the hook's scope-guard anchor). */
  runnerPid: number;
  /**
   * The turn's hook server (`hook-server.ts`), present only when the agent
   * has hooks: its socket, and the per-turn token a request must carry.
   */
  hookSocket?: string;
  hookToken?: string;
}

/** Absolute path of the active-turn pointer inside a workspace's gate directory. */
export function activePointerPath(gateDir: string): string {
  return join(gateDir, ACTIVE_POINTER_FILE);
}

/**
 * Atomically point the workspace's stable hook at the current turn's artifacts.
 *
 * Written compactly (the hook's grep fallback parses `"key":"value"` with no
 * spaces) and atomically (write a temp sibling, then rename) so a hook firing
 * concurrently with the write never reads a half-written pointer. Returns the
 * pointer path.
 */
export async function writeActiveTurnPointer(
  gateDir: string,
  pointer: ActiveTurnPointer,
): Promise<string> {
  await mkdir(gateDir, { recursive: true });
  const filePath = activePointerPath(gateDir);
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(tmpPath, JSON.stringify(pointer), "utf-8");
  await rename(tmpPath, filePath);
  return filePath;
}

/**
 * Remove the active-turn pointer on teardown so the gate is INERT between turns:
 * a hook that fires when no turn is active (a leftover cached hooks.json, the
 * user's own IDE) reads no pointer and allows immediately. Best-effort — a
 * teardown failure must never fail the execution, and a stale pointer is itself
 * inert once its runnerPid is gone (the scope guard fails closed to allow).
 */
export async function removeActiveTurnPointer(gateDir: string): Promise<void> {
  try {
    await rm(activePointerPath(gateDir), { force: true });
  } catch {
    // Already gone or unwritable — nothing to clean.
  }
}

/**
 * Reconstruct the adjudicated approvals for a HITL reinvocation directly from
 * the tool calls in messages.
 *
 * The tool call — not pending_approvals — is the source of truth for an approval
 * decision. The backend projects pending_approvals from tool-call status
 * (PendingApprovalComputer) and CLEARS entries once they carry an approval_action,
 * so by the time the workflow reinvokes this activity, pending_approvals is empty
 * and the decision survives only on the tool call (status WAITING_APPROVAL +
 * approval_action set). The runtime reads the same rows for the decisions
 * themselves (`harness/approval-decisions.ts` `approvalDecisionsOf`, on
 * `TurnInput.approvalDecisions`, for every harness); this reader exists for
 * the two facts only this harness needs beside them — the pending-approval
 * protos the grant and prompt builders take, and the content digests for the
 * exact grant — and a test pins the two readers' agreement.
 *
 * Returns a PendingApproval list reconstructed from those tool calls (so the
 * existing grant/prompt builders work unchanged) alongside the decision map.
 */
export interface AdjudicatedApprovals {
  pendingApprovals: PendingApproval[];
  decisions: Map<string, ApprovalAction>;
  /**
   * tool-call id -> content digest of the approved edit, for the content-exact
   * grant. Sourced from the persisted `approval_content_digest` field (stable,
   * immune to the size-limit elision that can drop `args`), falling back to a
   * recompute from `args` only when the field is absent (an execution that
   * predates the field). Empty for a non-content tool — the grant then degrades
   * to the coarse token.
   */
  contentDigests: Map<string, string>;
  /** The approvals a hook asked for, by tool-call id: a refusal of one binds that exact call ({@link buildPersonRefusals}). */
  hookAsked: Set<string>;
}

export function reconstructAdjudicatedApprovals(
  messages: AgentMessage[],
): AdjudicatedApprovals {
  const pendingApprovals: PendingApproval[] = [];
  const decisions = new Map<string, ApprovalAction>();
  const contentDigests = new Map<string, string>();
  const hookAsked = new Set<string>();

  for (const msg of messages) {
    for (const tc of msg.toolCalls) {
      if (tc.status !== ToolCallStatus.TOOL_CALL_WAITING_APPROVAL) continue;
      if (tc.approvalAction === ApprovalAction.UNSPECIFIED) continue;

      decisions.set(tc.id, tc.approvalAction);
      if (tc.approvalPolicySource === ApprovalPolicySource.HOOK) hookAsked.add(tc.id);
      // Prefer the persisted digest (set at the gate from the authoritative
      // captured input, and never elided); recompute from args only for an
      // execution that predates the field.
      contentDigests.set(
        tc.id,
        tc.approvalContentDigest ||
          (tc.args ? contentDigest(tc.args as Record<string, unknown>) : ""),
      );
      pendingApprovals.push(
        create(PendingApprovalSchema, {
          toolCallId: tc.id,
          toolName: tc.name,
          message: tc.approvalMessage,
          argsPreview: tc.argsPreview,
          mcpServerSlug: tc.mcpServerSlug,
          requestedAt: tc.approvalRequestedAt,
        }),
      );
    }
  }

  return { pendingApprovals, decisions, contentDigests, hookAsked };
}
