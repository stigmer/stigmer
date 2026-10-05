/**
 * The identity accounts' purge (domain/organization/purge/kind-purge.ts):
 * every account that belongs to an organization being deleted, removed with
 * its delete chain's cleanup (controller.ts `deleteAccount`: the row
 * through the port, its access).
 *
 * Which accounts. An account belongs to an organization when its row names
 * it in `metadata.org`: a platform client's end users (an account a
 * client provisions belongs to the organization, not to the client,
 * platformclient/controller.ts) and a composition's own per-organization
 * accounts. They can sign in nowhere else, so they go with it. A person's
 * own account names no organization and is never touched; leaving an
 * organization is the revocation of their rows there, which the delete has
 * done.
 *
 * The rows are read through the identity-account port a composition may
 * substitute (`IdentityAccountStore.findByOrg`), so a composition that
 * keeps accounts in its own table is followed by construction.
 */
import { IdentityAccountSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountCommandController } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/command_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { ResourceAuthorizationLifecycle } from "../../extensions/resource-authorization.js";
import { newCleanupIamPoliciesStep } from "../../pipeline/steps/authorization-tuples.js";
import { newKindPurge } from "../organization/purge/kind-purge.js";
import type {
  KindPurge,
  KindPurgeDeps,
} from "../organization/purge/kind-purge.js";
import { newDeleteAccountStep } from "./steps.js";
import type { IdentityAccountStore } from "./store.js";

export interface IdentityAccountPurgeDeps extends KindPurgeDeps {
  /** The identity-account port the composition bound. */
  readonly accounts: IdentityAccountStore;
  /** The lifecycle the identity-account controller gets (the composed driver, or open source's role lifecycle). */
  readonly accountLifecycle: ResourceAuthorizationLifecycle | undefined;
}

export function newIdentityAccountPurge(
  deps: IdentityAccountPurgeDeps,
): KindPurge {
  return newKindPurge(deps, {
    kind: ApiResourceKind.identity_account,
    schema: IdentityAccountSchema,
    input: IdentityAccountCommandController.method.delete.input,
    rows: async (org, limit) =>
      (await deps.accounts.findByOrg(org.id)).slice(0, limit),
    steps: [
      newDeleteAccountStep(deps.accounts),
      newCleanupIamPoliciesStep(deps.accountLifecycle, deps.logger),
    ],
  });
}
