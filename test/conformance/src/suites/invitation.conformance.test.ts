// Conformance suite for the Invitation domain: a link an organization's
// admin makes, which lets a signed-in colleague join the organization in the
// role the link names (Class A; no runner).
// Domain: iam / invitation.
//
// Drives InvitationCommandController and InvitationQueryController through
// the raw proto stubs, with real people from the target's enforcing lane.
// No mail is sent anywhere: the link's token is the credential, and its
// holder redeems it.
//
// Where `invitations` is true (enterprise, cloud):
//   - an admin makes a link: the answer carries the token, the link is
//     active and unused; an expiry past 30 days is INVALID_ARGUMENT, an
//     owner link needs an owner (PERMISSION_DENIED for an admin), and a
//     plain member may make none;
//   - anyone, signed in or not, previews a link by its token: the
//     organization, the role and whether it is still valid, never the
//     token; an unknown token is NOT_FOUND;
//   - the organization's admins read a link, token included, by id and in
//     the list; a viewer is refused both;
//   - a fresh person redeems the link and holds its role on the
//     organization; redeeming again is ALREADY_EXISTS; a link of one use
//     refuses a second person; a revoked link refuses everyone, and its
//     preview says why;
//   - where teams are served too, the journey a customer buys: the
//     colleague who joined by link is added to a team and opens the agent
//     shared with it.
// Where it is false (open source), every Invitation RPC answers
// Unimplemented, pinned once per RPC.
//
// Deliberately out of scope: an expired link (its expiry is at least the
// create's "now", so a test would wait it out; the handler suite pins it)
// and a link whose creator has since lost the right to make it, which
// Enterprise's handler suite pins.
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { Code } from "@connectrpc/connect";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import type { Invitation, InvitationSchema } from "@stigmer/protos/ai/stigmer/iam/invitation/v1/api_pb";
import { InvitationCommandController } from "@stigmer/protos/ai/stigmer/iam/invitation/v1/command_pb";
import { InvitationState } from "@stigmer/protos/ai/stigmer/iam/invitation/v1/enum_pb";
import { InvitationQueryController } from "@stigmer/protos/ai/stigmer/iam/invitation/v1/query_pb";
import { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { expectGrpcCode } from "../contract/errors";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { makeAgent } from "../support/agents";
import { OWNER_ASSIGNMENT_DENIED_MESSAGE, ref } from "../support/iampolicies";
import type { InitShape } from "../support/init-shape";
import { uniqueName } from "../support/naming";
import { makeTeam, teamMembership, teamShare } from "../support/teams";
import { createTarget, enforcingLaneOf, type EnforcingLane, type TargetProfile, type TenancyContext } from "../targets";

// Collection-time capability read (the billing suites' pattern).
const capabilities = createTarget().capabilities;

let target: TargetProfile;
let clients: ConformanceClients;
const fixtures = new FixtureTracker();

beforeAll(async () => {
  target = createTarget();
  await target.setup();
  clients = target.clients();
});

afterEach(async () => {
  await fixtures.cleanup();
});

afterAll(async () => {
  await target?.teardown();
});

const DAY_MS = 24 * 60 * 60 * 1000;

// The proto's annotation copy (invitation/v1/command.proto, query.proto) and
// the lane's own refusals (ee/server/src/iam/invitation/handlers.ts), which
// the invite page shows the person as they are.
const COPY = {
  createDenied: "unauthorized to create invitation in this organization",
  viewDenied: "unauthorized to view invitation",
  listDenied: "unauthorized to list invitations in this organization",
  expiryTooFar: "Invitation expiration cannot exceed 30 days from now",
  notFound: "Invitation not found",
  alreadyMember: "You are already a member of this organization",
  revoked: "This invitation has been revoked",
  usedUp: "This invitation has reached its maximum number of uses",
} as const;

function makeInvitation(input: {
  org: string;
  role?: IamRole;
  maxRedemptions?: number;
  expiresInMs?: number;
  label?: string;
}): InitShape<typeof InvitationSchema> {
  return {
    apiVersion: "iam.stigmer.ai/v1",
    kind: "Invitation",
    metadata: { name: uniqueName("invite"), org: input.org },
    spec: {
      role: input.role ?? IamRole.member,
      maxRedemptions: input.maxRedemptions ?? 0,
      expiresAt: timestampFromDate(new Date(Date.now() + (input.expiresInMs ?? DAY_MS))),
      label: input.label ?? "",
    },
  };
}

async function requireLane(): Promise<EnforcingLane> {
  const enforcing = await enforcingLaneOf(target);
  if (enforcing.lane === undefined) {
    throw new Error(`target ${target.name} declares invitations but lends no enforcing lane: ${enforcing.reason}`);
  }
  return enforcing.lane;
}

// The roles a principal holds on the organization, read by its owner.
async function organizationRolesOf(org: string, accountId: string): Promise<string[]> {
  const { roles } = await clients.iamPolicyQuery.getPrincipalResourceRoles({
    principal: ref("identity_account", accountId),
    resource: ref("organization", org),
  });
  return roles.map((role) => role.code);
}

describe.skipIf(!capabilities.invitations)("Invitation conformance — the invitation lane (invitations served)", () => {
  let lane: EnforcingLane;
  let tenancy: TenancyContext;
  let org: string;
  let admin: ConformanceClients;
  let member: ConformanceClients;
  let viewer: ConformanceClients;

  beforeAll(async () => {
    lane = await requireLane();
    tenancy = await lane.provisionTenancy();
    org = tenancy.org;
    admin = await lane.provisionWithRole(tenancy, "admin");
    member = await lane.provisionMember(tenancy);
    viewer = await lane.provisionWithRole(tenancy, "viewer");
  });

  afterAll(async () => {
    if (tenancy !== undefined) await lane.cleanupTenancy(tenancy);
  });

  // A link the admin makes; the organization's delete removes it.
  async function invite(options: Omit<Parameters<typeof makeInvitation>[0], "org"> = {}): Promise<Invitation> {
    return admin.invitationCommand.create(makeInvitation({ org, ...options }));
  }

  it("[rpc:InvitationCommandController.create] an admin makes a link: the answer carries its token, active and unused", async () => {
    const invitation = await admin.invitationCommand.create(
      makeInvitation({ org, role: IamRole.viewer, maxRedemptions: 3, label: "for the auditors" }),
    );

    expect(invitation.metadata?.id).toMatch(/^inv_/);
    expect(invitation.metadata?.org).toBe(org);
    expect(invitation.spec?.role).toBe(IamRole.viewer);
    expect(invitation.spec?.maxRedemptions).toBe(3);
    expect(invitation.status?.token, "the token is the link").not.toBe("");
    expect(invitation.status?.state).toBe(InvitationState.active);
    expect(invitation.status?.redemptionCount).toBe(0);
  });

  it("[rpc:InvitationCommandController.create] a link expiring past 30 days is INVALID_ARGUMENT, an owner link needs an owner, and a plain member makes none", async () => {
    const tooFar = await expectGrpcCode(
      () => admin.invitationCommand.create(makeInvitation({ org, expiresInMs: 31 * DAY_MS })),
      Code.InvalidArgument,
      "an expiry past 30 days",
    );
    expect(tooFar.rawMessage).toBe(COPY.expiryTooFar);

    const ownerLink = await expectGrpcCode(
      () => admin.invitationCommand.create(makeInvitation({ org, role: IamRole.owner })),
      Code.PermissionDenied,
      "an admin's owner link",
    );
    expect(ownerLink.rawMessage).toBe(OWNER_ASSIGNMENT_DENIED_MESSAGE);

    const byMember = await expectGrpcCode(
      () => member.invitationCommand.create(makeInvitation({ org })),
      Code.PermissionDenied,
      "a member's link",
    );
    expect(byMember.rawMessage).toBe(COPY.createDenied);
  });

  it("[rpc:InvitationQueryController.getByToken] anyone previews a link by its token: the organization, the role and its validity, never the token; an unknown token is NOT_FOUND", async () => {
    const invitation = await invite({ role: IamRole.member, label: "welcome aboard" });
    const token = invitation.status?.token ?? "";

    const preview = await target.anonymousClients().invitationQuery.getByToken({ token });
    expect(preview.role).toBe(IamRole.member);
    expect(preview.label).toBe("welcome aboard");
    expect(preview.isValid).toBe(true);
    expect(preview.invalidReason).toBe("");
    expect(preview.orgSlug, "the organization by the name people know it by").not.toBe("");
    expect(JSON.stringify(preview), "the preview never carries the token").not.toContain(token);

    const unknown = await expectGrpcCode(
      () => target.anonymousClients().invitationQuery.getByToken({ token: uniqueName("no-such-token") }),
      Code.NotFound,
      "an unknown token",
    );
    expect(unknown.rawMessage).toBe(COPY.notFound);
  });

  it("[rpc:InvitationQueryController.get] [rpc:InvitationQueryController.list] the organization's admins read a link, token included, by id and in the list; a viewer is refused both", async () => {
    const invitation = await invite();
    const id = invitation.metadata?.id ?? "";

    const read = await admin.invitationQuery.get({ value: id });
    expect(read.status?.token).toBe(invitation.status?.token);
    const { entries } = await admin.invitationQuery.list({ org });
    expect(entries.find((entry) => entry.metadata?.id === id)?.status?.token).toBe(invitation.status?.token);

    const get = await expectGrpcCode(() => viewer.invitationQuery.get({ value: id }), Code.PermissionDenied, "a viewer's get");
    expect(get.rawMessage).toBe(COPY.viewDenied);
    const list = await expectGrpcCode(() => viewer.invitationQuery.list({ org }), Code.PermissionDenied, "a viewer's list");
    expect(list.rawMessage).toBe(COPY.listDenied);
  });

  it("[rpc:InvitationCommandController.redeem] a fresh person who redeems the link holds its role on the organization; redeeming again is ALREADY_EXISTS, and an unknown token is NOT_FOUND", async () => {
    const invitation = await invite({ role: IamRole.member });
    const token = invitation.status?.token ?? "";
    const newcomer = await lane.provisionIdentity();
    const newcomerId = await lane.accountIdOf(newcomer);

    const redeemed = await newcomer.invitationCommand.redeem({ token });
    expect(redeemed.status?.redemptionCount).toBe(1);
    expect(redeemed.status?.redemptions.map((entry) => entry.identityAccountId)).toEqual([newcomerId]);
    expect(await organizationRolesOf(org, newcomerId)).toEqual(["member"]);

    const again = await expectGrpcCode(() => newcomer.invitationCommand.redeem({ token }), Code.AlreadyExists, "a second redeem");
    expect(again.rawMessage).toBe(COPY.alreadyMember);
    const unknown = await expectGrpcCode(
      () => newcomer.invitationCommand.redeem({ token: uniqueName("no-such-token") }),
      Code.NotFound,
      "an unknown token",
    );
    expect(unknown.rawMessage).toBe(COPY.notFound);
  });

  it("[rpc:InvitationCommandController.redeem] a link of one use refuses a second person, and its preview says it is used up", async () => {
    const invitation = await invite({ maxRedemptions: 1 });
    const token = invitation.status?.token ?? "";
    await (await lane.provisionIdentity()).invitationCommand.redeem({ token });

    const second = await lane.provisionIdentity();
    const refused = await expectGrpcCode(() => second.invitationCommand.redeem({ token }), Code.FailedPrecondition, "a used-up link");
    expect(refused.rawMessage).toBe(COPY.usedUp);
    expect(await organizationRolesOf(org, await lane.accountIdOf(second))).toEqual([]);
    const preview = await target.anonymousClients().invitationQuery.getByToken({ token });
    expect(preview.isValid).toBe(false);
    expect(preview.invalidReason).toBe(COPY.usedUp);
  });

  it("[rpc:InvitationCommandController.revoke] a revoked link refuses everyone and its preview says why; revoking it again changes nothing", async () => {
    const invitation = await invite();
    const id = invitation.metadata?.id ?? "";
    const token = invitation.status?.token ?? "";

    const revoked = await admin.invitationCommand.revoke({ value: id });
    expect(revoked.status?.state).toBe(InvitationState.revoked);
    expect((await admin.invitationCommand.revoke({ value: id })).status?.state).toBe(InvitationState.revoked);

    const refused = await expectGrpcCode(
      async () => (await lane.provisionIdentity()).invitationCommand.redeem({ token }),
      Code.FailedPrecondition,
      "a revoked link",
    );
    expect(refused.rawMessage).toBe(COPY.revoked);
    const preview = await target.anonymousClients().invitationQuery.getByToken({ token });
    expect(preview.isValid).toBe(false);
    expect(preview.invalidReason).toBe(COPY.revoked);
  });
});

describe.skipIf(!capabilities.invitations || capabilities.teams === "unimplemented")(
  "Invitation conformance — the colleague's journey (invitations and teams served)",
  () => {
    it("[rpc:InvitationCommandController.redeem] a colleague who joins by link is added to a team and opens the agent shared with it", async () => {
      const lane = await requireLane();
      if (target.provisionTeamsTenancy === undefined) {
        throw new Error(`target ${target.name} declares teams but provides no provisionTeamsTenancy()`);
      }
      const tenancy = await target.provisionTeamsTenancy();
      fixtures.defer(() => target.cleanupTenancy(tenancy));
      const input = makeAgent({ org: tenancy.org, name: uniqueName("journey-agent") });
      input.metadata = { ...input.metadata, visibility: ApiResourceVisibility.visibility_private };
      const agent = await clients.agentCommand.create(input);
      const agentId = agent.metadata?.id ?? "";
      fixtures.defer(() => clients.agentCommand.delete({ value: agentId }));
      const team = await clients.teamCommand.create(makeTeam({ org: tenancy.org, name: uniqueName("journey-team") }));
      const teamId = team.metadata?.id ?? "";
      await clients.iamPolicyCommand.create(teamShare(teamId, "viewer", { kind: "agent", id: agentId }));
      const invitation = await clients.invitationCommand.create(makeInvitation({ org: tenancy.org, role: IamRole.member }));

      const colleague = await lane.provisionIdentity();
      await colleague.invitationCommand.redeem({ token: invitation.status?.token ?? "" });
      await clients.iamPolicyCommand.create(teamMembership(teamId, await lane.accountIdOf(colleague)));

      const opened = await colleague.agentQuery.get({ value: agentId });
      expect(opened.metadata?.id).toBe(agentId);
    });
  },
);

describe.skipIf(capabilities.invitations)("Invitation conformance — the OSS boundary (no Invitation service routed)", () => {
  it("[rpc:InvitationCommandController.create] [rpc:InvitationCommandController.revoke] [rpc:InvitationCommandController.redeem] [rpc:InvitationQueryController.get] [rpc:InvitationQueryController.list] [rpc:InvitationQueryController.getByToken] every Invitation RPC answers Unimplemented where invitations is false", async () => {
    const org = "conformance-oss-boundary";
    const lanes: ReadonlyArray<readonly [string, () => Promise<unknown>]> = [
      ["Invitation.create", () => clients.invitationCommand.create(makeInvitation({ org }))],
      ["Invitation.revoke", () => clients.invitationCommand.revoke({ value: "inv_x" })],
      ["Invitation.redeem", () => clients.invitationCommand.redeem({ token: "boundary" })],
      ["Invitation.get", () => clients.invitationQuery.get({ value: "inv_x" })],
      ["Invitation.list", () => clients.invitationQuery.list({ org })],
      ["Invitation.getByToken", () => clients.invitationQuery.getByToken({ token: "boundary" })],
    ];
    // Every method the two controllers declare, so a new RPC on the
    // contract fails here until its boundary is pinned.
    const declared = InvitationCommandController.methods.length + InvitationQueryController.methods.length;
    expect(lanes, "one lane per declared RPC").toHaveLength(declared);
    for (const [name, op] of lanes) {
      await expectGrpcCode(op, Code.Unimplemented, `OSS ${name}`);
    }
  });
});
