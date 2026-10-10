// Service account conformance: an organization's own non-person account,
// which its automation acts as through API keys its admins create.
// Domain: iam / identityaccount and apikey (every edition that signs callers in).
//
// What runs, on the target's enforcing lane (the primary on the cloud, open
// source's OIDC sibling on the local targets), where keys authenticate:
//   - an admin creates a service account holding a role, and lists it; a
//     member may do neither; a name is unique among the organization's
//     service accounts; owner is never its role, at create or by a grant;
//   - an admin creates its keys, lists them and revokes one; a member may
//     do none of it; the keys never appear in the admin's own key list;
//   - its key keeps working after the admin who made it deletes their own
//     account, and what it creates names the service account as creator;
//   - its key is refused in every other organization;
//   - its key is refused every act that decides who belongs to the
//     organization or what credentials exist: creating keys, service
//     accounts or organizations, changing an identity account, granting or
//     revoking a role on the organization;
//   - deleting it ends every key at once, and it is no longer listed.
//
// A target with no enforcing lane skips visibly: a server that trusts
// every caller composes no key verifier, and refuses the create
// (FAILED_PRECONDITION, pinned by the server's own suite).
//
// Out of scope: a team's refusal of a service account as a member (teams
// are served by the hosted edition, whose own suite pins it), invitations
// (the same), and the console's pages.
import { Code } from "@connectrpc/connect";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { IdentityAccountProvisioningMode } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/enum_pb";
import { clone } from "@bufbuild/protobuf";
import { IdentityAccountSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import type { IdentityAccount } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import { expectGrpcCode } from "../contract/errors";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { makeAgent } from "../support/agents";
import { API_KEY_API_VERSION, API_KEY_KIND, plaintextKeyOf } from "../support/apikeys";
import { organizationRole } from "../support/iampolicies";
import { uniqueName } from "../support/naming";
import {
  createTarget,
  enforcingLaneOf,
  type EnforcingLane,
  type TargetProfile,
  type TenancyContext,
} from "../targets";

// The server's refusal copy for a service account's own key
// (pipeline/steps/refuse-service-account.ts), byte-pinned so an unrelated
// PERMISSION_DENIED cannot stand in for it.
function refusedMessage(act: string): string {
  return `a service account cannot ${act}; an organization admin must do it`;
}

let target: TargetProfile;
let lane: EnforcingLane | undefined;
let laneReason = "";
const fixtures = new FixtureTracker();

beforeAll(async () => {
  target = createTarget();
  await target.setup();
  const enforcing = await enforcingLaneOf(target);
  if (enforcing.lane === undefined) {
    laneReason = enforcing.reason;
  } else {
    lane = enforcing.lane;
  }
});

afterEach(async () => {
  await fixtures.cleanup();
});

afterAll(async () => {
  await target?.teardown();
});

function laneOrSkip(ctx: { skip: (note?: string) => void }): EnforcingLane {
  if (lane === undefined) {
    ctx.skip(laneReason);
    throw new Error("unreachable: skipped");
  }
  return lane;
}

async function tenancy(on: EnforcingLane): Promise<TenancyContext> {
  const context = await on.provisionTenancy();
  fixtures.defer(() => on.cleanupTenancy(context));
  return context;
}

async function createServiceAccount(
  as: ConformanceClients,
  org: string,
  role: IamRole = IamRole.member,
  name: string = uniqueName("ci"),
): Promise<IdentityAccount> {
  const account = await as.identityAccountCommand.createServiceAccount({
    org,
    name,
    role,
  });
  const id = account.metadata?.id ?? "";
  // The founder owns every lane organization, so it can always clean up,
  // whoever created the account; a delete the arm already made is NOT_FOUND.
  fixtures.defer(async () => {
    await lane?.clients.identityAccountCommand
      .delete({ value: id })
      .catch(() => undefined);
  });
  return account;
}

async function createKey(
  as: ConformanceClients,
  serviceAccountId: string,
): Promise<{ id: string; plaintext: string }> {
  const created = await as.apiKeyCommand.createForServiceAccount({
    serviceAccountId,
    name: uniqueName("key"),
    neverExpires: true,
  });
  return { id: created.metadata?.id ?? "", plaintext: plaintextKeyOf(created) };
}

async function createAgent(as: ConformanceClients, org: string) {
  const agent = await as.agentCommand.create(
    makeAgent({ org, name: uniqueName("sa-agent") }),
  );
  fixtures.defer(async () => {
    await lane?.clients.agentCommand
      .delete({ value: agent.metadata?.id ?? "" })
      .catch(() => undefined);
  });
  return agent;
}

describe("Service account conformance", () => {
  it("[rpc:IdentityAccountCommandController.createServiceAccount] [rpc:IdentityAccountQueryController.listServiceAccounts] an admin creates a service account holding a role and lists it; a member can do neither", async (ctx) => {
    const on = laneOrSkip(ctx);
    const org = await tenancy(on);
    const admin = await on.provisionWithRole(org, "admin");
    const member = await on.provisionMember(org);

    const account = await createServiceAccount(admin, org.org, IamRole.member, uniqueName("ci-deploy"));
    expect(account.spec?.provisioningMode).toBe(IdentityAccountProvisioningMode.service_account);
    expect(account.metadata?.org, "a service account belongs to its organization").toBe(org.org);
    expect(account.spec?.idpId ?? "").toMatch(/^stgm_sa\|/);
    expect(account.spec?.email ?? "", "a service account has no person's fields").toBe("");

    const listed = await admin.identityAccountQuery.listServiceAccounts({ org: org.org });
    expect(listed.entries.map((entry) => entry.metadata?.id)).toContain(account.metadata?.id);
    expect(
      listed.entries.every(
        (entry) => entry.spec?.provisioningMode === IdentityAccountProvisioningMode.service_account,
      ),
      "the list holds service accounts only, never people",
    ).toBe(true);

    await expectGrpcCode(
      () => member.identityAccountCommand.createServiceAccount({ org: org.org, name: uniqueName("ci"), role: IamRole.member }),
      Code.PermissionDenied,
      "a member creating a service account",
    );
    await expectGrpcCode(
      () => member.identityAccountQuery.listServiceAccounts({ org: org.org }),
      Code.PermissionDenied,
      "a member listing service accounts",
    );
  });

  it("[rpc:IdentityAccountCommandController.createServiceAccount] a name is unique among the organization's service accounts, and owner is never a service account's role", async (ctx) => {
    const on = laneOrSkip(ctx);
    const org = await tenancy(on);
    const name = uniqueName("ci-deploy");
    await createServiceAccount(on.clients, org.org, IamRole.member, name);

    await expectGrpcCode(
      () => on.clients.identityAccountCommand.createServiceAccount({ org: org.org, name, role: IamRole.viewer }),
      Code.AlreadyExists,
      "a second service account under a name the organization holds",
    );
    await expectGrpcCode(
      () => on.clients.identityAccountCommand.createServiceAccount({ org: org.org, name: uniqueName("ci"), role: IamRole.owner }),
      Code.InvalidArgument,
      "a service account created as owner",
    );

    const account = await createServiceAccount(on.clients, org.org);
    await expectGrpcCode(
      () =>
        on.clients.iamPolicyCommand.create(
          organizationRole(account.metadata?.id ?? "", "owner", org.org),
        ),
      Code.InvalidArgument,
      "the organization's owner granting owner to a service account",
    );
  });

  it("[rpc:ApiKeyCommandController.createForServiceAccount] [rpc:ApiKeyQueryController.findByAccount] an admin creates, lists and revokes a service account's keys; a member can do none of it; the keys are not the admin's own", async (ctx) => {
    const on = laneOrSkip(ctx);
    const org = await tenancy(on);
    const admin = await on.provisionWithRole(org, "admin");
    const member = await on.provisionMember(org);
    const account = await createServiceAccount(admin, org.org);
    const accountId = account.metadata?.id ?? "";

    const created = await admin.apiKeyCommand.createForServiceAccount({
      serviceAccountId: accountId,
      name: uniqueName("github-actions"),
      neverExpires: true,
    });
    expect(
      created.status?.audit?.specAudit?.createdBy?.id,
      "the key speaks for the service account, not for the admin who made it",
    ).toBe(accountId);
    expect(created.spec?.boundOrg, "the key works in the service account's organization").toBe(org.org);
    const plaintext = plaintextKeyOf(created);

    const listed = await admin.apiKeyQuery.findByAccount({ value: accountId });
    expect(listed.entries.map((key) => key.metadata?.id)).toContain(created.metadata?.id);
    const own = await admin.apiKeyQuery.findAll({});
    expect(
      own.entries.map((key) => key.metadata?.id),
      "a service account's keys are never in the admin's own list",
    ).not.toContain(created.metadata?.id);

    await expectGrpcCode(
      () => member.apiKeyCommand.createForServiceAccount({ serviceAccountId: accountId, name: uniqueName("key"), neverExpires: true }),
      Code.PermissionDenied,
      "a member creating a service account's key",
    );
    await expectGrpcCode(
      () => member.apiKeyQuery.findByAccount({ value: accountId }),
      Code.PermissionDenied,
      "a member listing a service account's keys",
    );
    await expectGrpcCode(
      () => member.apiKeyCommand.delete({ value: created.metadata?.id ?? "" }),
      Code.PermissionDenied,
      "a member revoking a service account's key",
    );

    await admin.apiKeyCommand.delete({ value: created.metadata?.id ?? "" });
    await expectGrpcCode(
      () => on.clientsPresenting(plaintext).identityAccountQuery.whoAmI({}),
      Code.Unauthenticated,
      "a revoked key",
    );
  });

  it("a service account's key keeps working after its creator deletes their account, and what it creates names the service account", async (ctx) => {
    const on = laneOrSkip(ctx);
    const org = await tenancy(on);
    const admin = await on.provisionWithRole(org, "admin");
    const account = await createServiceAccount(admin, org.org);
    const accountId = account.metadata?.id ?? "";
    const key = await createKey(admin, accountId);

    const adminId = await on.accountIdOf(admin);
    await admin.identityAccountCommand.delete({ value: adminId });

    const asKey = on.clientsPresenting(key.plaintext);
    const me = await asKey.identityAccountQuery.whoAmI({});
    expect(me.metadata?.id, "the key still answers as the service account").toBe(accountId);
    const agent = await createAgent(asKey, org.org);
    expect(
      agent.status?.audit?.specAudit?.createdBy?.id,
      "an agent the key creates names the service account as its creator",
    ).toBe(accountId);
    expect(agent.status?.audit?.specAudit?.createdBy?.displayName).toBe(account.metadata?.name);
  });

  it("a service account's key is refused in every other organization", async (ctx) => {
    const on = laneOrSkip(ctx);
    const home = await tenancy(on);
    const other = await tenancy(on);
    const account = await createServiceAccount(on.clients, home.org, IamRole.admin);
    const key = await createKey(on.clients, account.metadata?.id ?? "");
    const asKey = on.clientsPresenting(key.plaintext);

    await createAgent(asKey, home.org);
    await expectGrpcCode(
      () => createAgent(asKey, other.org),
      Code.PermissionDenied,
      "a service account's key writing in another organization",
    );
  });

  it("a service account's key never decides who belongs to the organization or what credentials exist", async (ctx) => {
    const on = laneOrSkip(ctx);
    const org = await tenancy(on);
    const account = await createServiceAccount(on.clients, org.org, IamRole.admin);
    const accountId = account.metadata?.id ?? "";
    const key = await createKey(on.clients, accountId);
    const asKey = on.clientsPresenting(key.plaintext);
    const colleague = await on.provisionMember(org);
    const colleagueId = await on.accountIdOf(colleague);

    const refusals: ReadonlyArray<{ act: string; call: () => Promise<unknown> }> = [
      {
        act: "create API keys",
        call: () =>
          asKey.apiKeyCommand.create({
            apiVersion: API_KEY_API_VERSION,
            kind: API_KEY_KIND,
            metadata: { name: uniqueName("key"), org: org.org },
            spec: {},
          }),
      },
      {
        act: "create API keys",
        call: () => asKey.apiKeyCommand.createForServiceAccount({ serviceAccountId: accountId, name: uniqueName("key"), neverExpires: true }),
      },
      {
        act: "create service accounts",
        call: () => asKey.identityAccountCommand.createServiceAccount({ org: org.org, name: uniqueName("ci"), role: IamRole.member }),
      },
      {
        act: "change or delete identity accounts",
        call: () => {
          const renamed = clone(IdentityAccountSchema, account);
          renamed.metadata!.name = uniqueName("renamed");
          return asKey.identityAccountCommand.update(renamed);
        },
      },
      {
        act: "change or delete identity accounts",
        call: () => asKey.identityAccountCommand.delete({ value: accountId }),
      },
      {
        act: "create organizations",
        call: () =>
          asKey.organizationCommand.create({
            apiVersion: "tenancy.stigmer.ai/v1",
            kind: "Organization",
            metadata: { name: uniqueName("sa-child") },
            spec: { parentOrg: org.org },
          }),
      },
      {
        act: "grant or revoke roles on the organization",
        call: () => asKey.iamPolicyCommand.create(organizationRole(colleagueId, "admin", org.org)),
      },
      {
        act: "grant or revoke roles on the organization",
        call: () => asKey.iamPolicyCommand.delete(organizationRole(colleagueId, "member", org.org)),
      },
      {
        act: "grant or revoke roles on the organization",
        call: () => asKey.iamPolicyCommand.revokeOrgAccess({ identityAccountId: colleagueId, org: org.org }),
      },
    ];
    for (const { act, call } of refusals) {
      const error = await expectGrpcCode(call, Code.PermissionDenied, `a service account's key: ${act}`);
      expect(error.rawMessage).toBe(refusedMessage(act));
    }
  });

  it("deleting a service account ends every key at once, and it is no longer listed", async (ctx) => {
    const on = laneOrSkip(ctx);
    const org = await tenancy(on);
    const account = await createServiceAccount(on.clients, org.org);
    const accountId = account.metadata?.id ?? "";
    const first = await createKey(on.clients, accountId);
    const second = await createKey(on.clients, accountId);

    await on.clients.identityAccountCommand.delete({ value: accountId });

    for (const key of [first, second]) {
      await expectGrpcCode(
        () => on.clientsPresenting(key.plaintext).identityAccountQuery.whoAmI({}),
        Code.Unauthenticated,
        "a deleted service account's key",
      );
    }
    const listed = await on.clients.identityAccountQuery.listServiceAccounts({ org: org.org });
    expect(listed.entries.map((entry) => entry.metadata?.id)).not.toContain(accountId);
  });
});
