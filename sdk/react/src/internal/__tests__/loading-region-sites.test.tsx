/**
 * LoadingRegion's call sites (stigmer#1653): every SDK component whose
 * skeleton names itself renders it through LoadingRegion, so each one is
 * busy, carries no role and no aria-label (axe refuses a name on a div with
 * no role), and is named by the hidden text placed first. The primitive's
 * own markup is pinned by `LoadingRegion.test.tsx`; this file pins that the
 * sites use it, one row per site, each a real render of the exported
 * component held in its loading state.
 *
 * How a row reaches that state: a panel that takes `isLoading` is passed it;
 * a component that fetches is rendered over a client stub whose calls never
 * settle, naming the calls it makes while it loads. A section that reads the
 * active organization runs under the real OrgProvider, whose one call
 * resolves to Acme so the section moves on to its own pending fetch.
 */

import type { ReactElement } from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import type { Stigmer } from "@stigmer/sdk";
import { StigmerContext } from "../../context.js";
import { OrgProvider } from "../../organization/OrgProvider.js";
import { AgentDetailView } from "../../agent/AgentDetailView.js";
import { ApiKeyListPanel } from "../../api-key/ApiKeyListPanel.js";
import { BillingSection } from "../../billing/BillingSection.js";
import { ChannelAppListPanel } from "../../channel-app/ChannelAppListPanel.js";
import { EnvironmentListPanel } from "../../environment/EnvironmentListPanel.js";
import { EnvironmentVariableEditor } from "../../environment/EnvironmentVariableEditor.js";
import { OrgMembersPanel } from "../../iam-policy/OrgMembersPanel.js";
import { IdentityProviderListPanel } from "../../identity-provider/IdentityProviderListPanel.js";
import { InvitationRedemption } from "../../invitation/InvitationRedemption.js";
import { OAuthAppListPanel } from "../../oauth-app/OAuthAppListPanel.js";
import { PlatformClientListPanel } from "../../platform-client/PlatformClientListPanel.js";
import { EnvironmentsSection } from "../../settings/EnvironmentsSection.js";
import { SkillDetailView } from "../../skill/SkillDetailView.js";
import { SkillDiffDialog } from "../../skill/SkillDiffDialog.js";
import { TeamListPanel } from "../../team/TeamListPanel.js";
import { OrgUsagePanel } from "../../usage/OrgUsagePanel.js";
import { VersionTimeline } from "../../version-history/VersionTimeline.js";
import { WorkflowVersionDiffViewer } from "../../workflow/WorkflowVersionDiffViewer.js";
import { WorkflowVersionTimeline } from "../../workflow/WorkflowVersionTimeline.js";

/** The client calls a row's component makes while it loads, by namespace. */
type ClientStub = {
  readonly [N in keyof Stigmer]?: {
    readonly [M in keyof Stigmer[N]]?: () => Promise<unknown>;
  };
};

/** A call that never settles: the component stays in its loading state. */
function pending(): Promise<never> {
  return new Promise<never>(() => {});
}

const ACME = create(OrganizationSchema, {
  metadata: { id: "org_acme", slug: "acme", name: "Acme" },
});

/** The one call OrgProvider makes, answered with Acme. */
const ORG_PROVIDER_CALLS: ClientStub = {
  organization: { findMyOrganizations: async () => ({ entries: [ACME] }) },
};

interface Site {
  /** The component whose skeleton the row renders. */
  readonly name: string;
  /** The label the site passes to LoadingRegion, as its source writes it. */
  readonly label: string;
  /** The calls the component makes while it loads. */
  readonly client: ClientStub;
  readonly ui: ReactElement;
}

