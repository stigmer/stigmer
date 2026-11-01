// The settings pages, each framed as the console's settings layout frames
// it (a centred 64rem column, `max-w-5xl`, under a hidden "Settings"
// heading): the landing, and the pages that stand for the shapes Settings
// has. A collection with rows (Members), a collection with none yet (API
// keys on Stigmer Cloud), a collection of cards (Vaults), a plan and its
// figures (Billing, Usage), what this edition does not offer (Teams on open
// source), an operator's dense console (the model catalogue), and any page
// while it reads.
//
// Every scene answers the person's organizations, so the active
// organization is the samples' one, and the calls its page makes; the
// person is an owner of it, as the one who sets an organization up is.
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import type { ConnectRouter } from "@connectrpc/connect";
import { RunQueryController } from "@stigmer/apis/ai/stigmer/agentic/run/v1/query_pb";
import { BillingCommandController } from "@stigmer/apis/ai/stigmer/billing/v1/command_pb";
import { BillingQueryController } from "@stigmer/apis/ai/stigmer/billing/v1/query_pb";
import { PlanQueryController } from "@stigmer/apis/ai/stigmer/billing/plan/v1/query_pb";
import { SubscriptionQueryController } from "@stigmer/apis/ai/stigmer/billing/subscription/v1/query_pb";
import { FederationIssuerQueryController } from "@stigmer/apis/ai/stigmer/iam/federationissuer/v1/query_pb";
import { PrincipalAccessSchema, type PrincipalAccess } from "@stigmer/apis/ai/stigmer/iam/grant/v1/io_pb";
import { ApiKeyQueryController } from "@stigmer/apis/ai/stigmer/iam/apikey/v1/query_pb";
import { GrantQueryController } from "@stigmer/apis/ai/stigmer/iam/grant/v1/query_pb";
import { IdentityAccountQueryController } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/query_pb";
import { OrganizationQueryController } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/query_pb";
import { VaultQueryController } from "@stigmer/apis/ai/stigmer/agentic/vault/v1/query_pb";
import { samples } from "@stigmer/react-sdk/test";
import { BillingSection } from "@stigmer/react-sdk";
import {
  ApiKeysSection,
  MembersSection,
  ModelCatalogConsole,
  SETTINGS_NAV_GROUPS,
  SettingsOverview,
  SettingsPage,
  SettingsSkeleton,
  TeamsSection,
  UsageSection,
  VaultsSection,
} from "@stigmer/react-sdk/console";
import {
  ACCOUNT,
  BILLING_ACCOUNT,
  BUSY_WEEK_USAGE,
  ORGANIZATION,
  PLANS,
  PRICING_BASELINES,
  TEAM_AGENT_HOURS,
  TEAM_ESTIMATE,
  TEAM_SUBSCRIPTION,
} from "../fixtures.ts";

const ORG_ID = ORGANIZATION.metadata?.id ?? "";

/** One person and the role they hold on the organization. */
function member(id: string, name: string, role: string): PrincipalAccess {
  return create(PrincipalAccessSchema, {
    principal: { kind: "identity_account", id, name },
    roles: [{ role: { code: role, name: role } }],
  });
}

/** The organization's people: Ada, who set it up, an admin and two members. */
const MEMBERS: readonly PrincipalAccess[] = [
  member(ACCOUNT.metadata?.id ?? "", ACCOUNT.metadata?.name ?? "", "owner"),
  member("ia-grace", "Grace Hopper", "admin"),
  member("ia-katherine", "Katherine Johnson", "member"),
  member("ia-alan", "Alan Turing", "member"),
];
import type { Drawing } from "./drawing.ts";

/** The calls every settings page makes: the person's organizations, their account, and a yes to every self-check. */
function settingsRoutes(router: ConnectRouter): void {
  router.service(OrganizationQueryController, {
    listMine: () => samples.organizationList([ORGANIZATION]),
    get: () => ORGANIZATION,
  });
  router.service(IdentityAccountQueryController, { whoAmI: () => ACCOUNT });
  router.service(GrantQueryController, { checkMyPermission: () => ({ isAuthorized: true }) });
}

