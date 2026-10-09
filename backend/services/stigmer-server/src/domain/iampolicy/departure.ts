/**
 * A person's departure from an organization: what the grant path's sweep
 * hands the composition once it has revoked the person's rows there
 * (grant-path.ts `OrganizationDepartureHandler`). The person's My vault in
 * that organization is deleted through the vault delete chain's tail
 * (domain/vault/delete.ts `deleteMyVaultOf`): the row, its grants, every
 * sealed value's backing state and the name that kept it one per person.
 * Their logins and secrets leave with them, destroyed rather than left
 * sealed until the organization is purged, and a person who returns starts
 * with an empty My vault.
 *
 * Idempotent: a person with no My vault there is a no-op, so a retried
 * revoke converges. A failure propagates to the revoke (the module header
 * of grant-path.ts says why that is the posture).
 *
 * Proven by __tests__/departure.test.ts.
 */
import type { Logger } from "../../boot/logger.js";
import type { SecretService } from "../../encryption/encryption.js";
import type { ResourceAuthorizationLifecycle } from "../../extensions/resource-authorization.js";
import type { Store } from "../../store/interface.js";
import { deleteMyVaultOf } from "../vault/delete.js";
import type { VaultService } from "../vault/service.js";

import type { OrganizationDepartureHandler } from "./grant-path.js";

export interface MyVaultDepartureDeps {
  readonly store: Store;
  readonly logger: Logger;
  readonly secretService: SecretService;
  readonly authorizationLifecycle: ResourceAuthorizationLifecycle | undefined;
  readonly vaults: VaultService;
}

/** The departure handler that deletes the leaving person's My vault. */
export function newMyVaultDeparture(
  deps: MyVaultDepartureDeps,
): OrganizationDepartureHandler {
  return async (identityAccountId, organizationId, caller) => {
    const deleted = await deleteMyVaultOf(
      deps,
      organizationId,
      identityAccountId,
      caller,
    );
    if (deleted) {
      deps.logger.info("my vault deleted with its person's departure", {
        identityAccountId,
        organizationId,
      });
    }
  };
}
