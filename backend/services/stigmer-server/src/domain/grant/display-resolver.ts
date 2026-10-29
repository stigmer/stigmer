/**
 * The access-list display resolver:
 * the account half of the principal display — batch-loads identity
 * accounts through the identity-account domain's PORT (`findByIds`, one
 * row per distinct id, the port's own line) and renders the
 * ApiResourceRefView shape access listings carry: display name, email,
 * avatar, identity origin. Built by the Grant controller over the accounts
 * port it already holds, never composed as a seam — the data is a domain
 * READ, the same in every edition.
 *
 * The display name is the identity-account domain's one rule for what a
 * person is called (`accountDisplayName`, identityaccount/actor.ts: first
 * + last > first > last > metadata.name > email), the same rule every
 * audit stamp built from a row and getActorInfo answer with, so a member
 * row names a person exactly as their stamps do (actor.ts says why the
 * `metadata.name` arm is in the rule).
 *
 * The federated provider label stays empty (the shared shape carries no
 * provider display-name lookup); direct accounts carry the "Stigmer"
 * label.
 */
import { create } from "@bufbuild/protobuf";

import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { IdentityAccount } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountProvisioningMode } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/enum_pb";
import type { ApiResourceRefView } from "@stigmer/apis/ai/stigmer/iam/grant/v1/io_pb";
import {
  ApiResourceRefViewSchema,
  IdentityOriginSchema,
} from "@stigmer/apis/ai/stigmer/iam/grant/v1/io_pb";

import { kindEnumName } from "../../pipeline/apiresource-meta.js";
import { accountDisplayName } from "../identityaccount/actor.js";
import type { IdentityAccountStore } from "../identityaccount/store.js";
import type { PrincipalDisplayResolver } from "./access-lists.js";

/** The provider label a direct account carries. */
const STIGMER_PROVIDER_LABEL = "Stigmer";

/** The one read enrichment needs from the identity-account port. */
export type AccountsByIds = Pick<IdentityAccountStore, "findByIds">;

export function newAccountDisplayResolver(
  accounts: AccountsByIds,
): PrincipalDisplayResolver {
  return {
    async resolveIdentityAccounts(
      ids,
    ): Promise<ReadonlyMap<string, ApiResourceRefView>> {
      const rows = await accounts.findByIds(ids);
      const resolved = new Map<string, ApiResourceRefView>();
      for (const account of rows) {
        const id = account.metadata?.id ?? "";
        resolved.set(id, viewOf(id, account));
      }
      return resolved;
    },
  };
}

function viewOf(id: string, account: IdentityAccount): ApiResourceRefView {
  const spec = account.spec;
  return create(ApiResourceRefViewSchema, {
    kind: kindEnumName(ApiResourceKind.identity_account),
    id,
    name: accountDisplayName(account),
    email: spec?.email ?? "",
    avatar: spec?.pictureUrl ?? "",
    identityOrigin: create(IdentityOriginSchema, {
      provisioningMode:
        spec?.provisioningMode ??
        IdentityAccountProvisioningMode.identity_account_provisioning_mode_unspecified,
      providerDisplayName: providerLabelOf(spec?.provisioningMode),
    }),
  });
}

function providerLabelOf(
  mode: IdentityAccountProvisioningMode | undefined,
): string {
  switch (mode) {
    case IdentityAccountProvisioningMode.direct:
      return STIGMER_PROVIDER_LABEL;
    default:
      // federated / app_user / service_account / unspecified carry no external
      // provider label.
      return "";
  }
}
