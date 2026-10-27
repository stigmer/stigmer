// What a plan offers, as the console shows it: which plans are offered and
// in what order, what each includes, and the formatting of its terms and
// periods.
//
// A plan's features render from its entitlements through the shared
// vocabulary (../internal/features.ts), never from the plan's stored
// description: a plan row is immutable once seeded, and the description is
// free text that can promise a feature before it is built. The console
// shows only what an organization can use today.

import { create } from "@bufbuild/protobuf";
import type { Timestamp } from "@bufbuild/protobuf/wkt";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { Plan } from "@stigmer/apis/ai/stigmer/billing/plan/v1/api_pb";
import { PlanInstrument, type PlanTerms } from "@stigmer/apis/ai/stigmer/billing/plan/v1/spec_pb";
import { PlanLifecycle } from "@stigmer/apis/ai/stigmer/billing/plan/v1/status_pb";
import { EntitlementsSchema, Feature, type Entitlements } from "@stigmer/apis/ai/stigmer/platform/v1/entitlement_pb";
import { FEATURE_COPY, isNamedFeature, type NamedFeature } from "../internal/features.js";
import { formatPrice } from "./format.js";

// BigInt(0), not a literal: the docs site compiles this source for a
// target below ES2020, which has no BigInt literal syntax.
const ZERO = BigInt(0);

/**
 * Features a plan may list ahead of the gate that serves them, which
 * Stigmer Cloud does not offer yet. The console leaves them out of every
 * comparison. Empty while every listed feature is served; bring-your-own
 * provider keys left it when the proxy began serving an organization's own
 * key (stigmer/stigmer#1425).
 */
export const NOT_YET_OFFERED: ReadonlySet<Feature> = new Set<Feature>();

/** One feature a plan offers today, with its words. */
export interface OfferedFeature {
  readonly feature: NamedFeature;
  readonly label: string;
  readonly description: string;
}

/** The features `entitlements` grant that Cloud offers today, in contract order. */
export function offeredFeatures(entitlements: Entitlements | undefined): readonly OfferedFeature[] {
  const listed = entitlements?.features ?? [];
  return [...new Set(listed)]
    .filter((feature): feature is NamedFeature => isNamedFeature(feature) && !NOT_YET_OFFERED.has(feature))
    .sort((a, b) => a - b)
    .map((feature) => ({ feature, ...FEATURE_COPY[feature] }));
}

/**
 * The plans an organization can subscribe to, cheapest monthly fee first,
 * so a comparison reads upward from Free; equal fees keep the catalog's
 * order. Retired rows and prepaid instruments are left out.
 */
export function buyablePlans(plans: readonly Plan[]): readonly Plan[] {
  return plans
    .filter(
      (plan) =>
        plan.spec?.instrument === PlanInstrument.subscription && plan.status?.lifecycle === PlanLifecycle.active,
    )
    .map((plan, index) => ({ plan, index }))
    .sort((a, b) => compareFees(a.plan, b.plan) || a.index - b.index)
    .map(({ plan }) => plan);
}

/** The cheapest plan that can be bought and includes `feature`, if any. */
export function lowestPlanWith(plans: readonly Plan[], feature: Feature): Plan | undefined {
  return buyablePlans(plans).find((plan) =>
    offeredFeatures(plan.spec?.entitlements).some((offered) => offered.feature === feature),
  );
}

/**
 * Stigmer Cloud's top plan, which is quoted rather than bought, so the
 * catalog never lists it: what it includes beyond Business and on what
 * terms. The console's plan comparison and stigmer.ai's pricing page both
 * render it from here, so the two read alike. Its features are the ones the
 * contract tiers to it, and nothing it does not yet deliver.
 */
export const ENTERPRISE_CLOUD_PLAN: {
  readonly name: string;
  readonly includes: string;
  readonly features: readonly NamedFeature[];
  readonly terms: string;
} = {
  name: "Enterprise Cloud",
  includes: "Everything in Business",
  features: [Feature.access_history],
  terms: "Annual contract, invoiced",
};

/**
 * Stigmer Cloud's Free plan, which every organization is on until it
 * subscribes, so the catalog never lists it: its features, what it offers
 * that is not a feature, and its agent hours and agents at once. The
 * console's plan comparison and stigmer.ai's pricing page both render it
 * from here, so the two read alike. These are the Cloud's Free terms as set
 * on 2026-10-25, kept by hand because Free has no catalog row; a change to
 * them changes this value.
 */
export const FREE_PLAN: {
  readonly name: string;
  readonly entitlements: Entitlements;
  readonly extras: readonly string[];
} = {
  name: "Free",
  entitlements: create(EntitlementsSchema, {
    features: [Feature.channels, Feature.sharing],
    limits: { includedAgentHours: 30, maxActiveSessionSandboxes: 5 },
  }),
  extras: ["Unlimited members"],
};

