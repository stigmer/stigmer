/**
 * Approved-command turn provenance (DD-28): the runner-owned qualification for
 * the auto-keep policy.
 *
 * A turn whose ONLY mutation source was shell commands the human had already
 * authorized should not re-gate its file effects at the turn-boundary review —
 * the user consented to the command, and the command's file effects are the
 * consented outcome. The server cannot derive this itself (tool calls carry no
 * turn marker), so the runner — the only component that owns turn scoping —
 * derives the facts here and attaches them to the CANDIDATE_CAPTURED event as
 * {@link TurnCommandProvenance}.
 *
 * TRUST BOUNDARY. This module asserts turn FACTS (which tools ran this turn),
 * the same trust level as the captured bytes themselves. It never asserts
 * CONSENT: `consentToolCallIds` merely POINT at transcript rows whose
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
import type { AgentMessage } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { TurnCommandProvenanceSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/filereview_pb";
import type { TurnCommandProvenance } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/filereview_pb";
import { ApprovalAction, ToolKind } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { classifyTool, toolApprovalCategory } from "../../shared/tool-kind.js";
import { isToolCallRowHidden } from "../../shared/tool-row.js";
import { toolCallIdentityToken } from "./message-translator.js";

/**
 * Tool kinds that can never mutate the workspace: their presence in a turn is
 * irrelevant to change-set provenance. Everything OUTSIDE this set is either a
 * consent-mapped shell command or a disqualifier — never silently ignored.
 */
const NON_MUTATING_KINDS: ReadonlySet<ToolKind> = new Set([
  ToolKind.FILE_READ,
  ToolKind.SEARCH,
  ToolKind.LIST,
  ToolKind.FETCH,
  ToolKind.WEB_SEARCH,
  ToolKind.THINK,
  ToolKind.TODO,
]);

export interface CommandProvenanceInputs {
  /**
   * The full transcript at capture time. Turn scoping is positional: messages
   * from index {@link turnStartIndex} onward were produced by THIS turn's
   * stream; everything before was seeded from prior turns. Lease consent rows
   * (APPROVE_ALL) are looked up across the WHOLE transcript — a lease is
   * run-lifetime, its granting row usually lives in a prior turn.
   */
  readonly messages: readonly AgentMessage[];
  /** Index of the first message created by this turn's stream. */
  readonly turnStartIndex: number;
  /**
   * Identity tokens the hook denied THIS turn (the denial ledger). A denied
   * shell row never executed — it is this turn's pending gate, not a mutation
   * source — so it neither needs consent nor disqualifies.
   */
  readonly deniedTokens: ReadonlySet<string>;
  /**
   * Grant token → the tool-call id of the approval row that minted the grant
   * (the row carrying the server-authored approval_action). An executed shell
   * command whose identity token is a key here was authorized by that
   * per-command approval.
   */
  readonly grantTokenToConsentId: ReadonlyMap<string, string>;
  /** True when the pre-armed spec.auto_approve_all bypassed the gate. */
  readonly globalBypass: boolean;
}

/**
 * Derive the {@link TurnCommandProvenance} for the turn, or undefined when the
 * turn does not qualify (any non-shell mutation-capable call, any unknown tool,
 * any executed command without a provable consent source, or no executed
 * consented command at all).
 */
export function deriveTurnCommandProvenance(
  inputs: CommandProvenanceInputs,
): TurnCommandProvenance | undefined {
  const { messages, turnStartIndex, deniedTokens, grantTokenToConsentId, globalBypass } = inputs;

  const consentIds = new Set<string>();
  let authorizedByAutoApproveAll = false;
  let executedCommandCount = 0;

  for (let i = turnStartIndex; i < messages.length; i++) {
    for (const tc of messages[i].toolCalls) {
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

      const token = toolCallIdentityToken(tc);
      if (deniedTokens.has(token)) {
        // This turn's pending gate — denied by the hook, never executed.
        continue;
      }
      executedCommandCount++;

      const consentId = grantTokenToConsentId.get(token);
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
      // be impossible (the hook gates every un-consented shell); if it ever
      // happens, the honest answer is a manual review, not a waived one.
      return undefined;
    }
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
function findLeaseConsentId(
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
