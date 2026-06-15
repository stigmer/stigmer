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
 *   "mcpToolPolicies": {
 *     "apply_cloud_resource": { "requiresApproval": true, "message": "..." }
 *   },
 *   "approvedGrants": [{ "toolName": "edit", "mcpServerSlug": "", "key": "write", "salient": "a.txt" }],
 *   "approvedGrantTokens": ["d3JpdGUKYS50eHQ="]
 * }
 *
 * The hook gates the dangerous built-in set and the MCP tools that require
 * approval (mcpToolPolicies, which by construction holds only require-approval
 * entries); every other tool is allowed. The gated built-in set and its
 * name->category mapping are baked into the generated hook script (from
 * approval-policy.ts), not carried in the state file — only the dynamic inputs
 * (autoApproveAll, mcpToolPolicies, approvedGrantTokens) live here. This mirrors
 * the native harness and avoids denying auto-approved MCP tools, which are
 * absent from the policy map and indistinguishable from unknown tools by name.
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

import { writeFile, readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { create } from "@bufbuild/protobuf";
import { ApprovalAction, ToolCallStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { PendingApprovalSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/approval_pb";
import type { PendingApproval } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/approval_pb";
import type { AgentMessage } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import type { MergedToolPolicy } from "./approval-policy.js";
import { extractArgKey, approvalCategory } from "./approval-policy.js";

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
}

export interface ApprovalStateFile {
  autoApproveAll: boolean;
  mcpToolPolicies: Record<string, McpToolPolicyEntry>;
  approvedGrants: ApprovalGrant[];
  approvedGrantTokens: string[];
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
 * Build approval grants from the pending approvals the user adjudicated and
 * their decisions. Only APPROVE / APPROVE_ALL decisions produce grants. Each
 * grant carries the canonical {@link ToolIdentity} (category + salient resource)
 * so the hook allows the exact approved resource on the resumed turn.
 */
export function buildApprovalGrants(
  pendingApprovals: PendingApproval[],
  decisions: Map<string, ApprovalAction>,
): ApprovalGrant[] {
  const grants: ApprovalGrant[] = [];
  for (const pa of pendingApprovals) {
    // Both APPROVE and APPROVE_ALL allow the adjudicated tool through on the
    // resumed turn. APPROVE_ALL additionally flips autoApproveAll for the whole
    // run (handled by the caller via hasApproveAllDecision), but we still emit a
    // grant here so the clicked tool is allowed regardless of how the hook reads
    // the state file.
    const decision = decisions.get(pa.toolCallId);
    if (decision !== ApprovalAction.APPROVE && decision !== ApprovalAction.APPROVE_ALL) continue;

    const id = toolIdentity(pa.toolName, pa.mcpServerSlug, parseArgs(pa.argsPreview));
    grants.push({
      toolName: pa.toolName,
      mcpServerSlug: pa.mcpServerSlug,
      key: id.key,
      salient: id.salient,
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
 * - mcpToolPolicies: per-tool policy for MCP tools requiring approval
 * - approvedGrants / approvedGrantTokens: tools approved in the current HITL
 *   cycle, allowed through on reinvocation
 *
 * The static gated built-in set and its category mapping are baked into the
 * generated hook script (from approval-policy.ts), not carried here.
 */
export function buildApprovalState(
  mergedPolicies: Map<string, MergedToolPolicy>,
  autoApproveAll: boolean,
  grants?: ApprovalGrant[],
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
    autoApproveAll,
    mcpToolPolicies,
    approvedGrants,
    approvedGrantTokens: approvedGrants.map((g) => grantToken(g.key, g.salient)),
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
 */
export interface DeniedLedgerEntry {
  toolName: string;
  token: string;
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
      const obj = JSON.parse(trimmed) as Partial<DeniedLedgerEntry>;
      if (typeof obj.token === "string" && obj.token) {
        entries.push({
          toolName: typeof obj.toolName === "string" ? obj.toolName : "",
          token: obj.token,
        });
      }
    } catch {
      // Tolerate a partial trailing line from an interrupted hook append.
    }
  }
  return entries;
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
}

export function reconstructAdjudicatedApprovals(
  messages: AgentMessage[],
): AdjudicatedApprovals {
  const pendingApprovals: PendingApproval[] = [];
  const decisions = new Map<string, ApprovalAction>();

  for (const msg of messages) {
    for (const tc of msg.toolCalls) {
      if (tc.status !== ToolCallStatus.TOOL_CALL_WAITING_APPROVAL) continue;
      if (tc.approvalAction === ApprovalAction.UNSPECIFIED) continue;

      decisions.set(tc.id, tc.approvalAction);
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

  return { pendingApprovals, decisions };
}
