// Every settings route pictured in each state a person meets it in: with
// rows, before the first row (for who may add one and for who may not),
// when its read fails, when the person may not see it, on the open-source
// edition that does not serve it, with a row's page open, with a form open
// and with a removal asked first. They hold today's look, so a later change
// to a settings page shows in its own pictures and in nothing else.
//
// Each scene is a settings page in the console's settings frame
// (`settingsScene`), answering the calls its page makes; a call a scene
// forgets answers `Unimplemented` and draws the page's error state, which
// its picture would show.
import type { ReactNode } from "react";
import { clone, create, type MessageInitShape } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError } from "@connectrpc/connect";
import type { ConnectRouter } from "@connectrpc/connect";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ChannelAppSchema, type ChannelApp } from "@stigmer/apis/ai/stigmer/agentic/channelapp/v1/api_pb";
import { ChannelAppCommandController } from "@stigmer/apis/ai/stigmer/agentic/channelapp/v1/command_pb";
import { ChannelAppQueryController } from "@stigmer/apis/ai/stigmer/agentic/channelapp/v1/query_pb";
import { MemorySchema, type Memory } from "@stigmer/apis/ai/stigmer/agentic/memory/v1/api_pb";
import { MemoryLifecycleState } from "@stigmer/apis/ai/stigmer/agentic/memory/v1/enum_pb";
import { MemoryQueryController } from "@stigmer/apis/ai/stigmer/agentic/memory/v1/query_pb";
import { LicenseSchema, type License } from "@stigmer/apis/ai/stigmer/billing/license/v1/api_pb";
import { LicenseQueryController } from "@stigmer/apis/ai/stigmer/billing/license/v1/query_pb";
import { PlanQueryController } from "@stigmer/apis/ai/stigmer/billing/plan/v1/query_pb";
import { FederationIssuerSchema, type FederationIssuer } from "@stigmer/apis/ai/stigmer/iam/federationissuer/v1/api_pb";
import { FederationIssuerQueryController } from "@stigmer/apis/ai/stigmer/iam/federationissuer/v1/query_pb";
import {
  AccessChange,
  AccessChangeCause,
  AccessHistoryEntrySchema,
  type AccessHistoryEntry,
} from "@stigmer/apis/ai/stigmer/iam/grant/v1/io_pb";
import { GrantQueryController } from "@stigmer/apis/ai/stigmer/iam/grant/v1/query_pb";
import { InvitationSchema, type Invitation } from "@stigmer/apis/ai/stigmer/iam/invitation/v1/api_pb";
import { InvitationState } from "@stigmer/apis/ai/stigmer/iam/invitation/v1/enum_pb";
import { InvitationQueryController } from "@stigmer/apis/ai/stigmer/iam/invitation/v1/query_pb";
import { OAuthAppSchema, type OAuthApp } from "@stigmer/apis/ai/stigmer/iam/oauthapp/v1/api_pb";
import { OAuthAppQueryController } from "@stigmer/apis/ai/stigmer/iam/oauthapp/v1/query_pb";
import { TeamSchema, type Team } from "@stigmer/apis/ai/stigmer/iam/team/v1/api_pb";
import { TeamCommandController } from "@stigmer/apis/ai/stigmer/iam/team/v1/command_pb";
import { TeamQueryController } from "@stigmer/apis/ai/stigmer/iam/team/v1/query_pb";
import { IamRole } from "@stigmer/apis/ai/stigmer/iam/v1/enum_pb";
import { LicenseTerm } from "@stigmer/apis/ai/stigmer/platform/v1/license_pb";
import { OrganizationQueryController } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/query_pb";
import { EnvironmentQueryController } from "@stigmer/apis/ai/stigmer/agentic/environment/v1/query_pb";
import { VaultQueryController } from "@stigmer/apis/ai/stigmer/agentic/vault/v1/query_pb";
import { GetEntitlementsOutputSchema } from "@stigmer/apis/ai/stigmer/billing/subscription/v1/io_pb";
import { SubscriptionQueryController } from "@stigmer/apis/ai/stigmer/billing/subscription/v1/query_pb";
import { Feature } from "@stigmer/apis/ai/stigmer/platform/v1/entitlement_pb";
import { PlatformQueryController } from "@stigmer/apis/ai/stigmer/platform/v1/server_info_pb";
import { samples, sampleDate } from "@stigmer/react-sdk/test";
import { BillingSection } from "@stigmer/react-sdk";
import { ApiKeyCommandController } from "@stigmer/apis/ai/stigmer/iam/apikey/v1/command_pb";
import { ApiKeyQueryController } from "@stigmer/apis/ai/stigmer/iam/apikey/v1/query_pb";
import { PrincipalAccessSchema, type PrincipalAccess } from "@stigmer/apis/ai/stigmer/iam/grant/v1/io_pb";
import { IdentityAccountQueryController } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/query_pb";
import { BillingCommandController } from "@stigmer/apis/ai/stigmer/billing/v1/command_pb";
import { BillingQueryController } from "@stigmer/apis/ai/stigmer/billing/v1/query_pb";
import { LongContextPricingSchema, ModelPricingBaselineSchema, type ModelPricingBaseline } from "@stigmer/apis/ai/stigmer/billing/v1/model_pricing_baseline_pb";
import { RunQueryController } from "@stigmer/apis/ai/stigmer/agentic/run/v1/query_pb";
import {
  ApiKeysSection,
  MembersSection,
  ModelCatalogConsole,
  ServiceAccountsSection,
  UsageSection,
  VaultsSection,
  AccessHistorySection,
  AccountPreferencesSection,
  ChannelAppsSection,
  FederationIssuersSection,
  InvitationsSection,
  LicensesConsole,
  MemorySection,
  NotificationsSection,
  OAuthAppsSection,
  OrgEmbeddingSection,
  OrgPoliciesSection,
  OrgPreferencesSection,
  OrgProfileSection,
  PlanCatalogConsole,
  SETTINGS_NAV_GROUPS,
  SettingsSidebar,
  TeamsSection,
  UserMenu,
} from "@stigmer/react-sdk/console";
import { DATA_SCIENCE } from "../docs-fixtures.ts";
import { ACCOUNT, BILLING_ACCOUNT, BUSY_WEEK_USAGE, EMPTY_USAGE, ORGANIZATION, PLANS, PRICING_BASELINES, TEAM_AGENT_HOURS, TEAM_ESTIMATE, TEAM_SUBSCRIPTION } from "../fixtures.ts";
import type { Drawing } from "./drawing.ts";
import { serviceAccountsScene } from "./access.tsx";
import { settingsScene as frame } from "./settings-pages.tsx";

