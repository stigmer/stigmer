/**
 * The DD-28 approved-command turn qualification rule — the harness-agnostic core
 * of the auto-keep policy's runner-side facts.
 *
 * A turn whose ONLY mutation source was shell commands the human had already
 * authorized should not re-gate its file effects at the turn-boundary review —
 * the user consented to the command, and the command's file effects are the
 * consented outcome. The server cannot derive this itself (tool calls carry no
 * turn marker), so the runner — the only component that owns turn scoping —
 * derives the facts and attaches them to the CANDIDATE_CAPTURED event as
 * {@link TurnCommandProvenance}.
 *
 * This module owns the *qualification rule* both harnesses share; each harness
 * supplies only what genuinely differs — how "this turn's tool calls" are scoped,
 * and how a single executed command's DIRECT consent row is identified — via
 * {@link CommandProvenanceCoreInputs}. Keeping the rule in one place is what makes
 * the Cursor and deep-agent qualifications provably identical (a second copy would
 * drift on edge cases — the divergence the AI-Engineer role warns against).
 *
 * TRUST BOUNDARY. This module asserts turn FACTS (which tools ran this turn),
 * the same trust level as the captured bytes themselves. It never asserts
 * CONSENT: a resolved consent id merely POINTS at a transcript row whose
 * `approval_action` was authored by the server's SubmitApproval (and is
 * preserved against runner writes) — the backend re-verifies every claimed row
 * against that server-owned record before authoring the policy decision, so a
 * runner cannot mint authorization it was never given.
 *
 * FAIL-CLOSED. Every uncertainty disqualifies (returns undefined → the set
 * reviews manually, exactly as before DD-28): a file-tool call, an MCP tool, a
 * sub-agent delegation, an unrecognized tool name, or an executed shell command
 * with no provable consent source. Being conservative here costs only an extra
 * review; being permissive would silently waive one.
 */

import { create } from "@bufbuild/protobuf";
import type { AgentMessage, ToolCall } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { TurnCommandProvenanceSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/filereview_pb";
import type { TurnCommandProvenance } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/filereview_pb";
import { ApprovalAction, ToolKind } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { classifyTool, toolApprovalCategory } from "../tool-kind.js";
import { isToolCallRowHidden } from "../tool-row.js";

/**
 * Tool kinds that can never mutate the workspace: their presence in a turn is
 * irrelevant to change-set provenance. Everything OUTSIDE this set is either a
 * consent-mapped shell command or a disqualifier — never silently ignored.
 */
export const NON_MUTATING_KINDS: ReadonlySet<ToolKind> = new Set([
  ToolKind.FILE_READ,
  ToolKind.SEARCH,
  ToolKind.LIST,
  ToolKind.FETCH,
  ToolKind.WEB_SEARCH,
  ToolKind.THINK,
  ToolKind.TODO,
]);

/**
 * The harness-supplied inputs to the shared DD-28 qualification rule. The two
 * function inputs are exactly the two things that differ between harnesses
 * (turn scoping is expressed by which calls appear in {@link turnToolCalls}).
 */
export interface CommandProvenanceCoreInputs {
  /**
   * This turn's tool calls, already scoped by the harness (Cursor: the positional
   * slice from the turn's first streamed message; deep-agent: the calls whose id
   * is new since a pre-stream settled snapshot). Order is preserved but irrelevant.
   */
  readonly turnToolCalls: readonly ToolCall[];
  /**
   * The WHOLE transcript, for the APPROVE_ALL lease lookup — a lease is
   * run-lifetime and its granting row usually lives in a prior turn.
   */
  readonly messages: readonly AgentMessage[];
  /**
   * Whether a (shell) tool call actually EXECUTED this turn, as opposed to being
   * a pending/denied gate that produced no mutation. A non-executed shell neither
   * needs consent nor disqualifies (Cursor: not in the denial ledger; deep-agent:
   * status is COMPLETED).
   */
  readonly isExecutedCommand: (tc: ToolCall) => boolean;
  /**
   * The tool-call id of the row whose server-authored `approval_action` DIRECTLY
   * authorized this executed command, or undefined when none does (then the lease
   * / global-bypass fallbacks apply). Cursor maps a reinvocation grant token back
   * to its consent row; the deep-agent's gated command IS its own consent row
   * (same id, `approval_action` written in place).
   */
  readonly resolveDirectConsent: (tc: ToolCall) => string | undefined;
  /** True when the pre-armed spec.auto_approve_all bypassed the gate. */
  readonly globalBypass: boolean;
}

/**
 * Apply the DD-28 qualification rule to a harness-scoped turn, returning the
 * {@link TurnCommandProvenance} to attach to the candidate — or undefined when
 * the turn does not qualify (any non-shell mutation-capable call, any unknown
 * tool, any executed command without a provable consent source, or no executed
 * consented command at all).
 */
export function qualifyTurnCommandProvenance(
  inputs: CommandProvenanceCoreInputs,
): TurnCommandProvenance | undefined {
  const { turnToolCalls, messages, isExecutedCommand, resolveDirectConsent, globalBypass } = inputs;

  const consentIds = new Set<string>();
  let authorizedByAutoApproveAll = false;
  let executedCommandCount = 0;

  for (const tc of turnToolCalls) {
    // A hidden row is a collapsed twin/reaction — it never executed.
    if (isToolCallRowHidden(tc)) continue;

    const kind = classifyTool(tc.name, tc.mcpServerSlug);
    if (NON_MUTATING_KINDS.has(kind)) continue;

    if (kind !== ToolKind.SHELL) {
      // A file tool (mixed turn), a sub-agent (unattributable mutations), an
      // MCP tool (opaque side effects), or an unrecognized name — the turn's
      // mutations cannot be attributed to consented commands. Fail closed.
      return undefined;
    }

    if (!isExecutedCommand(tc)) {
      // A pending / denied shell — this turn's gate, not a mutation source.
      continue;
    }
    executedCommandCount++;

    const consentId = resolveDirectConsent(tc);
    if (consentId) {
      consentIds.add(consentId);
      continue;
    }
    const leaseConsentId = findLeaseConsentId(messages, tc.name);
    if (leaseConsentId) {
      consentIds.add(leaseConsentId);
      continue;
    }
    if (globalBypass) {
      authorizedByAutoApproveAll = true;
      continue;
    }
    // An executed shell command with no grant, no lease, and no bypass should
    // be impossible (every un-consented shell is gated); if it ever happens,
    // the honest answer is a manual review, not a waived one.
    return undefined;
  }

  // A turn that executed no consented command has nothing to attribute the
  // change set to — whatever changed came from somewhere else. Manual review.
  if (executedCommandCount === 0) return undefined;

  return create(TurnCommandProvenanceSchema, {
    consentToolCallIds: [...consentIds],
    authorizedByAutoApproveAll,
  });
}

/**
 * Find the transcript row whose APPROVE_ALL authored the run-lifetime lease
 * covering `toolName`'s category — the consent row a lease-executed command
 * cites. Searched across the whole transcript (a lease usually originates in a
 * prior turn); the first (earliest) APPROVE_ALL of the category is the lease's
 * origin. Returns undefined when no lease row exists for the category.
 */
export function findLeaseConsentId(
  messages: readonly AgentMessage[],
  toolName: string,
): string | undefined {
  const category = toolApprovalCategory(toolName);
  if (!category) return undefined;
  for (const msg of messages) {
    for (const tc of msg.toolCalls) {
      if (tc.approvalAction !== ApprovalAction.APPROVE_ALL) continue;
      if (toolApprovalCategory(tc.name) === category) return tc.id;
    }
  }
  return undefined;
}