/**
 * The name of the plan that unlocks `feature`: the cheapest buyable plan
 * that includes it, else Enterprise Cloud when only that plan does. Empty
 * when no plan includes it.
 */
export function unlockingPlanName(plans: readonly Plan[], feature: Feature): string {
  const buyable = lowestPlanWith(plans, feature)?.metadata?.name;
  if (buyable !== undefined && buyable !== "") {
    return buyable;
  }
  return ENTERPRISE_CLOUD_PLAN.features.some((included) => included === feature) ? ENTERPRISE_CLOUD_PLAN.name : "";
}

/** What `from` offers that `to` does not: what a switch stops the organization creating. */
export function featuresLost(from: Plan | undefined, to: Plan): readonly OfferedFeature[] {
  const kept = new Set(offeredFeatures(to.spec?.entitlements).map((offered) => offered.feature));
  return offeredFeatures(from?.spec?.entitlements).filter((offered) => !kept.has(offered.feature));
}

// The fee is the terms' `monthlyMinimumMicros`, a wire name the contract keeps.
function compareFees(a: Plan, b: Plan): number {
  const left = a.spec?.terms?.monthlyMinimumMicros ?? ZERO;
  const right = b.spec?.terms?.monthlyMinimumMicros ?? ZERO;
  return left === right ? 0 : left < right ? -1 : 1;
}

// A count as a price list writes it, e.g. "1,500".
const COUNT = new Intl.NumberFormat("en-US");

/** A plan's monthly fee, e.g. "$99/month". */
export function formatMonthlyFee(terms: PlanTerms | undefined): string {
  return `${formatPrice(terms?.monthlyMinimumMicros ?? ZERO)}/month`;
}

/**
 * A plan's terms beyond its features, one line each, in the order every
 * plan list shows them: its child organizations, its agent hours and how
 * many agents it runs at once. A term the plan does not state is left out.
 */
export function planTermLines(
  entitlements: Entitlements | undefined,
  terms: PlanTerms | undefined,
): readonly string[] {
  return [
    formatChildOrgs(entitlements, terms),
    formatAgentHoursTerms(entitlements, terms),
    formatAgentsAtOnce(entitlements),
  ].filter((line) => line !== "");
}

/** The child organizations a plan includes and what each beyond costs, or empty. */
export function formatChildOrgs(
  entitlements: Entitlements | undefined,
  terms: PlanTerms | undefined,
): string {
  if (!(entitlements?.features ?? []).includes(Feature.child_orgs)) {
    return "";
  }
  const included = entitlements?.limits?.includedChildOrgs;
  const fee = terms?.perExtraOrgMicros ?? ZERO;
  if (included === undefined) {
    return "Unlimited child organizations";
  }
  const beyond = fee > ZERO ? `, then ${formatPrice(fee)}/month each` : "";
  return `${COUNT.format(included)} child organization${included === 1 ? "" : "s"} included${beyond}`;
}

/**
 * The agent hours a plan includes each month and what happens past them,
 * e.g. "1,500 agent hours a month, then $0.40 an hour" or "30 agent hours
 * a month, then new work pauses"; empty when the plan states no allowance,
 * so a plan whose hours are not yet set promises nothing.
 */
export function formatAgentHoursTerms(
  entitlements: Entitlements | undefined,
  terms: PlanTerms | undefined,
): string {
  const included = entitlements?.limits?.includedAgentHours;
  if (included === undefined) {
    return "";
  }
  const hours = `${COUNT.format(included)} agent hour${included === 1 ? "" : "s"} a month`;
  const price = terms?.perAgentHourMicros;
  return price === undefined ? `${hours}, then new work pauses` : `${hours}, then ${formatPrice(price)} an hour`;
}

/**
 * How many agents a plan runs at once, e.g. "25 agents at once"; empty when
 * the plan states no number, so a plan promises only what its row says.
 */
export function formatAgentsAtOnce(entitlements: Entitlements | undefined): string {
  const limit = entitlements?.limits?.maxActiveSessionSandboxes;
  if (limit === undefined) {
    return "";
  }
  return `${COUNT.format(limit)} agent${limit === 1 ? "" : "s"} at once`;
}

/**
 * Working agent time as hours to one decimal, e.g. "31.4 h": the tenth of
 * an hour the invoice bills by, rounded half up.
 */
export function formatAgentHours(seconds: bigint): string {
  const tenths = (seconds + BigInt(180)) / BigInt(360);
  return `${tenths / BigInt(10)}.${tenths % BigInt(10)} h`;
}

const DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/**
 * A period boundary as a UTC calendar day, e.g. "Feb 28, 2027". Periods
 * run anniversary to anniversary in UTC, the rule the invoice follows.
 */
export function formatPeriodDay(timestamp: Timestamp | undefined): string {
  return timestamp === undefined ? "" : formatDay(timestampDate(timestamp));
}

/** An instant as its UTC calendar day, the way {@link formatPeriodDay} shows a period boundary. */
export function formatDay(date: Date): string {
  return DAY.format(date);
}