/** A settings page with `extra` answered beside the common calls. */
function settingsScene(
  page: () => ReactNode,
  extra: (router: ConnectRouter) => void = () => {},
  deploymentMode?: Drawing["deploymentMode"],
): Drawing {
  return {
    deploymentMode,
    inOrganization: true,
    routes: (router) => {
      settingsRoutes(router);
      extra(router);
    },
    render: () => <SettingsColumn>{page()}</SettingsColumn>,
  };
}

/** The console's settings layout: a centred `max-w-5xl` column, its page heading read by assistive technology only. */
function SettingsColumn({ children }: { readonly children: ReactNode }) {
  return (
    <div style={{ maxWidth: "64rem", margin: "0 auto", padding: "2rem 1.5rem" }}>
      <h1 className="gallery-visually-hidden">Settings</h1>
      {children}
    </div>
  );
}

/** Members: the owner and two people the organization holds. */
export function settingsMembersScene(): Drawing {
  return settingsScene(
    () => <MembersSection />,
    (router) => {
      router.service(GrantQueryController, {
        checkMyPermission: () => ({ isAuthorized: true }),
        listResourceAccessByPrincipal: () => ({ entries: [...MEMBERS] }),
      });
      router.service(FederationIssuerQueryController, { list: () => ({ entries: [] }) });
    },
  );
}

/** The settings landing: every group of the navigation an organization's owner sees, each page a link. */
export function settingsLandingScene(): Drawing {
  return settingsScene(() => (
    <SettingsOverview
      groups={SETTINGS_NAV_GROUPS}
      renderLink={({ id, href, className, children }) => (
        <a key={id} href={href} className={className} onClick={(event) => event.preventDefault()}>
          {children}
        </a>
      )}
    />
  ));
}

/** A settings page while its rows are read: Members' frame over the shared skeleton. */
export function settingsLoadingScene(): Drawing {
  return settingsScene(() => (
    <SettingsPage title="Members" description="Who belongs to this organization and the role each holds: owner, admin, member or viewer. Only an owner grants or removes owner.">
      <SettingsSkeleton label="Loading members" rows={4} />
    </SettingsPage>
  ));
}

/** API keys on Stigmer Cloud before the first key is made. */
export function settingsApiKeysScene(): Drawing {
  return settingsScene(
    () => <ApiKeysSection />,
    (router) => router.service(ApiKeyQueryController, { list: () => samples.apiKeyList([]) }),
  );
}

/** Vaults: the organization's vaults. */
export function settingsVaultsScene(): Drawing {
  return settingsScene(
    () => <VaultsSection />,
    (router) =>
      router.service(VaultQueryController, {
        getMine: () => samples.vault({ id: "vlt_00000000000000000000000002", name: "My vault", slug: "my-vault", org: ORG_ID }),
        list: () => ({
          entries: [
            samples.vault({ id: "vlt_00000000000000000000000003", name: "Production", slug: "production", org: ORG_ID }),
            samples.vault({ id: "vlt_00000000000000000000000004", name: "Ledger service", slug: "ledger-service", org: ORG_ID }),
          ],
        }),
      }),
  );
}

/** Billing on Stigmer Cloud. */
export function settingsBillingScene(): Drawing {
  return settingsScene(
    () => <BillingSection />,
    (router) => {
      router.service(BillingCommandController, { getOrCreateBillingAccount: () => BILLING_ACCOUNT });
      router.service(PlanQueryController, { list: () => ({ entries: [...PLANS] }) });
      router.service(SubscriptionQueryController, {
        getForOrg: () => TEAM_SUBSCRIPTION,
        getAgentHours: () => TEAM_AGENT_HOURS,
        getPeriodEstimate: () => TEAM_ESTIMATE,
      });
    },
  );
}

/** Usage: the organization's figures. */
export function settingsUsageScene(): Drawing {
  return settingsScene(
    () => <UsageSection />,
    (router) => router.service(RunQueryController, { getOrgUsageReport: () => BUSY_WEEK_USAGE }),
  );
}

/** Teams on the open-source server, which serves none: the edition notice. */
export function settingsTeamsOssScene(): Drawing {
  return settingsScene(() => <TeamsSection />, () => {}, "local");
}

/** The model catalogue, for a platform operator. */
export function settingsModelCatalogScene(): Drawing {
  return settingsScene(
    () => <ModelCatalogConsole />,
    (router) => router.service(BillingQueryController, { listModelPricingBaselines: () => ({ entries: [...PRICING_BASELINES] }) }),
  );
}
