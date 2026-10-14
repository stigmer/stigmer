// Conformance suite for the Team domain: a named group of an organization's
// people, which a resource can be shared with (Class A; no runner).
// Domain: iam / team.
//
// Drives TeamCommandController and TeamQueryController through the raw
// proto stubs, with real people from the target's enforcing lane: the
// founder (the organization's owner), an admin, a member, a second member
// and an outsider who holds nothing on it.
//
// Where `teams` is not `unimplemented` (enterprise; cloud on a tenancy moved
// to the Team plan, provisionTeamsTenancy):
//   - an admin creates a team, which names its organization and the slug its
//     name gives; a second team of the same name in the organization is
//     ALREADY_EXISTS;
//   - every person of the organization reads a team by id, by slug and in
//     the organization's list; an outsider is refused all three;
//   - update changes the description under an update_mask and refuses a
//     request with none; rename moves the slug and keeps the id;
//   - joining a team is an IamPolicy grant of `member` on it, and sharing a
//     private agent with the team reaches its members and nobody else in the
//     organization; deleting the team takes the share back;
//   - a person outside the organization cannot be added to a team
//     (FAILED_PRECONDITION, the grant gate's copy naming the organization's
//     slug), and a plain member cannot create one (PERMISSION_DENIED).
// Where `teams` is `plan-gated` (cloud), an organization on Free is refused
// a team with FAILED_PRECONDITION, reason PLAN_UPGRADE_REQUIRED, feature
// teams. Where it is `unimplemented` (open source), every Team RPC answers
// Unimplemented, pinned once per RPC.
//
// Deliberately out of scope: the old slug's 30-day read after a rename and
// the team's display in the console, which Enterprise's composed and
// handler suites pin; the plan's prices and the move's billing, which the
// billing suites pin.
import { clone, create } from "@bufbuild/protobuf";
import { Code } from "@connectrpc/connect";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { TeamSchema, type Team } from "@stigmer/protos/ai/stigmer/iam/team/v1/api_pb";
import { TeamCommandController } from "@stigmer/protos/ai/stigmer/iam/team/v1/command_pb";
import { TeamQueryController } from "@stigmer/protos/ai/stigmer/iam/team/v1/query_pb";
import { TeamSpecSchema } from "@stigmer/protos/ai/stigmer/iam/team/v1/spec_pb";
import { ErrorInfoSchema } from "@stigmer/protos/google/rpc/error_details_pb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { expectGrpcCode, expectGrpcCodeWithin } from "../contract/errors";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { makeAgent } from "../support/agents";
import { uniqueName } from "../support/naming";
import { organizationSlug } from "../support/organizations";
import { makeTeam, notAnOrganizationMemberMessage, TEAM_DENIED, teamMembership, teamShare } from "../support/teams";
import { createTarget, enforcingLaneOf, type EnforcingLane, type TargetProfile, type TenancyContext } from "../targets";

// Collection-time capability read (the billing suites' pattern).
const capabilities = createTarget().capabilities;
const teamsServed = capabilities.teams !== "unimplemented";

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

// The loud-failure posture: a target that serves teams without these is a
// target bug, never a skip.
async function requireLane(): Promise<EnforcingLane> {
  const enforcing = await enforcingLaneOf(target);
  if (enforcing.lane === undefined) {
    throw new Error(`target ${target.name} declares teams but lends no enforcing lane: ${enforcing.reason}`);
  }
  return enforcing.lane;
}

async function teamsTenancy(): Promise<TenancyContext> {
  if (target.provisionTeamsTenancy === undefined) {
    throw new Error(`target ${target.name} declares teams but provides no provisionTeamsTenancy()`);
  }
  return target.provisionTeamsTenancy();
}

// The people of one organization that may have teams, provisioned once per
// block; the rows are per arm.
interface Cast {
  readonly tenancy: TenancyContext;
  readonly org: string;
  readonly admin: ConformanceClients;
  readonly member: ConformanceClients;
  readonly memberId: string;
  readonly otherMember: ConformanceClients;
  readonly outsider: ConformanceClients;
  readonly outsiderId: string;
}

async function castOf(lane: EnforcingLane): Promise<Cast> {
  const tenancy = await teamsTenancy();
  const member = await lane.provisionMember(tenancy);
  const outsider = await lane.provisionIdentity();
  return {
    tenancy,
    org: tenancy.org,
    admin: await lane.provisionWithRole(tenancy, "admin"),
    member,
    memberId: await lane.accountIdOf(member),
    otherMember: await lane.provisionMember(tenancy),
    outsider,
    outsiderId: await lane.accountIdOf(outsider),
  };
}

// A team the given caller creates, deleted by the founder at cleanup.
async function createTeam(as: ConformanceClients, org: string, label = "team"): Promise<Team> {
  const team = await as.teamCommand.create(makeTeam({ org, name: uniqueName(label) }));
  fixtures.defer(() => clients.teamCommand.delete({ resourceId: team.metadata?.id ?? "" }));
  return team;
}

