// Billing plans conformance — the plan catalog and an organization's
// subscription, as the wire shows them (Class A; no runner).
// Domain: billing, facet plans.
//
// What this facet pins, where `billingPlans` is TRUE (cloud):
//   - the catalog is readable by any signed-in caller and holds only rows
//     that can be bought, each one immutable terms under a `pln_` id; writing
//     it is a platform operator's act, refused to everyone else with the
//     proto's own copy;
//   - an organization that never subscribed is on Free: getEntitlements
//     answers Free's features with an empty plan id, and getForOrganization
//     and getPeriodEstimate answer NOT_FOUND;
//   - subscribing needs a saved payment method, refused with the engine's
//     copy and the PAYMENT_METHOD_REQUIRED reason before anything is written
//     or charged;
//   - the organization lanes refuse an outsider with the proto's copy.
// Every `it` carries its inventory row id in square brackets
// (`inventory/cloud-capabilities.yaml`; `npm run inventory:check`).
//
// Where `billingPlans` is FALSE (the local OSS targets): Plan and
// Subscription are cloud_only kinds, OSS routes none of the four
// controllers, and every RPC answers Unimplemented — pinned once per RPC.
//
// Deliberately out of scope: the catalog's prices and a paid subscription's
// periods and invoices. The launch rows are the Cloud's configuration, not an
// edition contract, and a period close needs a clock and a card this black
// box does not hold; the Cloud composition's own suites pin both. The plan
// gates on teams and managed organizations belong to the enterprise identity
// lanes, which this suite has no clients for.
import { Code } from "@connectrpc/connect";
import { ErrorInfoSchema } from "@stigmer/protos/google/rpc/error_details_pb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PlanCommandController } from "@stigmer/protos/ai/stigmer/billing/plan/v1/command_pb";
import { PlanQueryController } from "@stigmer/protos/ai/stigmer/billing/plan/v1/query_pb";
import { PlanInstrument } from "@stigmer/protos/ai/stigmer/billing/plan/v1/spec_pb";
import { PlanLifecycle } from "@stigmer/protos/ai/stigmer/billing/plan/v1/status_pb";
import { SubscriptionCommandController } from "@stigmer/protos/ai/stigmer/billing/subscription/v1/command_pb";
import { SubscriptionQueryController } from "@stigmer/protos/ai/stigmer/billing/subscription/v1/query_pb";
import { Feature } from "@stigmer/protos/ai/stigmer/platform/v1/entitlement_pb";
import { FixtureTracker } from "../harness/fixtures";
import type { ConformanceClients } from "../harness/clients";
import { expectGrpcCode } from "../contract/errors";
import { requireCloudFixtures, type CloudFixturesClient } from "../support/cloud-fixtures-client";
import { uniqueName } from "../support/naming";
import { createTarget, type TargetProfile } from "../targets";
import type { TenancyContext } from "../targets/target";

// Collection-time capability read (the billing suite's pattern).
const plansServed = createTarget().capabilities.billingPlans;

let target: TargetProfile;
let clients: ConformanceClients;
let control: CloudFixturesClient;
const fixtures = new FixtureTracker();

beforeAll(async () => {
  target = createTarget();
  await target.setup();
  clients = target.clients();
  if (plansServed) control = requireCloudFixtures();
});

afterEach(async () => {
  await fixtures.cleanup();
});

afterAll(async () => {
  await target?.teardown();
});

// The refusal copy the protos declare (billing/plan/v1/command.proto,
// billing/subscription/v1/command.proto and query.proto).
const COPY = {
  managePlans: "only platform operators can manage plans",
  changePlan: "unauthorized to change this organization's plan",
  viewEntitlements: "unauthorized to view this organization's entitlements",
  viewPeriodEstimate: "unauthorized to view this organization's period estimate",
} as const;

// The engine's own copy, which the console surfaces to the person who can act
// on it: subscribing needs a card on file, and the setup session saves one.
const DOMAIN_COPY = {
  subscribeNeedsPaymentMethod: "A saved payment method is required to subscribe to a plan. Add a payment method first.",
} as const;

// Free has no catalog row: its entitlements are the engine's constant.
const FREE_FEATURES = [Feature.channels, Feature.sharing];

// The loud-failure posture: a billingPlans target without these is a target
// bug, never a skip.
async function unfundedOrg(): Promise<TenancyContext> {
  if (target.provisionUnfundedTenancy === undefined) {
    throw new Error(`target ${target.name} declares billingPlans but provides no provisionUnfundedTenancy()`);
  }
  const context = await target.provisionUnfundedTenancy();
  fixtures.defer(() => target.cleanupTenancy(context));
  return context;
}

