/**
 * The organization that administers an account, as a derived rule on the
 * identity account type (fga/model/iam/identity_account.fga):
 *
 *   - `organization` on an identity account:
 *     `identity_account:<id>#organization@organization:<metadata.org>`,
 *     for a row whose provisioning mode is `service_account` or
 *     `app_user`, and for no other. It feeds `admin from organization` on
 *     the account (its organization's admins view, rename and delete it,
 *     and hold `can_manage_keys`) and, through the key's owner, on the
 *     keys that speak for it.
 *
 * Two kinds of account belong to an organization rather than to a person
 * who signed in on their own. A service account is the organization's
 * machine. An app user is a person the organization's product signs in
 * through `mintUserToken` (domain/token/mint.ts): the product owns that
 * relationship, so its organization's admins must be able to remove the
 * account, and the next mint creates it again with only the sign-in role
 * (#3104). Neither link lets an admin speak as the account: keys are
 * created for service accounts alone (domain/apikey/controller.ts).
 *
 * A person's own account (`direct`, or no mode), and a federated account,
 * answer nothing, even when the row names an organization: nobody but the
 * person reaches it, and a federated account is removed through its
 * provider's organization by its own RPC. A row of either administered
 * mode with no organization answers nothing too, so nobody manages it but
 * itself. Derived from the row, the link can never disagree with the
 * account's own `metadata.org`. An edition that stores tuples keeps the
 * edge from `onServiceAccountLinked` and `onAppUserLinked`
 * (extensions/resource-authorization.ts); open source derives it here.
 */
import { isMessage } from "@bufbuild/protobuf";

import { IdentityAccountSchema } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountProvisioningMode } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/enum_pb";

import type { DerivedRelation } from "./rewrite.js";

const ORGANIZATION_TYPE = "organization";

/** The provisioning modes whose accounts their organization's admins administer. */
const ADMINISTERED_MODES: ReadonlySet<IdentityAccountProvisioningMode> = new Set([
  IdentityAccountProvisioningMode.service_account,
  IdentityAccountProvisioningMode.app_user,
]);

export const administeringOrganization: DerivedRelation = (object, row) => {
  if (
    !isMessage(row, IdentityAccountSchema) ||
    !ADMINISTERED_MODES.has(
      row.spec?.provisioningMode ??
        IdentityAccountProvisioningMode.identity_account_provisioning_mode_unspecified,
    )
  ) {
    return Promise.resolve([]);
  }
  const org = row.metadata?.org ?? "";
  if (org === "") {
    return Promise.resolve([]);
  }
  return Promise.resolve([
    {
      object,
      relation: "organization",
      subject: {
        form: "object",
        object: { type: ORGANIZATION_TYPE, id: org },
      },
    },
  ]);
};
