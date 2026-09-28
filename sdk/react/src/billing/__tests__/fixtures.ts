// Plan and subscription fixtures for the plan surface's suites: the
// launch catalog's shape (Team, Business with five managed organizations,
// a retired row), a subscription in any state, an estimate, and a Stigmer
// Cloud refusal carrying its ErrorInfo reason the way the SDK surfaces it.

import { create, type MessageInitShape } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError } from "@connectrpc/connect";
import { StigmerError } from "@stigmer/sdk";
import { PlanSchema, type Plan } from "@stigmer/protos/ai/stigmer/billing/plan/v1/api_pb";
import { PlanInstrument, PlanSpecSchema, PlanTermsSchema } from "@stigmer/protos/ai/stigmer/billing/plan/v1/spec_pb";
import { PlanLifecycle } from "@stigmer/protos/ai/stigmer/billing/plan/v1/status_pb";
import { SubscriptionSchema, type Subscription } from "@stigmer/protos/ai/stigmer/billing/subscription/v1/api_pb";
import {
  PeriodEstimateLineKind,
  PeriodEstimateSchema,
  type PeriodEstimate,
} from "@stigmer/protos/ai/stigmer/billing/subscription/v1/io_pb";
import { SubscriptionState } from "@stigmer/protos/ai/stigmer/billing/subscription/v1/status_pb";
import { EntitlementsSchema, Feature } from "@stigmer/protos/ai/stigmer/platform/v1/entitlement_pb";
import { ErrorInfoSchema } from "@stigmer/protos/google/rpc/error_details_pb";

export const USD = 1_000_000n;
export const PERIOD_START = new Date("2027-01-31T10:00:00Z");
export const PERIOD_END = new Date("2027-02-28T10:00:00Z");
export const NOW = new Date("2027-02-10T00:00:00Z");

/** What a fixture plan may override on the launch shape. */
interface PlanOverrides {
  readonly description?: string;
  readonly entitlements?: MessageInitShape<typeof EntitlementsSchema>;
  readonly terms?: MessageInitShape<typeof PlanTermsSchema>;
}

function plan(
  id: string,
  name: string,
  minimum: bigint,
  extra: PlanOverrides = {},
  retired = false,
): Plan {
  return create(PlanSchema, {
    metadata: { id, name, slug: name.toLowerCase() },
    spec: create(PlanSpecSchema, {
      instrument: PlanInstrument.subscription,
      entitlements: extra.entitlements ?? { features: [Feature.channels, Feature.sharing, Feature.teams] },
      terms: extra.terms ?? { monthlyMinimumMicros: minimum * USD, usageShareBasisPoints: 1_000 },
      description: extra.description ?? "",
    }),
    status: { lifecycle: retired ? PlanLifecycle.retired : PlanLifecycle.active },
  });
}

export const TEAM = plan("pln_team", "Team", 99n);
export const BUSINESS = plan("pln_business", "Business", 499n, {
  description: "Everything in Team, with your own provider keys, managed organizations for your customers.",
  entitlements: {
    features: [Feature.byo_provider_keys, Feature.channels, Feature.sharing, Feature.teams, Feature.managed_organizations],
    limits: { includedManagedOrganizations: 5 },
  },
  terms: { monthlyMinimumMicros: 499n * USD, usageShareBasisPoints: 1_000, perExtraOrganizationMicros: 25n * USD },
});
export const RETIRED = plan("pln_team_2026", "Team 2026", 79n, {}, true);

export function subscription(state: SubscriptionState, planId = "pln_team"): Subscription {
  return create(SubscriptionSchema, {
    spec: { planId },
    status: {
      state,
      currentPeriodStart: timestampFromDate(PERIOD_START),
      currentPeriodEnd: timestampFromDate(PERIOD_END),
    },
  });
}

export const TEAM_ESTIMATE: PeriodEstimate = create(PeriodEstimateSchema, {
  planId: "pln_team",
  periodStart: timestampFromDate(PERIOD_START),
  periodEnd: timestampFromDate(PERIOD_END),
  providerCostMicros: 80n * USD,
  commissionCollectedMicros: 8n * USD,
  lines: [
    { kind: PeriodEstimateLineKind.plan, amountMicros: 99n * USD },
    { kind: PeriodEstimateLineKind.commission_credit, amountMicros: -8n * USD },
  ],
  totalMicros: 91n * USD,
});

/** A Stigmer Cloud refusal with its ErrorInfo reason, as the SDK throws it. */
export function refusal(message: string, reason: string, metadata: Record<string, string>): StigmerError {
  const connect = new ConnectError(message, Code.FailedPrecondition, undefined, [
    { desc: ErrorInfoSchema, value: { domain: "stigmer.ai", reason, metadata } },
  ]);
  return new StigmerError("failed-precondition", message, Code.FailedPrecondition, { cause: connect });
}

export function notFound(): StigmerError {
  return new StigmerError("not-found", "Subscription not found: acme", Code.NotFound);
}
