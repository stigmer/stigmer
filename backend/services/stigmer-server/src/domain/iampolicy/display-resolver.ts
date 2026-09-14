/**
 * The access-list display resolver (20260913.01 slice 5; Q-S5-4, Q-S5-8):
 * the account half of the Java PrincipalEnricher — batch-loads identity
 * accounts through the identity-account domain's PORT (`findByIds`, one
 * row per distinct id, the port's own line) and renders the
 * ApiResourceRefView shape access listings carry: display name, email,
 * avatar, identity origin. Moved from the cloud's iam/account/
 * display-resolver.ts; built by the IamPolicy controller over the accounts
 * port it already holds, never composed as a seam — the data is a domain
 * READ, the same in every edition.
 *
 * The display-name precedence is `first + last > first > last >
 * metadata.name > email`. The `metadata.name` arm is this domain's one
 * deliberate divergence from the Java code (Q-S5-4): the trusted-local
 * operator account carries its display name THERE and empty first/last
 * names (identityaccount/operator.ts), while the cloud names every
 * provisioned account by its EMAIL and fills first/last from userinfo
 * (identityaccount/provisioning.ts; the DefaultAccountName step) — so on
 * the cloud this arm and the email arm answer the same string, and on a
 * laptop the Members row reads the name the operator configured instead
 * of an address. `email` stays as the last resort for a row whose name
 * was never defaulted.
 *
 * The federated provider label stays empty (the cloud's 3C provider
 * display-name lookup never landed in the shared shape); direct and
 * machine accounts carry the "Stigmer" label, the Java constant.
 */
import { create } from "@bufbuild/protobuf";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { IdentityAccount } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountProvisioningMode } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/enum_pb";
import type { ApiResourceRefView } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/io_pb";
import {
  ApiResourceRefViewSchema,
  IdentityOriginSchema,
} from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/io_pb";

import { kindEnumName } from "../../pipeline/apiresource-meta.js";
import type { IdentityAccountStore } from "../identityaccount/store.js";
import type { PrincipalDisplayResolver } from "./access-lists.js";

/** The Java STIGMER_PROVIDER_LABEL constant. */
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
    name: displayNameOf(
      spec?.firstName ?? "",
      spec?.lastName ?? "",
      account.metadata?.name ?? "",
      spec?.email ?? "",
    ),
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

/** The Java buildDisplayName precedence, with the account's own name before the email (Q-S5-4). */
function displayNameOf(
  firstName: string,
  lastName: string,
  accountName: string,
  email: string,
): string {
  if (firstName !== "" && lastName !== "") {
    return `${firstName} ${lastName}`;
  }
  if (firstName !== "") {
    return firstName;
  }
  if (lastName !== "") {
    return lastName;
  }
  if (accountName !== "") {
    return accountName;
  }
  return email;
}

function providerLabelOf(
  mode: IdentityAccountProvisioningMode | undefined,
): string {
  switch (mode) {
    case IdentityAccountProvisioningMode.direct:
    case IdentityAccountProvisioningMode.machine:
      return STIGMER_PROVIDER_LABEL;
    default:
      // federated / platform_client / unspecified carry no external
      // provider label (the Java switch arms).
      return "";
  }
}