const ORG_ID = ORGANIZATION.metadata?.id ?? "";
const ORG_SLUG = ORGANIZATION.metadata?.slug ?? "";

/** A read the server refused to answer: the page's failure. */
function down(): never {
  throw new ConnectError("the server did not answer", Code.Unavailable);
}

/** A read the server refuses for who asked: the page's denial, where the page takes it from the read. */
function refused(): never {
  throw new ConnectError("the caller may not read this", Code.PermissionDenied);
}

/** A read the server does not serve: the page's edition notice, where the page takes it from the read. */
function unserved(): never {
  throw new ConnectError("this server does not serve it", Code.Unimplemented);
}

/** The features a Stigmer Cloud plan carries: every one, or every one but `lacking`. */
function entitlements(lacking?: Feature) {
  const all = [Feature.channels, Feature.chat_links, Feature.teams, Feature.child_orgs, Feature.access_history];
  return create(GetEntitlementsOutputSchema, { entitlements: { features: all.filter((feature) => feature !== lacking) } });
}

/**
 * A settings page in the console's settings frame, answering what every
 * settings page may ask past its own reads (the server's description, the
 * organization's plan) before `extra`.
 */
function settingsScene(page: () => ReactNode, extra: (router: ConnectRouter) => void = () => {}, mode?: Drawing["deploymentMode"], lacking?: Feature): Drawing {
  return frame(
    page,
    (router) => {
      router.service(PlatformQueryController, { getServerInfo: () => ({}) });
      router.service(SubscriptionQueryController, { getEntitlements: () => entitlements(lacking) });
      router.service(PlanQueryController, { list: () => ({ entries: [...PLANS] }) });
      extra(router);
    },
    mode,
  );
}

/** The person's own self-checks: yes to every relation, or to none. */
function checks(allowed: boolean): (router: ConnectRouter) => void {
  return (router) => router.service(GrantQueryController, { checkMyPermission: () => ({ isAuthorized: allowed }) });
}

/** A moment `days` before the gallery's clock. */
function daysAgo(days: number) {
  return timestampFromDate(sampleDate(-days * 86_400_000));
}

// ---------------------------------------------------------------------------
// The settings sidebar

