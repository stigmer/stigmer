// Conformance suite for the journey from a first agent to its users: an
// organization's own steps (OrganizationQueryController.getOnboarding) and
// the platform operator's count over every new organization
// (PlatformQueryController.getOnboardingFunnel).
// Domain: tenancy / organization, platform.
//
// The contract pinned here, on every edition:
//   - getOnboarding answers the six steps in the journey's order (describe,
//     key, watch, make_yours, in_app, others), each with whether it is done;
//     an organization with an agent has `describe` done. Which later steps
//     tick depends on runs, keys and people a server-side unit test holds
//     over one seeded world (backend/services/stigmer-server/src/domain/
//     onboarding/__tests__/onboarding.test.ts); the React kit's card reads
//     this answer.
//   - Who may ask, on the enforcing lane: an admin of the organization
//     (its owner here), never a plain member or an outsider, refused
//     PermissionDenied with the annotation's copy.
//   - getOnboardingFunnel answers six counts in the same order, an
//     organization count and an excluded count, none negative, and no step
//     reached by more organizations than were counted; it refuses a window
//     with no bounds (InvalidArgument), and an organization's owner, who is
//     no platform operator, PermissionDenied with the annotation's copy.
//     The answer itself needs an operator caller: the privileged scope,
//     absent on a deployed endpoint by design, so that case skips there.
//
// Deliberately out of scope: the counts' values (other suites' organizations
// share a target), and the day-later ask and the release walk, which are not
// this server's.
import { Code } from "@connectrpc/connect";
import { OnboardingStepId } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/onboarding_pb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { expectGrpcCode } from "../contract/errors";
import type { ConformanceClients } from "../harness/clients";
import { makeAgent } from "../support/agents";
import { uniqueName } from "../support/naming";
import { createTarget, enforcingLaneOf, type EnforcingLane, type TargetProfile } from "../targets";

const STEP_ORDER = [
  OnboardingStepId.describe,
  OnboardingStepId.key,
  OnboardingStepId.watch,
  OnboardingStepId.make_yours,
  OnboardingStepId.in_app,
  OnboardingStepId.others,
];

// Read at collection time: a deployed endpoint carries no operator credential
// by design, so the operator's answer reports SKIPPED there.
const hasPrivilegedScope = createTarget().provisionPrivilegedScope !== undefined;

let target: TargetProfile;
let clients: ConformanceClients;
let enforcing: Awaited<ReturnType<typeof enforcingLaneOf>>;

beforeAll(async () => {
  target = createTarget();
  await target.setup();
  clients = target.clients();
  enforcing = await enforcingLaneOf(target);
});

afterAll(async () => {
  await target?.teardown();
});

function laneOrSkip(ctx: { skip: (note?: string) => never }): EnforcingLane {
  if (enforcing.lane === undefined) ctx.skip(enforcing.reason);
  return enforcing.lane;
}

describe("Onboarding conformance — an organization's own steps", () => {
  it("[rpc:OrganizationQueryController.getOnboarding] answers the six steps in the journey's order, describe done once an agent exists", async () => {
    const { org } = await target.provisionTenancy();
    await clients.agentCommand.create(makeAgent({ org, name: uniqueName("onboarding-agent") }));

    const answer = await clients.organizationQuery.getOnboarding({ value: org });
    expect(answer.steps.map((step) => step.id), "every step, in the journey's order").toEqual(STEP_ORDER);
    expect(answer.steps[0]?.done, "an organization with an agent has said what it should do").toBe(true);
    expect(answer.joinedCount, "joined counts the names it carries, and at most two are carried").toBeGreaterThanOrEqual(
      answer.joinedNames.length,
    );
    expect(answer.joinedNames.length).toBeLessThanOrEqual(2);
  });

  it("[rpc:OrganizationQueryController.getOnboarding] refuses a request naming no organization (InvalidArgument)", async () => {
    await expectGrpcCode(
      () => clients.organizationQuery.getOnboarding({ value: "" }),
      Code.InvalidArgument,
      "getOnboarding with no organization",
    );
  });

  it("[rpc:OrganizationQueryController.getOnboarding] answers the organization's owner, and refuses a member and an outsider (PermissionDenied, with the annotation copy)", async (ctx) => {
    const lane = laneOrSkip(ctx);
    const tenancy = await lane.provisionTenancy();
    const owner = await lane.provisionWithRole(tenancy, "owner");
    const member = await lane.provisionMember(tenancy);
    const outsider = await lane.provisionIdentity();

    const answer = await owner.organizationQuery.getOnboarding({ value: tenancy.org });
    expect(answer.steps.map((step) => step.id)).toEqual(STEP_ORDER);
    for (const [who, caller] of [
      ["a member", member],
      ["an outsider", outsider],
    ] as const) {
      const denied = await expectGrpcCode(
        () => caller.organizationQuery.getOnboarding({ value: tenancy.org }),
        Code.PermissionDenied,
        `${who} asking for the organization's onboarding`,
      );
      expect(denied.rawMessage).toBe("unauthorized to read this organization's onboarding");
    }
  });
});

describe("Onboarding conformance — the platform operator's count", () => {
  it.skipIf(!hasPrivilegedScope)(
    "[rpc:PlatformQueryController.getOnboardingFunnel] answers six counts in the journey's order, none above the organizations counted",
    async () => {
      const scope = await target.provisionPrivilegedScope!();
      try {
        const today = new Date().toISOString().slice(0, 10);
        const funnel = await scope.clients.platformQuery.getOnboardingFunnel({ fromDate: "2026-01-01", toDate: today });
        expect(funnel.steps.map((step) => step.id), "every step, in the journey's order").toEqual(STEP_ORDER);
        expect(funnel.organizations).toBeGreaterThanOrEqual(0);
        expect(funnel.excluded).toBeGreaterThanOrEqual(0);
        for (const step of funnel.steps) {
          expect(step.reached, `${OnboardingStepId[step.id]} is reached by a count of organizations`).toBeGreaterThanOrEqual(0);
          expect(step.reached, `${OnboardingStepId[step.id]} is reached by no more than were counted`).toBeLessThanOrEqual(
            funnel.organizations,
          );
        }
      } finally {
        await scope.cleanup();
      }
    },
  );

  it("[rpc:PlatformQueryController.getOnboardingFunnel] refuses an organization's owner, who is no platform operator (PermissionDenied, with the annotation copy)", async (ctx) => {
    const lane = laneOrSkip(ctx);
    const tenancy = await lane.provisionTenancy();
    const owner = await lane.provisionWithRole(tenancy, "owner");

    const denied = await expectGrpcCode(
      () => owner.platformQuery.getOnboardingFunnel({ fromDate: "2026-11-01", toDate: "2026-11-07" }),
      Code.PermissionDenied,
      "an organization owner asking for the platform's onboarding count",
    );
    expect(denied.rawMessage).toBe("only platform operators can read onboarding counts");
  });

  it.skipIf(!hasPrivilegedScope)("[rpc:PlatformQueryController.getOnboardingFunnel] refuses a window with no bounds (InvalidArgument)", async () => {
    const scope = await target.provisionPrivilegedScope!();
    try {
      await expectGrpcCode(
        () => scope.clients.platformQuery.getOnboardingFunnel({ fromDate: "", toDate: "" }),
        Code.InvalidArgument,
        "getOnboardingFunnel with no window",
      );
    } finally {
      await scope.cleanup();
    }
  });
});
