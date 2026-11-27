import { IdentityAccountProvisioningMode } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/enum_pb";
import type { Stigmer } from "@stigmer/client";

/**
 * Whether the signed-in account is an app user: a person signed in to a
 * host's product through a token the host's backend mints
 * (`provisioning_mode: app_user`). The server's rule for their own turn
 * (`domain/vault/resolve.ts` in the server): it reads only the logins in
 * their My vault, each for the tool at its address, never a key by name
 * from it; keys by name come from the vaults the integrator chose, which
 * this client cannot read. A caller `whoAmI` does not answer (a guest, an
 * account not made yet) is not one.
 *
 * Read by `useAgentSetup` and `usePersonalKeys`, so the composer and the
 * key line count what the server reads.
 */
export async function isAppUser(stigmer: Pick<Stigmer, "identityAccount">): Promise<boolean> {
  try {
    const account = await stigmer.identityAccount.whoAmI();
    return account.spec?.provisioningMode === IdentityAccountProvisioningMode.app_user;
  } catch {
    return false;
  }
}
