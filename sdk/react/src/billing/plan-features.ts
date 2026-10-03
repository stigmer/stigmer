// What a plan offers, as the console shows it: which plans are offered and
// in what order, what each includes, and the formatting of its terms and
// periods.
//
// A plan's features render from its entitlements through the shared
// vocabulary (../internal/features.ts), never from the plan's stored
// description: a plan row is immutable once seeded, and the description is
// free text that can promise a feature before it is built. The console
// shows only what an organization can use today.

import type { Timestamp } from "@bufbuild/protobuf/wkt";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { Plan } from "@stigmer/protos/ai/stigmer/billing/plan/v1/api_pb";
import { PlanInstrument, type PlanTerms } from "@stigmer/protos/ai/stigmer/billing/plan/v1/spec_pb";
import { PlanLifecycle } from "@stigmer/protos/ai/stigmer/billing/plan/v1/status_pb";
import { Feature, type Entitlements } from "@stigmer/protos/ai/stigmer/platform/v1/entitlement_pb";
import { FEATURE_COPY, isNamedFeature, type NamedFeature } from "../internal/features.js";
import { formatCreditBalance } from "./format.js";

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
 * The plans an organization can subscribe to, cheapest monthly minimum
 * first, so a comparison reads upward from Free; equal minimums keep the
 * catalog's order. Retired rows and prepaid instruments are left out.
 */
export function buyablePlans(plans: readonly Plan[]): readonly Plan[] {
  return plans
    .filter(
      (plan) =>
        plan.spec?.instrument === PlanInstrument.subscription && plan.status?.lifecycle === PlanLifecycle.active,
    )
    .map((plan, index) => ({ plan, index }))
    .sort((a, b) => compareMinimums(a.plan, b.plan) || a.index - b.index)
    .map(({ plan }) => plan);
}

/** The cheapest plan that can be bought and includes `feature`, if any. */
export function lowestPlanWith(plans: readonly Plan[], feature: Feature): Plan | undefined {
  return buyablePlans(plans).find((plan) =>
    offeredFeatures(plan.spec?.entitlements).some((offered) => offered.feature === feature),
  );
}

/** What `from` offers that `to` does not: what a switch stops the organization creating. */
export function featuresLost(from: Plan | undefined, to: Plan): readonly OfferedFeature[] {
  const kept = new Set(offeredFeatures(to.spec?.entitlements).map((offered) => offered.feature));
  return offeredFeatures(from?.spec?.entitlements).filter((offered) => !kept.has(offered.feature));
}

function compareMinimums(a: Plan, b: Plan): number {
  const left = a.spec?.terms?.monthlyMinimumMicros ?? ZERO;
  const right = b.spec?.terms?.monthlyMinimumMicros ?? ZERO;
  return left === right ? 0 : left < right ? -1 : 1;
}

/** A plan's monthly minimum, e.g. "$99.00/month". */
export function formatMonthlyMinimum(terms: PlanTerms | undefined): string {
  return `${formatCreditBalance(terms?.monthlyMinimumMicros ?? ZERO)}/month`;
}

/**
 * A plan's usage share as its terms state it, for operators who read terms,
 * e.g. "or 10% of provider cost, whichever is greater; the commission
 * already paid on tokens counts toward it". Empty when the plan has no
 * usage share.
 */
export function formatUsageShare(terms: PlanTerms | undefined): string {
  const percent = sharePercent(terms);
  return percent === ""
    ? ""
    : `or ${percent} of provider cost, whichever is greater; the commission already paid on tokens counts toward it`;
}

/**
 * The same share as a customer reads it: usage stays paid from credits,
 * and the commission on it counts toward the minimum up to the spend at
 * which the plan costs nothing extra, e.g. "Usage is still paid from
 * credits. The 10% commission on it counts toward the minimum, so from
 * $990.00 a month in provider costs the plan costs nothing extra." Empty
 * when the plan has no usage share.
 */
export function explainUsageShare(terms: PlanTerms | undefined): string {
  const percent = sharePercent(terms);
  if (percent === "") {
    return "";
  }
  const basisPoints = BigInt(terms?.usageShareBasisPoints ?? 0);
  // The provider cost whose share equals the minimum: past it, the share is the plan's cost and the commission pays it.
  const breakEven = ((terms?.monthlyMinimumMicros ?? ZERO) * BigInt(10_000)) / basisPoints;
  return (
    `Usage is still paid from credits. The ${percent} commission on it counts toward the minimum, ` +
    `so from ${formatCreditBalance(breakEven)} a month in provider costs the plan costs nothing extra.`
  );
}

/** The usage share as a percentage, e.g. "10%" or "12.50%"; empty when there is none. */
export function sharePercent(terms: PlanTerms | undefined): string {
  const basisPoints = terms?.usageShareBasisPoints ?? 0;
  if (basisPoints === 0) {
    return "";
  }
  return `${basisPoints % 100 === 0 ? `${basisPoints / 100}` : (basisPoints / 100).toFixed(2)}%`;
}

/** The managed organizations a plan includes and what each beyond costs, or empty. */
export function formatManagedOrganizations(
  entitlements: Entitlements | undefined,
  terms: PlanTerms | undefined,
): string {
  if (!(entitlements?.features ?? []).includes(Feature.managed_organizations)) {
    return "";
  }
  const included = entitlements?.limits?.includedManagedOrganizations;
  const fee = terms?.perExtraOrgMicros ?? ZERO;
  if (included === undefined) {
    return "Unlimited managed organizations";
  }
  const beyond = fee > ZERO ? `, then ${formatCreditBalance(fee)}/month each` : "";
  return `${included} managed organization${included === 1 ? "" : "s"} included${beyond}`;
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
