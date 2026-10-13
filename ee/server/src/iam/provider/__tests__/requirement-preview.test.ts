/**
 * Pins the owners' preview of a sign-in requirement
 * (../requirement-preview.ts): who would stop counting in an organization
 * if its SSO provider required sign-in through it.
 *
 *   - members are the accounts holding a role on the organization directly
 *     or through a team that holds one;
 *   - the account the provider made counts and is left out, a service
 *     account is unaffected and left out, an owner is listed apart as
 *     exempt;
 *   - each refused member carries the open invitations they created and
 *     the automations that act as them, asked once for every refused member;
 *   - an organization with no SSO provider is NOT_FOUND.
 */
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { IamPolicy } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/api_pb";
import { IamPolicySchema } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/api_pb";
import type { IdentityAccount } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountProvisioningMode } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/enum_pb";
import { SsoRequirementPreviewInputSchema } from "@stigmer/protos/ai/stigmer/iam/identityprovider/v1/io_pb";
import { InvitationSchema } from "@stigmer/protos/ai/stigmer/iam/invitation/v1/api_pb";
import type { Invitation } from "@stigmer/protos/ai/stigmer/iam/invitation/v1/api_pb";
import { InvitationState } from "@stigmer/protos/ai/stigmer/iam/invitation/v1/enum_pb";
import type { AccountAutomation } from "@stigmer/server";
import { RequestContext } from "@stigmer/server";

import { NO_SSO_PROVIDER_MESSAGE } from "../sso-info.js";
import { previewSsoRequirement } from "../requirement-preview.js";
import type { RequirementPreviewDeps } from "../requirement-preview.js";
import { InMemoryProviderStore, storedProvider } from "./in-memory-provider-store.js";

const ACME = "org_acme";

function row(principal: { kind: string; id: string; relation?: string }, relation: string, resource: { kind: string; id: string }): IamPolicy {
  return create(IamPolicySchema, { spec: { principal, relation, resource } });
}

function account(id: string, email: string, extra: { provider?: string; serviceAccount?: boolean } = {}): IdentityAccount {
  return create(IdentityAccountSchema, {
    metadata: { id },
    spec: {
      idpId: `sub|${id}`,
      email,
      firstName: email.split("@")[0] ?? "",
      provisioningMode:
        extra.serviceAccount === true
          ? IdentityAccountProvisioningMode.service_account
          : IdentityAccountProvisioningMode.direct,
      ...(extra.provider === undefined ? {} : { identityProviderRef: { id: extra.provider, org: ACME } }),
    },
  });
}

async function deps(options: { sso?: boolean } = {}): Promise<RequirementPreviewDeps & { asked: string[][] }> {
  const store = new InMemoryProviderStore();
  if (options.sso !== false) {
    await store.insert(storedProvider({ id: "idp_acme", org: ACME, slug: "acme-okta", isSso: true }));
  }
  const org = { kind: "organization", id: ACME };
  const policies = [
    row({ kind: "identity_account", id: "ida_owner" }, "owner", org),
    row({ kind: "identity_account", id: "ida_raj" }, "admin", org),
    row({ kind: "identity_account", id: "ida_sso" }, "member", org),
    row({ kind: "identity_account", id: "ida_robot" }, "member", org),
    row({ kind: "team", id: "tm_sre", relation: "member" }, "viewer", org),
    row({ kind: "identity_account", id: "ida_ana" }, "member", { kind: "team", id: "tm_sre" }),
  ];
  const accounts = [
    account("ida_owner", "owner@acme.test"),
    account("ida_raj", "raj@gmail.test"),
    account("ida_sso", "raj@acme.test", { provider: "idp_acme" }),
    account("ida_robot", "", { serviceAccount: true }),
    account("ida_ana", "ana@gmail.test"),
  ];
  const invitations: Invitation[] = [
    create(InvitationSchema, {
      metadata: { id: "inv_raj", org: ACME },
      status: { state: InvitationState.active, audit: { specAudit: { createdBy: { id: "ida_raj" } } } },
    }),
  ];
  const automations: AccountAutomation[] = [
    { kind: ApiResourceKind.schedule, id: "sch_ana", slug: "digest", name: "Digest", accountId: "ida_ana" },
  ];
  const asked: string[][] = [];
  return {
    asked,
    store,
    organizations: {
      find: () =>
        Promise.resolve({ createdAt: new Date("2026-01-01"), name: "Acme", slug: "acme", logoUrl: "", parentOrg: "" }),
    },
    policies: {
      findByResource: (kind, id) =>
        Promise.resolve(policies.filter((held) => held.spec?.resource?.kind === kind && held.spec.resource.id === id)),
    },
    accounts: { findById: (id) => Promise.resolve(accounts.find((held) => held.metadata?.id === id)) },
    automations: {
      actingAs: (_org, ids) => {
        asked.push([...ids].sort());
        return Promise.resolve(automations.filter((held) => ids.has(held.accountId)));
      },
    },
    invitations: {
      findIdsByOrg: () => Promise.resolve(invitations.map((held) => held.metadata?.id ?? "")),
      findById: (id) => Promise.resolve(invitations.find((held) => held.metadata?.id === id)),
    },
  };
}

function ask(d: RequirementPreviewDeps) {
  return previewSsoRequirement(
    new RequestContext(
      SsoRequirementPreviewInputSchema,
      create(SsoRequirementPreviewInputSchema, { org: ACME }),
      { identityId: "ida_owner", callerClass: "user", issuer: "", rawToken: "" },
      ApiResourceKind.identity_provider,
    ),
    d,
  );
}

describe("the owners' preview of a sign-in requirement", () => {
  it("lists the members the provider did not sign in, with their invitations and automations, and the owners apart", async () => {
    const d = await deps();
    const preview = await ask(d);
    expect(preview.members.map((member) => member.identityAccountId).sort()).toEqual(["ida_ana", "ida_raj"]);
    const raj = preview.members.find((member) => member.identityAccountId === "ida_raj");
    expect(raj).toMatchObject({ email: "raj@gmail.test", displayName: "raj", invitationIds: ["inv_raj"] });
    const ana = preview.members.find((member) => member.identityAccountId === "ida_ana");
    expect(ana?.automations).toEqual([
      expect.objectContaining({ kind: "schedule", id: "sch_ana", slug: "digest", name: "Digest" }),
    ]);
    expect(preview.exemptOwners.map((owner) => owner.identityAccountId)).toEqual(["ida_owner"]);
    expect(d.asked).toEqual([["ida_ana", "ida_raj"]]);
  });

  it("is NOT_FOUND for an organization with no SSO provider", async () => {
    const error = await ask(await deps({ sso: false })).catch((caught: unknown) => ConnectError.from(caught));
    expect(error).toBeInstanceOf(ConnectError);
    expect((error as ConnectError).code).toBe(Code.NotFound);
    expect((error as ConnectError).rawMessage).toBe(NO_SSO_PROVIDER_MESSAGE);
  });
});