async function outsider(): Promise<ConformanceClients> {
  if (target.provisionIdentity === undefined) {
    throw new Error(`target ${target.name} declares billingPlans but provides no provisionIdentity()`);
  }
  return target.provisionIdentity();
}

async function subscriptionPlanId(): Promise<string> {
  const { entries } = await clients.planQuery.list({});
  const plan = entries.find((entry) => entry.spec?.instrument === PlanInstrument.subscription);
  if (plan === undefined) {
    throw new Error("the catalog lists no subscription plan; the Cloud seeds its launch rows at boot");
  }
  return plan.metadata?.id ?? "";
}

describe.skipIf(!plansServed)("Billing plans conformance — the catalog (billingPlans targets)", () => {
  it("[billing.rpc.plan-list.buyable-rows-only] [rpc:PlanQueryController.list] [rpc:PlanQueryController.get] the catalog lists only active plans, each readable by id by any signed-in caller", async () => {
    const { entries } = await clients.planQuery.list({});
    expect(entries.length, "the Cloud seeds its launch rows at boot").toBeGreaterThan(0);
    for (const plan of entries) {
      const id = plan.metadata?.id ?? "";
      expect(id, `plan '${plan.metadata?.slug}' id`).toMatch(/^pln_/);
      expect(plan.metadata?.slug, `plan '${id}' slug`).not.toBe("");
      expect(plan.status?.lifecycle, `plan '${id}' lifecycle`).toBe(PlanLifecycle.active);
      expect(plan.spec?.instrument, `plan '${id}' instrument`).not.toBe(PlanInstrument.plan_instrument_unspecified);
      if (plan.spec?.instrument === PlanInstrument.subscription) {
        expect(plan.spec.terms?.monthlyMinimumMicros, `subscription plan '${id}' names a monthly minimum`).not.toBeUndefined();
      }
    }

    const other = await outsider();
    const first = entries[0]!;
    const read = await other.planQuery.get({ value: first.metadata?.id ?? "" });
    expect(read.metadata?.slug).toBe(first.metadata?.slug);
    expect(read.spec?.entitlements?.features).toEqual(first.spec?.entitlements?.features);
  });

  it("[billing.rpc.plan-create.operator-only] [rpc:PlanCommandController.create] an organization owner cannot write the catalog", async () => {
    const before = await clients.planQuery.list({ includeRetired: true });
    const denied = await expectGrpcCode(
      () =>
        clients.planCommand.create({
          apiVersion: "billing.stigmer.ai/v1",
          kind: "Plan",
          metadata: { name: uniqueName("conformance-plan") },
          spec: {
            instrument: PlanInstrument.subscription,
            entitlements: { features: [Feature.channels] },
            terms: { monthlyMinimumMicros: 1_000_000n },
          },
        }),
      Code.PermissionDenied,
      "owner plan create",
    );
    expect(denied.rawMessage).toBe(COPY.managePlans);
    const after = await clients.planQuery.list({ includeRetired: true });
    expect(after.entries.length, "nothing was written").toBe(before.entries.length);
  });
});