/** The settings zone's sidebar, every group an owner sees, Members the page open. */
export function settingsSidebarScene(): Drawing {
  return {
    inOrganization: true,
    routes: (router) => {
      router.service(OrganizationQueryController, { listMine: () => samples.organizationList([ORGANIZATION]), get: () => ORGANIZATION });
      router.service(PlatformQueryController, { getServerInfo: () => ({}) });
      checks(true)(router);
    },
    render: () => (
      <div style={{ display: "flex", minHeight: 800 }}>
        <div style={{ width: 240, flex: "none", display: "flex" }}>
          <SettingsSidebar
            groups={SETTINGS_NAV_GROUPS}
            activePath="/settings/members"
            renderLink={({ href, children, id: _id, active: _active, ...rest }) => (
              <a href={href} {...rest} style={{ textDecoration: "none" }} onClick={(event) => event.preventDefault()}>
                {children}
              </a>
            )}
            footer={<UserMenu user={{ name: ACCOUNT.metadata?.name ?? "", email: "ada@acme.example" }} onSignOut={() => {}} />}
          />
        </div>
      </div>
    ),
  };
}

// ---------------------------------------------------------------------------
// Access history

const ADA = { kind: "identity_account", id: ACCOUNT.metadata?.id ?? "", name: ACCOUNT.metadata?.name ?? "" };
const GRACE = { kind: "identity_account", id: "ia-grace", name: "Grace Hopper" };
const KATHERINE = { kind: "identity_account", id: "ia-katherine", name: "Katherine Johnson" };

type HistoryInit = Omit<MessageInitShape<typeof AccessHistoryEntrySchema>, "$typeName">;

function historyEntry(sequence: number, init: HistoryInit = {}): AccessHistoryEntry {
  return create(AccessHistoryEntrySchema, {
    sequence: BigInt(sequence),
    occurredAt: daysAgo(10 - sequence),
    change: AccessChange.granted,
    cause: AccessChangeCause.grant,
    actorClass: "user",
    actor: ADA,
    principal: KATHERINE,
    role: { id: "member", code: "member", name: "Member" },
    resource: { org: ORG_ID, kind: ApiResourceKind.organization, id: ORG_ID, slug: ORG_SLUG },
    ...init,
  });
}

/** An organization's access changes, newest first: a removal, a role on an agent, a team's grant, the founding owner. */
const HISTORY: readonly AccessHistoryEntry[] = [
  historyEntry(6, { change: AccessChange.revoked, cause: AccessChangeCause.organization_access_revoked, principal: { kind: "identity_account", id: "ia-alan", name: "Alan Turing" } }),
  historyEntry(5, { role: { id: "editor", code: "editor", name: "Editor" }, resource: { org: ORG_ID, kind: ApiResourceKind.agent, id: "agt_ledger", slug: "ledger" } }),
  historyEntry(4, { principal: GRACE, role: { id: "admin", code: "admin", name: "Admin" } }),
  historyEntry(3),
  historyEntry(2, { principal: { kind: "team", id: "tm_finance", name: "Finance", relation: "member" }, role: { code: "viewer", name: "Viewer" }, resource: undefined }),
  historyEntry(1, { cause: AccessChangeCause.organization_created, principal: ADA, role: { code: "owner", name: "Owner" } }),
];

function accessHistoryScene(answer: "rows" | "none" | "failed", allowed = true, mode?: Drawing["deploymentMode"], lacking?: Feature): Drawing {
  return settingsScene(
    () => <AccessHistorySection />,
    (router) =>
      router.service(GrantQueryController, {
        checkMyPermission: () => ({ isAuthorized: allowed }),
        listAccessHistory: answer === "failed" ? down : () => ({ entries: answer === "rows" ? [...HISTORY] : [], oldestSequence: BigInt(1), retentionDays: 90 }),
      }),
    mode,
    lacking,
  );
}

// ---------------------------------------------------------------------------
// Channel apps, OAuth apps, federation issuers

/** A drawing whose server names its public address, as a Slack app's request URLs show it. */
function withPublicUrl(drawing: Drawing): Drawing {
  return { ...drawing, publicBaseUrl: "https://api.stigmer.ai" };
}

const SLACK_APP: ChannelApp = create(ChannelAppSchema, {
  metadata: { id: "chapp_slack", name: "Acme Slack", slug: "acme-slack", org: ORG_ID },
  spec: { providerConfig: { case: "slack", value: { clientId: "1234.5678" } } },
});
const WHATSAPP_APP: ChannelApp = create(ChannelAppSchema, {
  metadata: { id: "chapp_whatsapp", name: "Support line", slug: "support-line", org: ORG_ID },
  spec: { providerConfig: { case: "whatsapp", value: { appId: "8812001" } } },
});

