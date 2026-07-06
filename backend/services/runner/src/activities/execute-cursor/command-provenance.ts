/**
 * Approved-command turn provenance (DD-28) — the CURSOR harness adapter over the
 * shared qualification rule ({@link qualifyTurnCommandProvenance}).
 *
 * The Cursor harness scopes a turn POSITIONALLY (messages from the turn's first
 * streamed index onward) and maps an executed command to its consent row through
 * the reinvocation grant tokens the deny-gate minted. Both mappings are Cursor's
 * own; the DD-28 rule they feed lives in `shared/filereview/command-provenance.ts`
 * so the Cursor and deep-agent qualifications cannot drift.
 *
 * (Trust boundary + fail-closed contract: see the shared module.)
 */

import type { AgentMessage } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import type { TurnCommandProvenance } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/filereview_pb";
import { qualifyTurnCommandProvenance } from "../../shared/filereview/command-provenance.js";
import { toolCallIdentityToken } from "./message-translator.js";

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
 * turn does not qualify. Scopes this turn's tool calls positionally, resolves
 * consent through the deny-gate grant tokens, and delegates the DD-28 rule to
 * {@link qualifyTurnCommandProvenance}.
 */
export function deriveTurnCommandProvenance(
  inputs: CommandProvenanceInputs,
): TurnCommandProvenance | undefined {
  const { messages, turnStartIndex, deniedTokens, grantTokenToConsentId, globalBypass } = inputs;

  // This turn's tool calls are the positional tail from the first message this
  // turn's stream produced; everything before was seeded from prior turns.
  const turnToolCalls = messages.slice(turnStartIndex).flatMap((m) => m.toolCalls);

  return qualifyTurnCommandProvenance({
    turnToolCalls,
    messages,
    // A shell whose identity token is in the denial ledger was denied by the
    // hook — this turn's pending gate, never executed.
    isExecutedCommand: (tc) => !deniedTokens.has(toolCallIdentityToken(tc)),
    // A grant token maps back to the consent row (the row carrying the
    // server-authored approval_action) that authorized this reinvocation.
    resolveDirectConsent: (tc) => grantTokenToConsentId.get(toolCallIdentityToken(tc)),
    globalBypass,
  });
}
