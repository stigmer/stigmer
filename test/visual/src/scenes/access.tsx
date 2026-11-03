// The access pages' screens, framed as the console's Settings frames a page:
// the service accounts page (docs/guides/authentication/service-accounts.mdx)
// walking its CI account from the New service account form through its
// first key to the key shown once, then the account's own page; and the
// bring-your-own-OAuth page (docs/guides/integrations/bring-your-own-oauth.mdx)
// with the New OAuth app form filled for its Slack app.
//
// Each phase of the service account flow is reached the way the reader
// reaches it, by submitting the one before: the create answers return the
// page's account and key, and the list reads the account once it exists,
// as the section refetches it after the create.
import { create } from "@bufbuild/protobuf";
import type { ConnectRouter } from "@connectrpc/connect";
import { ApiKeyCommandController } from "@stigmer/apis/ai/stigmer/iam/apikey/v1/command_pb";
import { ApiKeyQueryController } from "@stigmer/apis/ai/stigmer/iam/apikey/v1/query_pb";
import { PrincipalAccessSchema, type PrincipalAccess } from "@stigmer/apis/ai/stigmer/iam/grant/v1/io_pb";
import { GrantQueryController } from "@stigmer/apis/ai/stigmer/iam/grant/v1/query_pb";
import { IdentityAccountCommandController } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/command_pb";
import { IdentityAccountQueryController } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/query_pb";
import { OAuthAppQueryController } from "@stigmer/apis/ai/stigmer/iam/oauthapp/v1/query_pb";
import { PlatformQueryController } from "@stigmer/apis/ai/stigmer/platform/v1/server_info_pb";
import { OAuthAppsSection, ServiceAccountsSection } from "@stigmer/react-sdk/console";
import { CI_DEPLOY, GITHUB_ACTIONS_KEY, GITHUB_ACTIONS_KEY_CREATED } from "../docs-fixtures.ts";
import { ACCOUNT } from "../fixtures.ts";
import type { Drawing } from "./drawing.ts";
import { settingsScene } from "./settings-pages.tsx";

/** One principal and its direct role on the organization. */
function access(id: string, name: string, kind: string, role: string): PrincipalAccess {
  return create(PrincipalAccessSchema, { principal: { kind, id, name }, roles: [{ role: { code: role, name: role } }] });
}

/** The organization's access list: Ada, who owns it, and the CI account as Member, the role the page gives it. */
const ORG_ACCESS: readonly PrincipalAccess[] = [
  access(ACCOUNT.metadata?.id ?? "", ACCOUNT.metadata?.name ?? "", "identity_account", "owner"),
  access(CI_DEPLOY.metadata?.id ?? "", CI_DEPLOY.metadata?.name ?? "", "identity_account", "member"),
];

/**
 * Settings → Service accounts: before the CI account exists (the create
 * flow), or after (its own page). A server that answers without saying it
 * trusts every request checks keys, so the section offers New service
 * account.
 */
export function serviceAccountsScene(made: "not-yet" | "made"): Drawing {
  let exists = made === "made";
  return settingsScene(
    () => <ServiceAccountsSection />,
    (router: ConnectRouter) => {
      router.service(PlatformQueryController, { getServerInfo: () => ({}) });
      router.service(IdentityAccountQueryController, {
        whoAmI: () => ACCOUNT,
        listServiceAccounts: () => ({ entries: exists ? [CI_DEPLOY] : [] }),
      });
      router.service(IdentityAccountCommandController, {
        createServiceAccount: () => {
          exists = true;
          return CI_DEPLOY;
        },
      });
      router.service(GrantQueryController, {
        checkMyPermission: () => ({ isAuthorized: true }),
        listResourceAccessByPrincipal: () => ({ entries: exists ? [...ORG_ACCESS] : ORG_ACCESS.slice(0, 1) }),
      });
      router.service(ApiKeyCommandController, { createForServiceAccount: () => GITHUB_ACTIONS_KEY_CREATED });
      router.service(ApiKeyQueryController, { listByAccount: () => ({ entries: [GITHUB_ACTIONS_KEY] }) });
    },
  );
}

/** Settings → OAuth apps, none registered yet: the page's New OAuth app form, which no scene submits. */
export function oauthAppsScene(): Drawing {
  return settingsScene(
    () => <OAuthAppsSection />,
    (router: ConnectRouter) => {
      router.service(OAuthAppQueryController, { list: () => ({ entries: [] }) });
    },
  );
}