function channelAppsScene(answer: "rows" | "none" | "failed", allowed = true, mode?: Drawing["deploymentMode"]): Drawing {
  return withPublicUrl(settingsScene(
    () => <ChannelAppsSection />,
    (router) => {
      checks(allowed)(router);
      router.service(ChannelAppQueryController, { list: answer === "failed" ? down : () => ({ entries: answer === "rows" ? [SLACK_APP, WHATSAPP_APP] : [] }) });
      router.service(ChannelAppCommandController, { create: down });
    },
    mode,
  ));
}

const OAUTH_APPS: readonly OAuthApp[] = [
  create(OAuthAppSchema, { metadata: { id: "oapp_github", name: "GitHub", slug: "github", org: ORG_ID }, spec: { provider: "github", clientId: "Iv1.8a61f9b3a7aba766", scopes: ["repo", "read:org"] } }),
  create(OAuthAppSchema, { metadata: { id: "oapp_linear", name: "Linear", slug: "linear", org: ORG_ID }, spec: { provider: "linear", clientId: "lin_4f0c2e", scopes: ["read", "write"] } }),
];

function oauthAppsListScene(answer: "rows" | "none" | "failed", allowed = true): Drawing {
  return settingsScene(
    () => <OAuthAppsSection />,
    (router) => {
      checks(allowed)(router);
      router.service(OAuthAppQueryController, { list: answer === "failed" ? down : () => ({ entries: answer === "rows" ? [...OAUTH_APPS] : [] }) });
    },
  );
}

const ISSUERS: readonly FederationIssuer[] = [
  create(FederationIssuerSchema, {
    metadata: { id: "fis_okta", name: "Acme Okta", slug: "acme-okta", org: ORG_ID },
    spec: { displayName: "Acme Okta", jwksUri: "https://acme.okta.com/oauth2/v1/keys", allowedIssuers: ["https://acme.okta.com"], expectedAudience: "stigmer" },
  }),
  create(FederationIssuerSchema, {
    metadata: { id: "fis_github", name: "GitHub Actions", slug: "github-actions", org: ORG_ID },
    spec: { displayName: "GitHub Actions", jwksUri: "https://token.actions.githubusercontent.com/.well-known/jwks", allowedIssuers: ["https://token.actions.githubusercontent.com"], expectedAudience: "stigmer" },
  }),
];

function federationIssuersScene(answer: "rows" | "none" | "failed", allowed = true, mode?: Drawing["deploymentMode"]): Drawing {
  return settingsScene(
    () => <FederationIssuersSection />,
    (router) => {
      checks(allowed)(router);
      router.service(FederationIssuerQueryController, {
        list: answer === "failed" ? down : () => ({ entries: answer === "rows" ? [...ISSUERS] : [] }),
        get: () => ISSUERS[0],
      });
    },
    mode,
  );
}

// ---------------------------------------------------------------------------
// Invitations

function invitation(id: string, label: string, role: IamRole, state: InvitationState, days: number, redeemed = 0): Invitation {
  return create(InvitationSchema, {
    metadata: { id, name: label, org: ORG_ID },
    spec: { label, role, maxRedemptions: 10, expiresAt: daysAgo(-days) },
    status: { state, redemptionCount: redeemed },
  });
}

const INVITATIONS: readonly Invitation[] = [
  invitation("inv_finance", "Finance team", IamRole.member, InvitationState.active, 6, 2),
  invitation("inv_auditors", "External auditors", IamRole.viewer, InvitationState.active, 2),
];

function invitationsScene(answer: "rows" | "none" | "failed", allowed = true, mode?: Drawing["deploymentMode"]): Drawing {
  return settingsScene(
    () => <InvitationsSection />,
    (router) => {
      checks(allowed)(router);
      router.service(InvitationQueryController, { list: answer === "failed" ? down : () => ({ entries: answer === "rows" ? [...INVITATIONS] : [] }) });
    },
    mode,
  );
}

// ---------------------------------------------------------------------------
// Licenses

function license(id: string, customer: string, email: string, issuedDays: number, expiresDays: number, maxUsers: number, term = LicenseTerm.paid): License {
  return create(LicenseSchema, {
    apiVersion: "billing.stigmer.ai/v1",
    kind: "License",
    metadata: { id, name: `license ${id}`, slug: id.replace(/_/g, "-") },
    spec: {
      customer: { id: `cus_${id}`, displayName: customer, contactEmail: email },
      entitlements: { limits: { maxUsers } },
      term,
      expiresAt: daysAgo(-expiresDays),
      graceUntil: daysAgo(-expiresDays - 14),
    },
    status: {
      keyId: "license-signing:v1",
      issuedAt: daysAgo(issuedDays),
      audit: { specAudit: { createdBy: { id: "ida_operator", email: "operator@stigmer.example", displayName: "Platform Operator" }, createdAt: daysAgo(issuedDays) } },
    },
  });
}

