// What a plan offers, as the console shows it, and the formatting of its
// terms and periods.
//
// A plan's features render from its entitlements through the shared
// vocabulary (../internal/features.ts), never from the plan's stored
// description: a plan row is immutable once seeded, and the description is
// free text that can promise a feature before it is built. The console
// shows only what an organization can use today.

import type { Timestamp } from "@bufbuild/protobuf/wkt";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { PlanTerms } from "@stigmer/protos/ai/stigmer/billing/plan/v1/spec_pb";
import { Feature, type Entitlements } from "@stigmer/protos/ai/stigmer/platform/v1/entitlement_pb";
import { FEATURE_COPY, isNamedFeature, type NamedFeature } from "../internal/features.js";
import { formatCreditBalance } from "./format.js";

// BigInt(0), not a literal: the docs site compiles this source for a
// target below ES2020, which has no BigInt literal syntax.
const ZERO = BigInt(0);

/**
 * Features a plan may list ahead of the gate that serves them, which
 * Stigmer Cloud does not offer yet. The console leaves them out of every
 * comparison. Bring-your-own provider keys leaves this set when the proxy
 * uses an organization's own key.
 */
export const NOT_YET_OFFERED: ReadonlySet<Feature> = new Set([Feature.byo_provider_keys]);

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

/** A plan's monthly minimum, e.g. "$99.00/month". */
export function formatMonthlyMinimum(terms: PlanTerms | undefined): string {
  return `${formatCreditBalance(terms?.monthlyMinimumMicros ?? ZERO)}/month`;
}

/**
 * How a plan's price reads beside its minimum: the usage share and the
 * commission rule, e.g. "or 10% of provider cost, whichever is greater;
 * the commission already paid on tokens counts toward it". Empty when the
 * plan has no usage share.
 */
export function formatUsageShare(terms: PlanTerms | undefined): string {
  const basisPoints = terms?.usageShareBasisPoints ?? 0;
  if (basisPoints === 0) {
    return "";
  }
  const percent = basisPoints % 100 === 0 ? `${basisPoints / 100}` : (basisPoints / 100).toFixed(2);
  return `or ${percent}% of provider cost, whichever is greater; the commission already paid on tokens counts toward it`;
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
  const fee = terms?.perExtraOrganizationMicros ?? ZERO;
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
