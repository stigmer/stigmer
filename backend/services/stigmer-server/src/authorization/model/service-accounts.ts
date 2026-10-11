/**
 * A service account's organization, as a derived rule on the identity
 * account type (fga/model/iam/identity_account.fga):
 *
 *   - `organization` on an identity account:
 *     `identity_account:<id>#organization@organization:<metadata.org>`,
 *     for a row whose provisioning mode is `service_account` and for no
 *     other. It feeds `admin from organization` on the account (its
 *     organization's admins view, rename and delete it, and hold
 *     `can_manage_keys`) and, through the key's owner, on the keys that
 *     speak for it.
 *
 * A person's account, a platform client's end user and every other mode
 * answer nothing, even when the row names an organization: only a service
 * account is administered by its organization. A service-account row with
 * no organization answers nothing too, so nobody manages it but itself.
 * Derived from the row, the link can never disagree with the account's own
 * `metadata.org`. An edition that stores tuples keeps the edge from
 * `onServiceAccountLinked` (extensions/resource-authorization.ts); open
 * source derives it here.
 */
import { isMessage } from "@bufbuild/protobuf";

import { IdentityAccountSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountProvisioningMode } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/enum_pb";

import type { DerivedRelation } from "./rewrite.js";

const ORGANIZATION_TYPE = "organization";

export const serviceAccountOrganization: DerivedRelation = (object, row) => {
  if (
    !isMessage(row, IdentityAccountSchema) ||
    row.spec?.provisioningMode !== IdentityAccountProvisioningMode.service_account
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