const LICENSES: readonly License[] = [
  license("lic_northwind", "Northwind Traders", "it@northwind.example", 40, 325, 250),
  license("lic_contoso", "Contoso", "licensing@contoso.example", 300, 20, 50),
  license("lic_fabrikam", "Fabrikam", "ops@fabrikam.example", 14, 16, 10, LicenseTerm.trial),
];

function licensesScene(answer: "rows" | "none" | "failed" | "refused" | "unserved", mode?: Drawing["deploymentMode"]): Drawing {
  const list = { rows: () => ({ entries: [...LICENSES] }), none: () => ({ entries: [] }), failed: down, refused, unserved }[answer];
  return settingsScene(
    () => <LicensesConsole />,
    (router) => router.service(LicenseQueryController, { list, get: () => LICENSES[0] }),
    mode,
  );
}

// ---------------------------------------------------------------------------
// Memory

function memory(id: string, content: string, state: MemoryLifecycleState, days: number): Memory {
  return create(MemorySchema, {
    metadata: { id, name: id, org: ORG_ID },
    spec: { content, subjectIdentityAccountId: ACCOUNT.metadata?.id ?? "", provenance: { agentId: "agt_ledger" } },
    status: { lifecycleState: state, stateChangedAt: daysAgo(days) },
  });
}

const MEMORIES: readonly Memory[] = [
  memory("mem_1", "Close the books on the third working day of each month.", MemoryLifecycleState.lifecycle_state_proposed, 0),
  memory("mem_2", "Report variances above 5% to the controller, Grace Hopper.", MemoryLifecycleState.lifecycle_state_confirmed, 3),
  memory("mem_3", "Amounts are in euros unless the ledger says otherwise.", MemoryLifecycleState.lifecycle_state_confirmed, 9),
];

function memoryScene(answer: "rows" | "none" | "failed"): Drawing {
  return settingsScene(
    () => <MemorySection />,
    (router) => router.service(MemoryQueryController, { list: answer === "failed" ? down : () => ({ entries: answer === "rows" ? [...MEMORIES] : [] }) }),
  );
}

// ---------------------------------------------------------------------------
// Teams

const TEAMS: readonly Team[] = [
  create(TeamSchema, { metadata: { id: "tm_finance", name: "Finance", slug: "finance", org: ORG_ID }, spec: { description: "Month-end close and reporting" } }),
  create(TeamSchema, { metadata: { id: "tm_platform", name: "Platform", slug: "platform", org: ORG_ID }, spec: { description: "Runs the agents' environments" } }),
];

function teamsScene(answer: "rows" | "none" | "failed", allowed = true, lacking?: Feature): Drawing {
  return settingsScene(
    () => <TeamsSection />,
    (router) => {
      router.service(GrantQueryController, {
        checkMyPermission: () => ({ isAuthorized: allowed }),
        listResourceAccessByPrincipal: () => ({ entries: [person("ia-grace", "Grace Hopper", "admin"), person("ia-katherine", "Katherine Johnson", "member")] }),
      });
      router.service(TeamCommandController, { create: down });
      router.service(TeamQueryController, { list: answer === "failed" ? down : () => ({ entries: answer === "rows" ? [...TEAMS] : [] }), get: () => TEAMS[0] });
    },
    undefined,
    lacking,
  );
}

// ---------------------------------------------------------------------------
// Plans

function plansScene(answer: "rows" | "none" | "failed", allowed = true, mode?: Drawing["deploymentMode"]): Drawing {
  return settingsScene(
    () => <PlanCatalogConsole />,
    (router) => {
      checks(allowed)(router);
      router.service(PlanQueryController, { list: answer === "failed" ? down : () => ({ entries: answer === "rows" ? [...PLANS] : [] }) });
    },
    mode,
  );
}

// ---------------------------------------------------------------------------
// The organization's pages and the person's own

/** Two organizations the organization made for its own customers. */
const CHILD_ORGS = [
  samples.organization({ id: "org_00000000000000000000000021", name: "Northwind Traders", slug: "northwind" }),
  samples.organization({ id: "org_00000000000000000000000022", name: "Contoso", slug: "contoso" }),
];

