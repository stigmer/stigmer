// Display vocabulary for the licenses surface: the term and feature labels,
// the entitlement summary, and the one way a license date is shown.
//
// Every license date renders as a UTC calendar day. A license is a global
// instrument whose customer may be anywhere, and the issue form derives the
// license's name ("... until 2027-10-23") in UTC; a local-time rendering
// would disagree with that name by a day for half the world.
//
// "Covered through" is the last day a license covers, not the instant it
// expires. The issue form sets `expires_at` to 00:00 UTC on the day after
// the chosen last day, so the expiry instant's own date reads one day late;
// `coveredThroughDay` steps back one millisecond before taking the date.
// A license issued with a mid-day expiry (the SDK allows any instant) still
// reads correctly: its last covered day is the day the instant falls on.

import type { Timestamp } from "@bufbuild/protobuf/wkt";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import {
  Feature,
  type Entitlements,
} from "@stigmer/protos/ai/stigmer/platform/v1/entitlement_pb";
import { LicenseTerm } from "@stigmer/protos/ai/stigmer/platform/v1/license_pb";

/** A term an operator can issue; the unspecified zero value is not one. */
export type IssuableTerm = LicenseTerm.trial | LicenseTerm.paid;

/** A feature an operator can grant; the unspecified zero value is not one. */
export type GrantableFeature = Exclude<Feature, Feature.feature_unspecified>;

/** Display labels for the issuable terms. */
export const TERM_LABELS: Readonly<Record<IssuableTerm, string>> = {
  [LicenseTerm.trial]: "Trial",
  [LicenseTerm.paid]: "Paid",
};

/**
 * Label and one-line explanation per grantable feature. Keyed by every
 * non-zero `Feature` value, so a feature added to the contract fails to
 * compile here until it has words an operator can read.
 */
export const FEATURE_LABELS: Readonly<
  Record<GrantableFeature, { readonly label: string; readonly description: string }>
> = {
  [Feature.sso_enforcement]: {
    label: "SSO enforcement",
    description: "Require members to sign in through a registered identity provider.",
  },
  [Feature.platform_client]: {
    label: "Platform clients",
    description: "Let the customer's own product mint Stigmer tokens for its users.",
  },
  [Feature.byo_provider_keys]: {
    label: "Bring your own provider keys",
    description: "Use the customer's own LLM provider keys instead of the metered proxy.",
  },
  [Feature.channels]: {
    label: "Channels",
    description: "Deliver agents over messaging channels through a channel runtime.",
  },
  [Feature.sharing]: {
    label: "Sharing",
    description: "Share agents with individuals and guests through hosted links.",
  },
};

/** Every grantable feature, in contract order (derived from the label map). */
export const GRANTABLE_FEATURES: readonly GrantableFeature[] = (
  Object.keys(FEATURE_LABELS).map(Number) as GrantableFeature[]
).sort((a, b) => a - b);

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * English on purpose: the phrase sits inside English copy on every surface
 * of the console, and a locale-dependent fragment ("dans 29 jours") inside
 * an English sentence reads worse than a consistent sentence.
 */
const RELATIVE = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

/** A term's display label, tolerating a value outside the issuable pair. */
export function termLabel(term: LicenseTerm): string {
  return term === LicenseTerm.trial || term === LicenseTerm.paid
    ? TERM_LABELS[term]
    : "Unknown term";
}

/** A proto Timestamp as a Date, or `undefined` when the field is unset. */
export function toDate(ts: Timestamp | undefined): Date | undefined {
  return ts ? timestampDate(ts) : undefined;
}

/** The UTC calendar day of an instant, as `YYYY-MM-DD`. */
export function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** The last UTC day a license covers, given the instant it expires. */
export function coveredThroughDay(expiresAt: Date): string {
  return utcDay(new Date(expiresAt.getTime() - 1));
}

/** Milliseconds since the epoch at 00:00 UTC of a `YYYY-MM-DD` day. */
export function dayStartUtc(day: string): number {
  return Date.parse(`${day}T00:00:00Z`);
}

/** An instant as `YYYY-MM-DD HH:MM UTC`, for tooltips and detail rows. */
export function formatInstantUtc(date: Date): string {
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/**
 * How far a UTC day is from today, in words: "today", "tomorrow",
 * "in 29 days", "3 days ago", then months once days stop being how
 * people think about it ("in 12 months").
 */
export function formatDayFromToday(day: string, now: Date): string {
  const days = Math.round((dayStartUtc(day) - dayStartUtc(utcDay(now))) / DAY_MS);
  if (Math.abs(days) < 60) return RELATIVE.format(days, "day");
  return RELATIVE.format(Math.round(days / 30.44), "month");
}

/**
 * What a license permits, in the parts the calendar's column shows:
 * "5 users", "1 organization", "1 feature" (the form's and the detail's
 * word, so one limit has one name). An absent limit is unlimited, per the
 * contract, and the part says so rather than leaving it blank. Kept as
 * parts so the calendar can stack them one per line.
 */
export function entitlementParts(entitlements: Entitlements | undefined): readonly string[] {
  const limits = entitlements?.limits;
  const features = entitlements?.features.length ?? 0;
  return [
    limitPart(limits?.maxUsers, "user"),
    limitPart(limits?.maxOrganizations, "organization"),
    features === 0 ? "No features" : plural(features, "feature"),
  ];
}

/** One limit in words: "5 users", "1 organization", "Unlimited users". */
export function limitPart(limit: number | undefined, noun: string): string {
  return limit === undefined ? `Unlimited ${noun}s` : plural(limit, noun);
}

/** The granted features by name, in contract order: "SSO enforcement, Channels". */
export function featureNames(features: readonly number[]): string {
  const names = GRANTABLE_FEATURES.filter((f) => features.includes(f)).map((f) => FEATURE_LABELS[f].label);
  return names.length === 0 ? "No features" : names.join(", ");
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
