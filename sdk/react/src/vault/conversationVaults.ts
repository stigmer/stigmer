/**
 * Which vaults a conversation's runs read, as the setup hooks weigh them:
 * the sender's own My vault when the conversation includes it, then the
 * shared vaults it lists, in order. The two halves travel together because
 * the server stores them together (`SessionSpec.include_my_vault` and
 * `vaults`) and a run reads exactly them, nothing an agent or a default
 * adds.
 *
 * Trade-off: the setups read the vaults the person can see, which is what
 * the person's own run may use; a teammate's run in a shared conversation
 * reads the teammate's My vault, which no browser here can read, so the
 * setups judge readiness for the person at the keyboard only.
 */
import type { ResourceRef } from "@stigmer/sdk";

/** The vaults a conversation uses. */
export interface ConversationVaults {
  /** Whether each turn reads its sender's own My vault, first. */
  readonly includeMyVault: boolean;
  /** The shared vaults the conversation lists, in order. */
  readonly vaults: readonly ResourceRef[];
}

/** A conversation that reads only its sender's My vault: what a setup hook assumes when told nothing. */
export const MY_VAULT_ONLY: ConversationVaults = { includeMyVault: true, vaults: [] };

/**
 * A content key for a vault choice, so hooks re-evaluate when what a run
 * reads changes and not when a host passes a fresh object of the same
 * choice.
 */
export function conversationVaultsKey(choice: ConversationVaults): string {
  const listed = choice.vaults.map((ref) => `${ref.org}/${ref.slug}`).join(",");
  return `${choice.includeMyVault ? "mine" : "-"}|${listed}`;
}