function orgScene(page: () => ReactNode, allowed = true, children = false): Drawing {
  return settingsScene(page, (router) => {
    checks(allowed)(router);
    router.service(OrganizationQueryController, {
      listMine: () => samples.organizationList([ORGANIZATION]),
      get: () => ORGANIZATION,
      listChildOrgs: () => ({ entries: children ? [...CHILD_ORGS] : [] }),
    });
    router.service(FederationIssuerQueryController, { list: () => ({ entries: [] }) });
    router.service(EnvironmentQueryController, { list: () => ({ entries: [DATA_SCIENCE] }), get: () => DATA_SCIENCE });
    router.service(VaultQueryController, { list: () => ({ entries: [] }), getMine: () => samples.vault({ id: "vlt_00000000000000000000000002", name: "My vault", slug: "my-vault", org: ORG_ID }) });
  });
}

function notificationsScene(unsupported = false): Drawing {
  return settingsScene(() => <NotificationsSection requestPermission={async () => true} unsupported={unsupported} />);
}

// ---------------------------------------------------------------------------
// API keys, members, vaults, service accounts

const API_KEYS = [
  samples.apiKey({ id: "key_00000000000000000000000011", name: "Laptop CLI", fingerprint: "Xk4p2Q" }),
  samples.apiKey({ id: "key_00000000000000000000000012", name: "Nightly ledger sync", fingerprint: "Mz8r1T", neverExpires: false }),
];

function apiKeysScene(answer: "rows" | "failed", create: "works" | "fails" = "works"): Drawing {
  return settingsScene(
    () => <ApiKeysSection />,
    (router) => {
      router.service(ApiKeyQueryController, { list: answer === "failed" ? down : () => samples.apiKeyList([...API_KEYS]) });
      router.service(ApiKeyCommandController, { create: create === "fails" ? down : () => API_KEYS[0] });
    },
  );
}

function person(id: string, name: string, role: string): PrincipalAccess {
  return create(PrincipalAccessSchema, { principal: { kind: "identity_account", id, name }, roles: [{ role: { code: role, name: role } }] });
}

const PEOPLE: readonly PrincipalAccess[] = [
  person(ACCOUNT.metadata?.id ?? "", ACCOUNT.metadata?.name ?? "", "owner"),
  person("ia-grace", "Grace Hopper", "admin"),
  person("ia-katherine", "Katherine Johnson", "member"),
  person("ia-alan", "Alan Turing", "member"),
];

function membersScene(answer: "rows" | "failed", allowed = true): Drawing {
  // As a member, the person's own row holds the member role, which is what the page reads to offer role changes.
  const people = allowed ? PEOPLE : PEOPLE.map((entry, index) => (index === 0 ? person(ACCOUNT.metadata?.id ?? "", ACCOUNT.metadata?.name ?? "", "member") : entry));
  return settingsScene(
    () => <MembersSection />,
    (router) => {
      router.service(GrantQueryController, {
        checkMyPermission: () => ({ isAuthorized: allowed }),
        listResourceAccessByPrincipal: answer === "failed" ? down : () => ({ entries: [...people] }),
      });
      router.service(FederationIssuerQueryController, { list: () => ({ entries: [] }) });
    },
  );
}

function vaultsScene(allowed: boolean): Drawing {
  return settingsScene(
    () => <VaultsSection />,
    (router) => {
      checks(allowed)(router);
      router.service(VaultQueryController, {
        getMine: () => samples.vault({ id: "vlt_00000000000000000000000002", name: "My vault", slug: "my-vault", org: ORG_ID }),
        list: () => ({
          entries: [
            samples.vault({ id: "vlt_00000000000000000000000003", name: "Production", slug: "production", org: ORG_ID }),
            samples.vault({ id: "vlt_00000000000000000000000004", name: "Ledger service", slug: "ledger-service", org: ORG_ID }),
          ],
        }),
      });
    },
  );
}

/** Service accounts as the CI account's page draws them, framed with the common settings reads. */
function serviceAccountsListScene(made: "not-yet" | "made"): Drawing {
  const drawing = serviceAccountsScene(made);
  return settingsScene(() => <ServiceAccountsSection />, (router) => drawing.routes?.(router));
}

// ---------------------------------------------------------------------------
// Billing and usage

