// Conformance suite for the ScoringRule domain: AI grading switched on per
// agent, with no engine.
// Domain: agentic / scoring rule — the per-agent AI grading switch.
//
// What is pinned here, on every edition:
//   - an agent has no scoring rule until one is created: getByAgent answers
//     NOT_FOUND, which reads as "grading is off";
//   - create, get, getByAgent, update and delete round-trip the settings,
//     and a new scoring rule's month starts empty;
//   - one scoring rule per agent: a second create is ALREADY_EXISTS carrying
//     SCORING_RULE_EXISTS and the existing scoring rule's id;
//   - a scoring rule lives in its agent's organization, grades the agent it
//     was made for (agent_id is fixed), and refuses a sample rate outside
//     (0, 1] and a limit of zero;
//   - deleting the agent deletes its scoring rule;
//   - under an enforcing authorizer, a member who sees an organization's
//     agent sees its grading but cannot switch it on or change it, and an
//     outsider sees nothing.
// The judge itself (grading a completed run) needs an engine and is pinned
// in the execution slice (suites-execution/ai-judge.conformance.test.ts).
import { Code } from "@connectrpc/connect";
import { ErrorInfoSchema } from "@stigmer/apis/google/rpc/error_details_pb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { expectGrpcCode } from "../contract/errors";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { makeAgent } from "../support/agents";
import {
  SCORING_RULE_AGENT_IMMUTABLE_MESSAGE,
  SCORING_RULE_CREATE_DENIED_MESSAGE,
  SCORING_RULE_EXISTS_REASON,
  scoringRuleOrgMismatchMessage,
  makeScoringRule,
} from "../support/scoring-rules";
import { uniqueName } from "../support/naming";
import { createTarget, enforcingLaneOf, type TargetProfile } from "../targets";

const MISSING_AGENT_ID = "agt_01jzzzzzzzzzzzzzzzzzzzzzzz";

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

async function createAgentIn(org: string, on: ConformanceClients = clients) {
  const agent = await on.agentCommand.create(makeAgent({ org, name: uniqueName("graded") }));
  fixtures.defer(() => on.agentCommand.delete({ value: agent.metadata!.id }).then(() => undefined));
  return agent;
}