describe.skipIf(!teamsServed)("Team conformance — the team lane (teams served)", () => {
  let lane: EnforcingLane;
  let cast: Cast;

  beforeAll(async () => {
    lane = await requireLane();
    cast = await castOf(lane);
  });

  afterAll(async () => {
    if (cast !== undefined) await target.cleanupTenancy(cast.tenancy);
  });

  it("[rpc:TeamCommandController.create] an admin creates a team in the organization under the slug its name gives, and a second of the same name is ALREADY_EXISTS", async () => {
    const name = uniqueName("platform");
    const team = await cast.admin.teamCommand.create(makeTeam({ org: cast.org, name, description: "the platform team" }));
    fixtures.defer(() => clients.teamCommand.delete({ resourceId: team.metadata?.id ?? "" }));

    expect(team.metadata?.id).toMatch(/^tm_/);
    expect(team.metadata?.org).toBe(cast.org);
    expect(team.metadata?.slug).toBe(name);
    expect(team.spec?.description).toBe("the platform team");
    await expectGrpcCode(
      () => cast.admin.teamCommand.create(makeTeam({ org: cast.org, name })),
      Code.AlreadyExists,
      "a second team of the same name",
    );
  });

  it("[rpc:TeamCommandController.create] a plain member cannot create a team: PERMISSION_DENIED with the proto's copy", async () => {
    const refused = await expectGrpcCode(
      () => cast.member.teamCommand.create(makeTeam({ org: cast.org, name: uniqueName("members-team") })),
      Code.PermissionDenied,
      "a member's team create",
    );
    expect(refused.rawMessage).toBe(TEAM_DENIED.create);
  });

  it("[rpc:TeamQueryController.get] [rpc:TeamQueryController.getByReference] [rpc:TeamQueryController.list] a member of the organization reads a team by id, by slug and in the list; an outsider is refused all three", async () => {
    const team = await createTeam(cast.admin, cast.org, "readable");
    const id = team.metadata?.id ?? "";
    const slug = team.metadata?.slug ?? "";

    expect((await cast.member.teamQuery.get({ value: id })).metadata?.slug).toBe(slug);
    const byReference = await cast.member.teamQuery.getByReference({ org: cast.org, kind: ApiResourceKind.team, slug });
    expect(byReference.metadata?.id).toBe(id);
    const { entries } = await cast.member.teamQuery.list({ org: cast.org });
    expect(entries.map((entry) => entry.metadata?.id)).toContain(id);

    const get = await expectGrpcCode(() => cast.outsider.teamQuery.get({ value: id }), Code.PermissionDenied, "an outsider's get");
    expect(get.rawMessage).toBe(TEAM_DENIED.view);
    await expectGrpcCode(
      () => cast.outsider.teamQuery.getByReference({ org: cast.org, kind: ApiResourceKind.team, slug }),
      Code.PermissionDenied,
      "an outsider's getByReference",
    );
    const list = await expectGrpcCode(() => cast.outsider.teamQuery.list({ org: cast.org }), Code.PermissionDenied, "an outsider's list");
    expect(list.rawMessage).toBe(TEAM_DENIED.list);
  });

  it("[rpc:TeamCommandController.update] update changes the description the mask names, and a request without a mask is INVALID_ARGUMENT", async () => {
    const team = await createTeam(cast.admin, cast.org, "described");

    const changed = clone(TeamSchema, team);
    changed.spec = create(TeamSpecSchema, { description: "the on-call rotation" });
    const updated = await cast.admin.teamCommand.update({ resource: changed, updateMask: { paths: ["spec.description"] } });
    expect(updated.metadata?.id).toBe(team.metadata?.id);
    expect(updated.spec?.description).toBe("the on-call rotation");
    expect((await clients.teamQuery.get({ value: team.metadata?.id ?? "" })).spec?.description).toBe("the on-call rotation");

    await expectGrpcCode(
      () => cast.admin.teamCommand.update({ resource: changed }),
      Code.InvalidArgument,
      "an update without a mask",
    );
  });

  it("[rpc:TeamCommandController.rename] rename moves the slug and keeps the id, and the new slug finds the team", async () => {
    const team = await createTeam(cast.admin, cast.org, "renamed");
    const slug = uniqueName("sre");

    const renamed = await cast.admin.teamCommand.rename({ resourceId: team.metadata?.id ?? "", slug });
    expect(renamed.metadata?.id).toBe(team.metadata?.id);
    expect(renamed.metadata?.slug).toBe(slug);
    const found = await clients.teamQuery.getByReference({ org: cast.org, kind: ApiResourceKind.team, slug });
    expect(found.metadata?.id).toBe(team.metadata?.id);
  });

  it("[rpc:TeamCommandController.delete] a private agent shared with a team reaches the team's members and no one else, and deleting the team takes it back", async () => {
    const input = makeAgent({ org: cast.org, name: uniqueName("team-agent") });
    input.metadata = { ...input.metadata, visibility: ApiResourceVisibility.visibility_private };
    const agent = await clients.agentCommand.create(input);
    const agentId = agent.metadata?.id ?? "";
    fixtures.defer(() => clients.agentCommand.delete({ value: agentId }));
    const team = await cast.admin.teamCommand.create(makeTeam({ org: cast.org, name: uniqueName("agent-team") }));
    const teamId = team.metadata?.id ?? "";

    await clients.iamPolicyCommand.create(teamMembership(teamId, cast.memberId));
    await clients.iamPolicyCommand.create(teamShare(teamId, "viewer", { kind: "agent", id: agentId }));

    expect((await cast.member.agentQuery.get({ value: agentId })).metadata?.id).toBe(agentId);
    await expectGrpcCode(
      () => cast.otherMember.agentQuery.get({ value: agentId }),
      Code.PermissionDenied,
      "a member of the organization outside the team",
    );

    const deleted = await cast.admin.teamCommand.delete({ resourceId: teamId });
    expect(deleted.metadata?.id).toBe(teamId);
    await expectGrpcCode(() => clients.teamQuery.get({ value: teamId }), Code.NotFound, "the deleted team");
    await expectGrpcCodeWithin(
      () => cast.member.agentQuery.get({ value: agentId }),
      Code.PermissionDenied,
      "the former team member, once the team is deleted",
    );
  });

  it("[rpc:IamPolicyCommandController.create] a person outside the organization cannot be added to its team: FAILED_PRECONDITION naming the organization", async () => {
    const team = await createTeam(cast.admin, cast.org, "closed");

    const refused = await expectGrpcCode(
      () => clients.iamPolicyCommand.create(teamMembership(team.metadata?.id ?? "", cast.outsiderId)),
      Code.FailedPrecondition,
      "adding an outsider to a team",
    );
    expect(refused.rawMessage).toBe(
      notAnOrganizationMemberMessage(cast.outsiderId, await organizationSlug(clients.organizationQuery, cast.org)),
    );
  });
});