function billingScene(answer: "works" | "failed", mode?: Drawing["deploymentMode"]): Drawing {
  return settingsScene(
    () => <BillingSection />,
    (router) => {
      router.service(BillingCommandController, { getOrCreateBillingAccount: answer === "failed" ? down : () => BILLING_ACCOUNT });
      router.service(SubscriptionQueryController, {
        getForOrg: answer === "failed" ? down : () => TEAM_SUBSCRIPTION,
        getAgentHours: answer === "failed" ? down : () => TEAM_AGENT_HOURS,
        getPeriodEstimate: answer === "failed" ? down : () => TEAM_ESTIMATE,
        getEntitlements: () => entitlements(),
      });
    },
    mode,
  );
}

function usageScene(answer: "rows" | "none" | "failed"): Drawing {
  return settingsScene(
    () => <UsageSection />,
    (router) => router.service(RunQueryController, { getOrgUsageReport: answer === "failed" ? down : () => (answer === "rows" ? BUSY_WEEK_USAGE : EMPTY_USAGE) }),
  );
}

// ---------------------------------------------------------------------------
// The model catalogue

/** The catalogue with Claude Sonnet 4.6 priced in two steps: its rates go up past 200,000 prompt tokens. */
const STEPPED_BASELINES: readonly ModelPricingBaseline[] = PRICING_BASELINES.map((baseline) => {
  if (baseline.modelId !== "claude-sonnet-4.6" || baseline.pricing === undefined) return baseline;
  const stepped = clone(ModelPricingBaselineSchema, baseline);
  if (stepped.pricing) {
    stepped.pricing.longContext = create(LongContextPricingSchema, {
      thresholdTokens: 200_000,
      inputPriceMicrosPerMillion: 6_000_000n,
      outputPriceMicrosPerMillion: 22_500_000n,
      cacheWritePriceMicrosPerMillion: 7_500_000n,
      cacheReadPriceMicrosPerMillion: 600_000n,
    });
  }
  return stepped;
});

function modelCatalogScene(answer: "rows" | "stepped" | "none" | "failed" | "refused" | "unserved", mode?: Drawing["deploymentMode"]): Drawing {
  const list = {
    rows: () => ({ entries: [...PRICING_BASELINES] }),
    stepped: () => ({ entries: [...STEPPED_BASELINES] }),
    none: () => ({ entries: [] }),
    failed: down,
    refused,
    unserved,
  }[answer];
  return settingsScene(
    () => <ModelCatalogConsole />,
    (router) => router.service(BillingQueryController, { listModelPricingBaselines: list }),
    mode,
  );
}