describe.skipIf(!plansServed)("Billing plans conformance — an organization's subscription (billingPlans targets)", () => {
  afterEach(async () => {
    await control.stripe.reset();
  });

  it("[billing.rpc.get-entitlements.free-by-default] [rpc:SubscriptionQueryController.getEntitlements] [rpc:SubscriptionQueryController.getForOrganization] an organization that never subscribed is on Free", async () => {
    const { org } = await unfundedOrg();
    const answer = await clients.subscriptionQuery.getEntitlements({ orgId: org });
    expect(answer.planId).toBe("");
    expect(answer.entitlements?.features).toEqual(FREE_FEATURES);
    await expectGrpcCode(
      () => clients.subscriptionQuery.getForOrganization({ orgId: org }),
      Code.NotFound,
      "getForOrganization on Free",
    );
  });

  it("[billing.rpc.get-period-estimate.not-found-on-free] [rpc:SubscriptionQueryController.getPeriodEstimate] an organization on Free has no period to estimate", async () => {
    const { org } = await unfundedOrg();
    await expectGrpcCode(
      () => clients.subscriptionQuery.getPeriodEstimate({ orgId: org }),
      Code.NotFound,
      "getPeriodEstimate on Free",
    );
  });

  it("[billing.rpc.change-plan.requires-payment-method] [rpc:SubscriptionCommandController.changePlan] subscribing without a saved card is refused before anything is written or charged", async () => {
    const { org } = await unfundedOrg();
    const planId = await subscriptionPlanId();
    const refused = await expectGrpcCode(
      () => clients.subscriptionCommand.changePlan({ orgId: org, planId }),
      Code.FailedPrecondition,
      "changePlan without a card",
    );
    expect(refused.rawMessage).toBe(DOMAIN_COPY.subscribeNeedsPaymentMethod);
    const [reason] = refused.findDetails(ErrorInfoSchema);
    expect(reason?.reason, "the refusal names its fix").toBe("PAYMENT_METHOD_REQUIRED");
    expect(reason?.domain).toBe("stigmer.ai");
    expect(reason?.metadata).toEqual({ org_id: org });
    await expectGrpcCode(
      () => clients.subscriptionQuery.getForOrganization({ orgId: org }),
      Code.NotFound,
      "no subscription after the refusal",
    );
    const answer = await clients.subscriptionQuery.getEntitlements({ orgId: org });
    expect(answer.planId, "still on Free").toBe("");
    expect(await control.stripe.requests(), "nothing reached Stripe").toEqual([]);
  });

  it("[billing.rpc.subscription.outsider-permission-denied] [rpc:SubscriptionCommandController.changePlan] [rpc:SubscriptionQueryController.getEntitlements] [rpc:SubscriptionQueryController.getPeriodEstimate] an outsider can neither change an organization's plan nor read its entitlements or period estimate", async () => {
    const { org } = await unfundedOrg();
    const planId = await subscriptionPlanId();
    const other = await outsider();
    const change = await expectGrpcCode(
      () => other.subscriptionCommand.changePlan({ orgId: org, planId }),
      Code.PermissionDenied,
      "outsider changePlan",
    );
    expect(change.rawMessage).toBe(COPY.changePlan);
    const read = await expectGrpcCode(
      () => other.subscriptionQuery.getEntitlements({ orgId: org }),
      Code.PermissionDenied,
      "outsider getEntitlements",
    );
    expect(read.rawMessage).toBe(COPY.viewEntitlements);
    const estimate = await expectGrpcCode(
      () => other.subscriptionQuery.getPeriodEstimate({ orgId: org }),
      Code.PermissionDenied,
      "outsider getPeriodEstimate",
    );
    expect(estimate.rawMessage).toBe(COPY.viewPeriodEstimate);
  });
});

describe.skipIf(plansServed)("Billing plans conformance — the OSS boundary (no plan or subscription controllers routed)", () => {
  it("[billing.rpc.oss-boundary.every-plan-rpc-unimplemented] [rpc:PlanCommandController.create] [rpc:PlanCommandController.retire] [rpc:PlanQueryController.get] [rpc:PlanQueryController.list] [rpc:SubscriptionCommandController.changePlan] [rpc:SubscriptionCommandController.cancel] [rpc:SubscriptionQueryController.getForOrganization] [rpc:SubscriptionQueryController.getEntitlements] [rpc:SubscriptionQueryController.getPeriodEstimate] every Plan and Subscription RPC answers Unimplemented where billingPlans is false", async () => {
    const org = "conformance-oss-boundary";
    const lanes: ReadonlyArray<readonly [string, () => Promise<unknown>]> = [
      ["Plan.create", () => clients.planCommand.create({})],
      ["Plan.retire", () => clients.planCommand.retire({ value: "pln_x" })],
      ["Plan.get", () => clients.planQuery.get({ value: "pln_x" })],
      ["Plan.list", () => clients.planQuery.list({})],
      ["Subscription.changePlan", () => clients.subscriptionCommand.changePlan({ orgId: org, planId: "pln_x" })],
      ["Subscription.cancel", () => clients.subscriptionCommand.cancel({ orgId: org })],
      ["Subscription.getForOrganization", () => clients.subscriptionQuery.getForOrganization({ orgId: org })],
      ["Subscription.getEntitlements", () => clients.subscriptionQuery.getEntitlements({ orgId: org })],
      ["Subscription.getPeriodEstimate", () => clients.subscriptionQuery.getPeriodEstimate({ orgId: org })],
    ];
    // Every method the four controllers declare, so a new RPC on the contract
    // fails here until its boundary is pinned.
    const declared = [PlanCommandController, PlanQueryController, SubscriptionCommandController, SubscriptionQueryController]
      .reduce((count, service) => count + service.methods.length, 0);
    expect(lanes, "one lane per declared RPC").toHaveLength(declared);
    for (const [name, op] of lanes) {
      await expectGrpcCode(op, Code.Unimplemented, `OSS ${name}`);
    }
  });
});