describe.skipIf(capabilities.teams !== "plan-gated")("Team conformance — the plan gate (teams plan-gated)", () => {
  it("[rpc:TeamCommandController.create] an organization on a plan without teams is refused a team with PLAN_UPGRADE_REQUIRED, naming the feature", async () => {
    const tenancy = await target.provisionTenancy();
    fixtures.defer(() => target.cleanupTenancy(tenancy));

    const refused = await expectGrpcCode(
      () => clients.teamCommand.create(makeTeam({ org: tenancy.org, name: uniqueName("free-team") })),
      Code.FailedPrecondition,
      "a team on Free",
    );
    const [info] = refused.findDetails(ErrorInfoSchema);
    expect(info?.reason).toBe("PLAN_UPGRADE_REQUIRED");
    expect(info?.metadata.feature).toBe("teams");
  });
});

describe.skipIf(teamsServed)("Team conformance — the OSS boundary (no Team service routed)", () => {
  it("[rpc:TeamCommandController.create] [rpc:TeamCommandController.update] [rpc:TeamCommandController.rename] [rpc:TeamCommandController.delete] [rpc:TeamQueryController.get] [rpc:TeamQueryController.getByReference] [rpc:TeamQueryController.list] every Team RPC answers Unimplemented where teams is unimplemented", async () => {
    const org = "conformance-oss-boundary";
    const lanes: ReadonlyArray<readonly [string, () => Promise<unknown>]> = [
      ["Team.create", () => clients.teamCommand.create(makeTeam({ org, name: "boundary" }))],
      ["Team.update", () => clients.teamCommand.update({ resource: { metadata: { id: "tm_x" } }, updateMask: { paths: ["spec.description"] } })],
      ["Team.rename", () => clients.teamCommand.rename({ resourceId: "tm_x", slug: "renamed" })],
      ["Team.delete", () => clients.teamCommand.delete({ resourceId: "tm_x" })],
      ["Team.get", () => clients.teamQuery.get({ value: "tm_x" })],
      ["Team.getByReference", () => clients.teamQuery.getByReference({ org, kind: ApiResourceKind.team, slug: "boundary" })],
      ["Team.list", () => clients.teamQuery.list({ org })],
    ];
    // Every method the two controllers declare, so a new RPC on the
    // contract fails here until its boundary is pinned.
    const declared = TeamCommandController.methods.length + TeamQueryController.methods.length;
    expect(lanes, "one lane per declared RPC").toHaveLength(declared);
    for (const [name, op] of lanes) {
      await expectGrpcCode(op, Code.Unimplemented, `OSS ${name}`);
    }
  });
});