/** Every new settings scene, by id. */
export const SETTINGS_ROUTE_DRAWINGS = {
  "settings-sidebar": settingsSidebarScene,
  "settings-access-history": () => accessHistoryScene("rows"),
  "settings-access-history-empty": () => accessHistoryScene("none"),
  "settings-access-history-failed": () => accessHistoryScene("failed"),
  "settings-access-history-denied": () => accessHistoryScene("rows", false),
  "settings-access-history-oss": () => accessHistoryScene("rows", true, "local"),
  "settings-access-history-plan": () => accessHistoryScene("rows", true, undefined, Feature.access_history),
  "settings-account-preferences": () => settingsScene(() => <AccountPreferencesSection />),
  "settings-channel-apps": () => channelAppsScene("rows"),
  "settings-channel-apps-empty": () => channelAppsScene("none"),
  "settings-channel-apps-empty-member": () => channelAppsScene("none", false),
  "settings-channel-apps-failed": () => channelAppsScene("failed"),
  "settings-channel-apps-oss": () => channelAppsScene("rows", true, "local"),
  "settings-oauth-apps": () => oauthAppsListScene("rows"),
  "settings-oauth-apps-empty-member": () => oauthAppsListScene("none", false),
  "settings-oauth-apps-failed": () => oauthAppsListScene("failed"),
  "settings-federation-issuers": () => federationIssuersScene("rows"),
  "settings-federation-issuers-empty": () => federationIssuersScene("none"),
  "settings-federation-issuers-empty-member": () => federationIssuersScene("none", false),
  "settings-federation-issuers-failed": () => federationIssuersScene("failed"),
  "settings-federation-issuers-oss": () => federationIssuersScene("rows", true, "local"),
  "settings-invitations": () => invitationsScene("rows"),
  "settings-invitations-empty": () => invitationsScene("none"),
  "settings-invitations-failed": () => invitationsScene("failed"),
  "settings-invitations-denied": () => invitationsScene("rows", false),
  "settings-invitations-oss": () => invitationsScene("rows", true, "local"),
  "settings-licenses": () => licensesScene("rows"),
  "settings-licenses-empty": () => licensesScene("none"),
  "settings-licenses-failed": () => licensesScene("failed"),
  "settings-licenses-denied": () => licensesScene("refused"),
  "settings-licenses-oss": () => licensesScene("unserved", "local"),
  "settings-memory": () => memoryScene("rows"),
  "settings-memory-empty": () => memoryScene("none"),
  "settings-memory-failed": () => memoryScene("failed"),
  "settings-teams": () => teamsScene("rows"),
  "settings-teams-empty": () => teamsScene("none"),
  "settings-teams-empty-member": () => teamsScene("none", false),
  "settings-teams-failed": () => teamsScene("failed"),
  "settings-teams-plan": () => teamsScene("rows", true, Feature.teams),
  "settings-plans": () => plansScene("rows"),
  "settings-plans-empty": () => plansScene("none"),
  "settings-plans-failed": () => plansScene("failed"),
  "settings-plans-denied": () => plansScene("rows", false),
  "settings-plans-oss": () => plansScene("rows", true, "local"),
  "settings-org-profile": () => orgScene(() => <OrgProfileSection />, true, true),
  "settings-org-preferences": () => orgScene(() => <OrgPreferencesSection />),
  "settings-org-policies": () => orgScene(() => <OrgPoliciesSection />),
  "settings-org-embedding": () => orgScene(() => <OrgEmbeddingSection />),
  "settings-notifications": () => notificationsScene(),
  "settings-notifications-unsupported": () => notificationsScene(true),
  "settings-channel-apps-detail": () => channelAppsScene("rows"),
  "settings-channel-apps-delete": () => channelAppsScene("rows"),
  "settings-channel-apps-new-error": () => channelAppsScene("none"),
  "settings-oauth-apps-detail": () => oauthAppsListScene("rows"),
  "settings-oauth-apps-delete": () => oauthAppsListScene("rows"),
  "settings-federation-issuers-detail": () => federationIssuersScene("rows"),
  "settings-federation-issuers-delete": () => federationIssuersScene("rows"),
  "settings-federation-issuers-new": () => federationIssuersScene("rows"),
  "settings-invitations-new": () => invitationsScene("rows"),
  "settings-invitations-revoke": () => invitationsScene("rows"),
  "settings-licenses-detail": () => licensesScene("rows"),
  "settings-licenses-new": () => licensesScene("rows"),
  "settings-memory-delete": () => memoryScene("rows"),
  "settings-teams-detail": () => teamsScene("rows"),
  "settings-teams-delete": () => teamsScene("rows"),
  "settings-teams-new-error": () => teamsScene("rows"),
  "settings-plans-new": () => plansScene("rows"),
  "settings-plans-retire": () => plansScene("rows"),
  "settings-api-keys-full": () => apiKeysScene("rows"),
  "settings-api-keys-failed": () => apiKeysScene("failed"),
  "settings-api-keys-revoke": () => apiKeysScene("rows"),
  "settings-api-keys-new-failed": () => apiKeysScene("rows", "fails"),
  "settings-members-remove": () => membersScene("rows"),
  "settings-members-failed": () => membersScene("failed"),
  "settings-members-member": () => membersScene("rows", false),
  "settings-vaults-member": () => vaultsScene(false),
  "settings-vaults-delete": () => vaultsScene(true),
  "settings-service-accounts": () => serviceAccountsListScene("made"),
  "settings-service-accounts-empty": () => serviceAccountsListScene("not-yet"),
  "settings-service-accounts-delete": () => serviceAccountsListScene("made"),
  "settings-billing-failed": () => billingScene("failed"),
  "settings-billing-oss": () => billingScene("works", "local"),
  "settings-usage-empty": () => usageScene("none"),
  "settings-usage-failed": () => usageScene("failed"),
  "settings-model-catalog-detail": () => modelCatalogScene("rows"),
  "settings-model-catalog-stepped": () => modelCatalogScene("stepped"),
  "settings-model-catalog-editor": () => modelCatalogScene("stepped"),
  "settings-model-catalog-confirm": () => modelCatalogScene("stepped"),
  "settings-model-catalog-retire": () => modelCatalogScene("rows"),
  "settings-model-catalog-empty": () => modelCatalogScene("none"),
  "settings-model-catalog-failed": () => modelCatalogScene("failed"),
  "settings-model-catalog-denied": () => modelCatalogScene("refused"),
  "settings-model-catalog-oss": () => modelCatalogScene("unserved", "local"),
} as const satisfies Record<string, () => Drawing>;