describe("ScoringRule conformance", () => {
  it("[rpc:ScoringRuleQueryController.getByAgent] [rpc:ScoringRuleCommandController.create] [rpc:ScoringRuleQueryController.get] [rpc:ScoringRuleCommandController.update] [rpc:ScoringRuleCommandController.delete] an agent's grading is off until a scoring rule is created, and its settings round-trip", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgentIn(org);
    const agentId = agent.metadata!.id;

    await expectGrpcCode(
      () => clients.scoringRuleQuery.getByAgent({ agentId }),
      Code.NotFound,
      "an agent with grading off",
    );

    const created = await clients.scoringRuleCommand.create(
      makeScoringRule({ org, agentId, sampleRate: 0.1, monthlyLimitUsd: 10 }),
    );
    expect(created.metadata?.id).toMatch(/^srl_[0-9a-z]{26}$/);
    expect(created.metadata?.org).toBe(org);
    expect(created.spec?.agentId).toBe(agentId);
    expect(created.spec?.enabled).toBe(true);
    expect(created.spec?.sampleRate).toBe(0.1);
    expect(created.spec?.monthlyLimitUsd).toBe(10);
    expect(created.status?.spentUsd ?? 0, "a new month starts with nothing spent").toBe(0);
    expect(created.status?.graded ?? 0).toBe(0);

    const byId = await clients.scoringRuleQuery.get({ value: created.metadata!.id });
    expect(byId.spec?.agentId).toBe(agentId);
    const byAgent = await clients.scoringRuleQuery.getByAgent({ agentId });
    expect(byAgent.metadata?.id).toBe(created.metadata!.id);

    const changed = await clients.scoringRuleCommand.update({ resource: {
      ...byAgent,
      spec: { ...byAgent.spec!, enabled: false, sampleRate: 0.5, modelName: "claude-haiku-4-5" },
    }, updateMask: { paths: ["*"] } });
    expect(changed.spec?.enabled).toBe(false);
    expect(changed.spec?.sampleRate).toBe(0.5);
    expect(changed.spec?.modelName).toBe("claude-haiku-4-5");
    expect(changed.spec?.agentId).toBe(agentId);

    await clients.scoringRuleCommand.delete({ value: created.metadata!.id });
    await expectGrpcCode(
      () => clients.scoringRuleQuery.getByAgent({ agentId }),
      Code.NotFound,
      "grading is off again once the scoring rule is deleted",
    );
  });

  it("[rpc:ScoringRuleCommandController.create] an agent has one scoring rule: a second is ALREADY_EXISTS naming the first", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgentIn(org);
    const first = await clients.scoringRuleCommand.create(makeScoringRule({ org, agentId: agent.metadata!.id }));
    fixtures.defer(() => clients.scoringRuleCommand.delete({ value: first.metadata!.id }).then(() => undefined));

    const again = await expectGrpcCode(
      () => clients.scoringRuleCommand.create(makeScoringRule({ org, agentId: agent.metadata!.id })),
      Code.AlreadyExists,
      "a second scoring rule for the same agent",
    );
    const [info] = again.findDetails(ErrorInfoSchema);
    expect(info?.reason).toBe(SCORING_RULE_EXISTS_REASON);
    expect(info?.metadata["scoring_rule_id"]).toBe(first.metadata!.id);
  });

  it("[rpc:ScoringRuleCommandController.create] [rpc:ScoringRuleCommandController.update] a scoring rule lives with its agent, grades only it, and its rate and limit are bounded", async () => {
    const { org } = await target.provisionTenancy();
    const other = await target.provisionTenancy();
    const agent = await createAgentIn(org);
    const agentId = agent.metadata!.id;

    await expectGrpcCode(
      () => clients.scoringRuleCommand.create(makeScoringRule({ org, agentId: MISSING_AGENT_ID })),
      Code.NotFound,
      "a scoring rule for an agent that does not exist",
    );
    const elsewhere = await expectGrpcCode(
      () => clients.scoringRuleCommand.create(makeScoringRule({ org: other.org, agentId })),
      Code.FailedPrecondition,
      "a scoring rule filed in another organization than its agent's",
    );
    expect(elsewhere.rawMessage).toBe(scoringRuleOrgMismatchMessage(org));
    for (const sampleRate of [0, 1.5]) {
      await expectGrpcCode(
        () => clients.scoringRuleCommand.create(makeScoringRule({ org, agentId, sampleRate })),
        Code.InvalidArgument,
        `a sample rate of ${sampleRate}`,
      );
    }
    await expectGrpcCode(
      () => clients.scoringRuleCommand.create(makeScoringRule({ org, agentId, monthlyLimitUsd: 0 })),
      Code.InvalidArgument,
      "a monthly limit of zero",
    );

    const scoringRule = await clients.scoringRuleCommand.create(makeScoringRule({ org, agentId }));
    fixtures.defer(() => clients.scoringRuleCommand.delete({ value: scoringRule.metadata!.id }).then(() => undefined));
    const another = await createAgentIn(org);
    const moved = await expectGrpcCode(
      () =>
        clients.scoringRuleCommand.update({ resource: {
          ...scoringRule,
          spec: { ...scoringRule.spec!, agentId: another.metadata!.id },
        }, updateMask: { paths: ["*"] } }),
      Code.FailedPrecondition,
      "moving a scoring rule to another agent",
    );
    expect(moved.rawMessage).toBe(SCORING_RULE_AGENT_IMMUTABLE_MESSAGE);
  });

  it("[rpc:ScoringRuleCommandController.create] [rpc:ScoringRuleQueryController.get] deleting the agent deletes its scoring rule", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await clients.agentCommand.create(makeAgent({ org, name: uniqueName("graded") }));
    const scoringRule = await clients.scoringRuleCommand.create(
      makeScoringRule({ org, agentId: agent.metadata!.id }),
    );

    await clients.agentCommand.delete({ value: agent.metadata!.id });

    await expectGrpcCode(
      () => clients.scoringRuleQuery.get({ value: scoringRule.metadata!.id }),
      Code.NotFound,
      "the scoring rule of a deleted agent",
    );
  });

  it("[rpc:ScoringRuleQueryController.getByAgent] [rpc:ScoringRuleCommandController.create] [rpc:ScoringRuleCommandController.update] a member who only sees the agent sees its grading and cannot change it; an outsider sees nothing", async (ctx) => {
    const enforcing = await enforcingLaneOf(target);
    if (enforcing.lane === undefined) return ctx.skip(enforcing.reason);
    const lane = enforcing.lane;
    const tenancy = await lane.provisionTenancy();
    const owner = lane.clients;
    const agent = await owner.agentCommand.create(
      makeAgent({ org: tenancy.org, name: uniqueName("graded") }),
    );
    const agentId = agent.metadata!.id;
    const member = await lane.provisionMember(tenancy);
    const outsider = await lane.provisionIdentity();

    const refused = await expectGrpcCode(
      () => member.scoringRuleCommand.create(makeScoringRule({ org: tenancy.org, agentId })),
      Code.PermissionDenied,
      "a member who cannot edit the agent switching grading on",
    );
    expect(refused.rawMessage).toBe(SCORING_RULE_CREATE_DENIED_MESSAGE);

    const scoringRule = await owner.scoringRuleCommand.create(makeScoringRule({ org: tenancy.org, agentId }));
    const seen = await member.scoringRuleQuery.getByAgent({ agentId });
    expect(seen.metadata?.id).toBe(scoringRule.metadata!.id);
    await expectGrpcCode(
      () =>
        member.scoringRuleCommand.update({ resource: {
          ...seen,
          spec: { ...seen.spec!, monthlyLimitUsd: 1000 },
        }, updateMask: { paths: ["*"] } }),
      Code.PermissionDenied,
      "a member who cannot edit the agent raising its limit",
    );
    await expectGrpcCode(
      () => member.scoringRuleCommand.delete({ value: scoringRule.metadata!.id }),
      Code.PermissionDenied,
      "a member who cannot edit the agent switching grading off",
    );

    await expectGrpcCode(
      () => outsider.scoringRuleQuery.getByAgent({ agentId }),
      Code.PermissionDenied,
      "an outsider reading another organization's grading",
    );

    await owner.agentCommand.delete({ value: agentId });
    await lane.cleanupTenancy(tenancy);
  });
});
