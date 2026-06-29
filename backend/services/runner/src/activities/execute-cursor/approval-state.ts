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
 *   "mcpToolPolicies": {
 *     "apply_cloud_resource": { "requiresApproval": true, "message": "..." }
 *   },
 *   "approvedGrants": [{ "toolName": "edit", "mcpServerSlug": "", "key": "write", "salient": "a.txt", "contentDigest": "<sha256>" }],
 *   "approvedGrantTokens": ["<base64(key\nsalient[\ncontentDigest])>"]
 * }
 *
 * A grant token is the action's PRIMARY token: base64(key \n salient \n digest)
 * for a content-identified file edit (so a DIFFERENT edit to the same file does
 * not match), or base64(key \n salient) for shell/delete/MCP and the rare
 * content-less fallback. See {@link primaryToken}.
 *
 * The hook gates the dangerous built-in set and the MCP tools that require
 * approval (mcpToolPolicies, which by construction holds only require-approval
 * entries); every other tool is allowed. The gated built-in set and its
 * name->category mapping are baked into the generated hook script (from
 * approval-policy.ts), not carried in the state file — only the dynamic inputs
 * (autoApproveAll, leasedCategories, mcpToolPolicies, approvedGrantTokens) live
 * here. This mirrors the native harness and avoids denying auto-approved MCP
 * tools, which are absent from the policy map and indistinguishable from unknown
 * tools by name.
 *
 * Approval leases (the scoped successor to autoApproveAll): `autoApproveAll` is
 * now ONLY the pre-armed spec.auto_approve_all global bypass. An interactive
 * "approve all" of a given class becomes a run-lifetime lease: a built-in
 * category lease is listed in `leasedCategories` (the hook allows any built-in of
 * that category), and an MCP-server lease is applied upstream by dropping the
 * server's tools from mcpToolPolicies (so the hook allows them as auto-approved)
 * — the hook is not server-aware, so omission is the lever there.
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
 * denial ledger (denials.jsonl): when the hook denies a tool, it appends
 * the call's identity token to this file. The runner reads the ledger after the
 * run to learn which tool calls were gated — the hook is the only component that
 * actually makes the per-call allow/deny decision, so its ledger is the
 * authoritative "what was denied this turn" signal (the cursor analog of the
 * native harness's LangGraph interrupts). The token uses the SAME identity space
 * as approvedGrantTokens, so a denial token approved this turn becomes a grant
 * token next turn.
 */

import { writeFile, readFile, mkdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { create } from "@bufbuild/protobuf";
import { ApprovalAction, ToolCallStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { PendingApprovalSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/approval_pb";
import type { PendingApproval } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/approval_pb";
import type { AgentMessage } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import type { MergedToolPolicy, ApprovalCategory } from "./approval-policy.js";
import { extractArgKey, approvalCategory, POLICY_ENGINE_VERSION } from "./approval-policy.js";
import { contentDigest } from "../../shared/file-tools.js";
import {
  fingerprintCoarseIdentity,
  type FingerprintKey,
} from "../../shared/approval-fingerprint.js";

export interface McpToolPolicyEntry {
  requiresApproval: boolean;
  message?: string;
}

/**
 * The canonical, taxonomy-agnostic identity of a tool call.
 *
 * The Cursor preToolUse hook and the SDK stream name the same operation
 * differently (hook `Write`/`Shell`/`Delete`; stream `edit`/`shell`/`delete`),
 * so the raw tool name cannot be a cross-layer identity. Instead:
 * - `key` is the {@link approvalCategory} (`write`/`delete`/`shell`) for gated
 *   built-ins, and the tool name for MCP tools (whose name is consistent across
 *   layers). It is the part that survives the name divergence.
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
    return { key: toolName, salient: "" };
  }
  const category = approvalCategory(toolName);
  // A gated built-in keys on its category; an unknown/non-gated tool falls back
  // to its own name (harmless — it is not gated, so it never enters the ledger).
  return { key: category ?? toolName, salient: extractArgKey(args) };
}

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
}

export interface ApprovalStateFile {
  /** Pre-armed spec.auto_approve_all: the whole-run global bypass. */
  autoApproveAll: boolean;
  /**
   * Built-in approval categories with a run-lifetime lease (the scoped successor
   * to a global "approve all"). The hook allows any built-in whose category is
   * listed. MCP-server leases are NOT listed here — they are applied by dropping
   * the server's tools from mcpToolPolicies, since the hook is not server-aware.
   */
  leasedCategories: string[];
  mcpToolPolicies: Record<string, McpToolPolicyEntry>;
  approvedGrants: ApprovalGrant[];
  approvedGrantTokens: string[];
  /**
   * Capture mode (git workspaces): when true, the hook ALLOWS file mutations
   * (write/edit/delete) to flow during the turn, because the runner captures the
   * whole change set with git at the turn boundary and gates it per-file for
   * review (see shadow-capture.ts). The ONLY exception is a write/delete whose
   * path is gitignored — the git snapshot cannot capture or revert it, so the
   * hook keeps gating those (it runs `git check-ignore`). shell and MCP stay
   * gated as always. False (the default) keeps the classic deny-gate behavior
   * for every file mutation (non-git workspaces / the fallback path).
   */
  captureMode: boolean;
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
 * The shared HMAC coarse fingerprint of an approval grant.
 *
 * This is the SAME canonical coarse identity the wire token (grantToken) encodes
 * — `(key, salient)` plus the MCP slug — run through the one shared HMAC+canonical
 * path ({@link fingerprintCoarseIdentity}). It is NOT the hook's wire-match value:
 * the hook matches on the mechanically-reproducible base64 token (a bash script
 * can recompute base64 but not a keyed HMAC over a workspace-root-normalized
 * salient). This fingerprint is the cross-substrate, anti-forgery identity used
 * for the runner-side shadow receipt today and as the successor wire token once a
 * lease becomes a server-issued bearer token (Phase 7). Because it shares the
 * exact category + salient the token uses, the hook-side and stream-side
 * fingerprints of one action are equal by construction (see the parity tests).
 */
export function grantFingerprint(key: FingerprintKey, grant: ApprovalGrant): string {
  return fingerprintCoarseIdentity(key, {
    tool: grant.key,
    mcpServerSlug: grant.mcpServerSlug,
    salient: grant.salient,
  });
}

/**
 * Emit a best-effort shadow ExecutionReceipt for each grant the runner issues
 * this turn (Phase 2, mirror of the deep-agent gateway's receipt).
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
  decisions: Map<string, ApprovalAction>,
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
    });
  }
  return grants;
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
 * Build the approval state file content from merged policies and any approval
 * grants from a previous HITL cycle.
 *
 * The state file carries the hook script's DYNAMIC inputs:
 * - globalBypass: the pre-armed spec.auto_approve_all (written as autoApproveAll)
 * - leasedCategories: built-in categories with a run-lifetime lease
 * - mcpToolPolicies: per-tool policy for MCP tools requiring approval (leased
 *   servers are already absent — dropped upstream by mergeApprovalPolicies)
 * - approvedGrants / approvedGrantTokens: tools approved in the current HITL
 *   cycle, allowed through on reinvocation
 *
 * The static gated built-in set and its category mapping are baked into the
 * generated hook script (from approval-policy.ts), not carried here.
 */
export function buildApprovalState(
  mergedPolicies: Map<string, MergedToolPolicy>,
  globalBypass: boolean,
  leasedCategories: ReadonlySet<ApprovalCategory>,
  grants?: ApprovalGrant[],
  captureMode = false,
): ApprovalStateFile {
  const approvedGrants = grants ?? [];

  const mcpToolPolicies: Record<string, McpToolPolicyEntry> = {};
  for (const policy of mergedPolicies.values()) {
    mcpToolPolicies[policy.toolName] = {
      requiresApproval: policy.requiresApproval,
      message: policy.approvalMessage,
    };
  }

  return {
    autoApproveAll: globalBypass,
    leasedCategories: [...leasedCategories],
    mcpToolPolicies,
    approvedGrants,
    // The hook matches a tool call's PRIMARY token (content when it can compute a
    // digest from tool_input, else coarse). A content-identified grant authorizes
    // only its exact content; a content-less grant authorizes the coarse token.
    approvedGrantTokens: approvedGrants.map((g) => primaryToken(g.key, g.salient, g.contentDigest)),
    captureMode,
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
 * One denial recorded by the preToolUse hook. `token` is the call's identity in
 * the same space as grantToken() (base64 of `toolName \n salientArg`), used to
 * correlate the denial back to the streamed tool call. `toolName` is carried raw
 * for human-readable debugging of the ledger file.
 *
 * `input` is the authoritative pre-execution tool arguments the hook captured
 * from the Cursor `tool_input` payload (decoded from the ledger's base64 form).
 * It is the cursor analog of the native harness reading the AI-message tool-call
 * args out of graph state at the LangGraph interrupt — the one place the COMPLETE
 * proposed change is in hand before the tool runs. The runner overlays it onto
 * the gated tool call so the approval card can show the proposed content/diff
 * before the user approves. Absent when the hook ran its grep fallback (the Node
 * binary was unavailable), in which case the gate degrades to stream-recovered
 * args exactly as before.
 */
export interface DeniedLedgerEntry {
  toolName: string;
  token: string;
  input?: Record<string, unknown>;
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
      const obj = JSON.parse(trimmed) as { toolName?: unknown; token?: unknown; input?: unknown };
      if (typeof obj.token === "string" && obj.token) {
        entries.push({
          toolName: typeof obj.toolName === "string" ? obj.toolName : "",
          token: obj.token,
          input: decodeLedgerInput(obj.input),
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
 * approval_action set). This mirrors the native harness
 * (execute-deep-agent/hitl.ts extractApprovalDecisions).
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
}

export function reconstructAdjudicatedApprovals(
  messages: AgentMessage[],
): AdjudicatedApprovals {
  const pendingApprovals: PendingApproval[] = [];
  const decisions = new Map<string, ApprovalAction>();
  const contentDigests = new Map<string, string>();

  for (const msg of messages) {
    for (const tc of msg.toolCalls) {
      if (tc.status !== ToolCallStatus.TOOL_CALL_WAITING_APPROVAL) continue;
      if (tc.approvalAction === ApprovalAction.UNSPECIFIED) continue;

      decisions.set(tc.id, tc.approvalAction);
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

  return { pendingApprovals, decisions, contentDigests };
}