const SITES: readonly Site[] = [
  {
    name: "AgentDetailView",
    label: "Loading agent details",
    client: { agent: { getByReference: pending } },
    ui: <AgentDetailView org="acme" slug="reviewer" />,
  },
  {
    name: "ApiKeyListPanel",
    label: "Loading API keys",
    client: { apiKey: { findAll: pending } },
    ui: <ApiKeyListPanel />,
  },
  {
    name: "BillingSection",
    label: "Loading billing",
    client: { ...ORG_PROVIDER_CALLS, billing: { getOrCreateBillingAccount: pending } },
    ui: (
      <OrgProvider>
        <BillingSection />
      </OrgProvider>
    ),
  },
  {
    name: "ChannelAppListPanel",
    label: "Loading channel apps",
    client: { channelapp: { listByOrg: pending } },
    ui: <ChannelAppListPanel org="acme" />,
  },
  {
    name: "EnvironmentListPanel",
    label: "Loading environments",
    client: { environment: { list: pending } },
    ui: <EnvironmentListPanel org="acme" />,
  },
  {
    name: "EnvironmentVariableEditor",
    label: "Loading variables",
    client: { environment: { get: pending } },
    ui: <EnvironmentVariableEditor environmentId="env_acme" />,
  },
  {
    name: "OrgMembersPanel",
    label: "Loading members",
    client: {
      iamPolicy: { listResourceAccessByPrincipal: pending, checkMyPermission: pending },
      identityAccount: { whoAmI: pending },
    },
    ui: <OrgMembersPanel org="org_acme" />,
  },
  {
    name: "IdentityProviderListPanel",
    label: "Loading identity providers",
    client: { identityProvider: { listByOrg: pending } },
    ui: <IdentityProviderListPanel org="acme" />,
  },
  {
    name: "InvitationRedemption",
    label: "Loading invitation",
    client: { invitation: { getByToken: pending } },
    ui: <InvitationRedemption token="inv_token" />,
  },
  {
    name: "OAuthAppListPanel",
    label: "Loading OAuth apps",
    client: { oauthapp: { listByOrg: pending } },
    ui: <OAuthAppListPanel org="acme" />,
  },
  {
    name: "PlatformClientListPanel",
    label: "Loading platform clients",
    client: { platformclient: { listByOrg: pending } },
    ui: <PlatformClientListPanel org="acme" />,
  },
  {
    // The personal environment's card; the organization's list below it
    // is EnvironmentListPanel's row, named "Loading environments". The
    // card asks to create the personal environment in the render where the
    // organization arrives, before its list's first fetch has started, so
    // `create` is among the calls it makes while it loads.
    name: "EnvironmentsSection",
    label: "Loading",
    client: { ...ORG_PROVIDER_CALLS, environment: { list: pending, create: pending } },
    ui: (
      <OrgProvider>
        <EnvironmentsSection />
      </OrgProvider>
    ),
  },
  {
    name: "SkillDetailView",
    label: "Loading skill details",
    client: { skill: { getByReference: pending, listVersions: pending } },
    ui: <SkillDetailView org="acme" slug="triage" />,
  },
  {
    name: "SkillDiffDialog",
    label: "Loading diff",
    client: { skill: { getArtifactDownloadUrl: pending, getArtifact: pending } },
    ui: (
      <SkillDiffDialog
        state={{ fromArtifactKey: "art_a", toArtifactKey: "art_b", fromLabel: "a1b2c3d", toLabel: "e4f5a6b" }}
        onClose={() => {}}
      />
    ),
  },
  {
    name: "TeamListPanel",
    label: "Loading teams",
    client: {},
    ui: <TeamListPanel teams={[]} isLoading error={null} onOpen={() => {}} />,
  },
  {
    name: "OrgUsagePanel",
    label: "Loading usage data",
    client: { agentExecution: { getOrgUsageReport: pending } },
    ui: <OrgUsagePanel org="org_acme" />,
  },
  {
    name: "VersionTimeline",
    label: "Loading version history",
    client: {},
    ui: <VersionTimeline entries={[]} isLoading />,
  },
  {
    name: "WorkflowVersionDiffViewer",
    label: "Loading diff",
    client: { workflow: { getVersion: pending } },
    ui: <WorkflowVersionDiffViewer workflowId="wfl_acme" hashA="a1b2c3d" hashB="e4f5a6b" />,
  },
  {
    name: "WorkflowVersionTimeline",
    label: "Loading workflow version history",
    client: { workflow: { listVersions: pending } },
    ui: <WorkflowVersionTimeline workflowId="wfl_acme" org="acme" slug="deploy" />,
  },
];

// happy-dom does not implement the native dialog's showModal, which
// SkillDiffDialog's DialogShell calls when it opens.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close() {
    this.open = false;
  };
});

afterEach(cleanup);

describe("LoadingRegion call sites", () => {
  it.each(SITES)("$name renders its skeleton as a LoadingRegion named $label", async ({ label, client, ui }) => {
    render(
      <StigmerContext.Provider value={client as unknown as Stigmer}>{ui}</StigmerContext.Provider>,
    );

    const name = await screen.findByText(label);
    expect(name.tagName).toBe("SPAN");
    expect(name.className).toBe("stg:sr-only");
    expect(name.textContent).toBe(label);

    const region = name.parentElement;
    if (region === null) throw new Error(`the ${label} text has no container`);
    expect(region.getAttribute("aria-busy")).toBe("true");
    expect(region.getAttribute("role")).toBeNull();
    expect(region.getAttribute("aria-label")).toBeNull();
    expect(region.firstElementChild).toBe(name);
  });
});
