// Pure issue-form arithmetic: the form's draft becomes the SDK's
// `LicenseInput`, and nothing else in the surface builds one.
//
// The rules a license must satisfy are the contract's, and the form checks
// them by validating `buildLicenseProto(toLicenseInput(draft))`, the exact
// message `create` sends. This module owns only what the contract cannot
// say: the derived name, the calendar arithmetic, the term presets, the
// parse of free-text numbers, and the id a new customer is minted with.
//
// Dates are UTC calendar days (`YYYY-MM-DD`) end to end. The operator picks
// the last day a license covers; `expires_at` is 00:00 UTC on the day after,
// so a license "until 2027-10-23" covers all of 23 October everywhere on
// Earth that has reached it. The arithmetic goes through `Date.UTC` and ISO
// strings only and never reads the host's time zone.

import type { EntitlementLimitsInput, LicenseCustomerInput, LicenseInput } from "@stigmer/sdk";
import { LicenseTerm } from "@stigmer/protos/ai/stigmer/platform/v1/license_pb";
import type { License } from "@stigmer/protos/ai/stigmer/billing/license/v1/api_pb";
import {
  TERM_LABELS,
  coveredThroughDay,
  dayStartUtc,
  toDate,
  utcDay,
  type GrantableFeature,
  type IssuableTerm,
} from "./license-format.js";

/**
 * How long each term runs when the operator takes the preset: a 30-day
 * evaluation, a yearly paid license.
 */
const TERM_LENGTH: Readonly<Record<IssuableTerm, { readonly days?: number; readonly years?: number }>> = {
  [LicenseTerm.trial]: { days: 30 },
  [LicenseTerm.paid]: { years: 1 },
};

/**
 * The grace period a new license gets unless the operator changes it: none
 * for a trial (an evaluation ends when it ends), 30 days for paid (time for
 * a renewal's paperwork to land without the customer's server degrading).
 */
export const DEFAULT_GRACE_DAYS: Readonly<Record<IssuableTerm, number>> = {
  [LicenseTerm.trial]: 0,
  [LicenseTerm.paid]: 30,
};

/** The longest grace an operator can type; ten years is a typo, not a term. */
export const MAX_GRACE_DAYS = 3650;

/** The largest value an `int32` limit can carry on the wire. */
const MAX_INT32 = 2_147_483_647;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The validated values of the issue form, ready to become a `LicenseInput`. */
export interface LicenseDraft {
  /** The customer, existing (its minted id reused) or new (a fresh id). */
  readonly customer: LicenseCustomerInput;
  readonly term: IssuableTerm;
  /** The last UTC day the license covers, `YYYY-MM-DD`. */
  readonly lastCoveredDay: string;
  /** Days after expiry the licensed server keeps serving. */
  readonly graceDays: number;
  /** `undefined` means unlimited, as the contract reads an absent limit. */
  readonly maxUsers: number | undefined;
  /** `undefined` means unlimited, as the contract reads an absent limit. */
  readonly maxOrganizations: number | undefined;
  readonly features: readonly GrantableFeature[];
  /** Operator notes; never signed, never shown to the customer. */
  readonly notes: string;
}

/** The outcome of reading a free-text form field. */
export type Parsed<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string };

/**
 * The license's name, derived rather than typed: "Paid license for Acme
 * Corp until 2027-10-23". It leads with the term so the server-derived slug
 * always starts with a letter (a customer named "3M" or written in a
 * non-Latin script still yields a valid slug), and because slugs are unique
 * across licenses, issuing the same license twice is refused by the server
 * instead of recorded twice.
 */
export function licenseName(term: IssuableTerm, customerName: string, lastCoveredDay: string): string {
  return `${TERM_LABELS[term]} license for ${collapse(customerName)} until ${lastCoveredDay}`;
}

/**
 * The first day a new license's term counts from: today, or, when the
 * license renews another, the day after the renewed license's last covered
 * day if that is later. A renewal issued early therefore continues the
 * coverage instead of overlapping it.
 */
export function coverageStartDay(now: Date, renewing?: License): string {
  const today = utcDay(now);
  const renewedExpiry = toDate(renewing?.spec?.expiresAt);
  if (!renewedExpiry) return today;
  const continuation = addDays(coveredThroughDay(renewedExpiry), 1);
  return continuation > today ? continuation : today;
}

/** The last covered day a term's preset gives for a term starting `startDay`. */
export function presetLastCoveredDay(term: IssuableTerm, startDay: string): string {
  const { days, years } = TERM_LENGTH[term];
  const end = years ? addYears(startDay, years) : addDays(startDay, days ?? 0);
  return addDays(end, -1);
}

/** Whether a `YYYY-MM-DD` day is before today (UTC). */
export function isPastDay(day: string, now: Date): boolean {
  return day < utcDay(now);
}

/** A limit field: empty is unlimited; otherwise a whole number. */
export function parseLimit(text: string): Parsed<number | undefined> {
  const trimmed = text.trim();
  if (trimmed === "") return { ok: true, value: undefined };
  const value = Number(trimmed);
  if (!Number.isInteger(value) || value > MAX_INT32) {
    return { ok: false, error: "Enter a whole number, or leave it empty for unlimited." };
  }
  return { ok: true, value };
}

/** The grace field: a whole number of days from 0 to {@link MAX_GRACE_DAYS}. */
export function parseGraceDays(text: string): Parsed<number> {
  const value = Number(text.trim());
  if (text.trim() === "" || !Number.isInteger(value) || value < 0 || value > MAX_GRACE_DAYS) {
    return { ok: false, error: `Enter a whole number of days from 0 to ${MAX_GRACE_DAYS}.` };
  }
  return { ok: true, value };
}

/** The whole days of grace a license was issued with. */
export function graceDaysOf(license: License): number {
  const expiresAt = toDate(license.spec?.expiresAt);
  const graceUntil = toDate(license.spec?.graceUntil);
  if (!expiresAt || !graceUntil) return 0;
  return Math.max(0, Math.round((graceUntil.getTime() - expiresAt.getTime()) / DAY_MS));
}

/** The draft as the SDK input `create` takes. */
export function toLicenseInput(draft: LicenseDraft): LicenseInput {
  const expiresAt = new Date(dayStartUtc(addDays(draft.lastCoveredDay, 1)));
  const graceUntil = new Date(expiresAt.getTime() + draft.graceDays * DAY_MS);
  const limits: EntitlementLimitsInput = {
    ...(draft.maxUsers !== undefined && { maxUsers: draft.maxUsers }),
    ...(draft.maxOrganizations !== undefined && { maxOrganizations: draft.maxOrganizations }),
  };
  const organization = draft.customer.organization?.trim();
  const notes = draft.notes.trim();

  return {
    name: licenseName(draft.term, draft.customer.displayName, draft.lastCoveredDay),
    // A License has no organization and its metadata.org must be empty; the
    // generated input still requires the field (stigmer/stigmer#1222).
    org: "",
    customer: {
      id: draft.customer.id,
      displayName: collapse(draft.customer.displayName),
      contactEmail: draft.customer.contactEmail.trim(),
      ...(organization ? { organization } : {}),
    },
    entitlements: {
      ...(Object.keys(limits).length > 0 && { limits }),
      features: [...draft.features],
    },
    term: draft.term,
    expiresAt,
    graceUntil,
    ...(notes !== "" && { notes }),
  };
}

const CROCKFORD = "0123456789abcdefghjkmnpqrstvwxyz";

/**
 * A new customer id, `cus_` and a lowercase ULID: 48 bits of millisecond
 * time and 80 random bits in Crockford base32, the shape the server mints
 * every other id in. The time prefix keeps customer ids sortable by when
 * they were first issued to. Both inputs are injectable for tests.
 */
export function mintCustomerId(
  nowMs: number = Date.now(),
  fillRandom: (bytes: Uint8Array) => void = (bytes) => {
    globalThis.crypto.getRandomValues(bytes);
  },
): string {
  let time = "";
  let remaining = nowMs;
  for (let i = 0; i < 10; i += 1) {
    time = CROCKFORD.charAt(remaining % 32) + time;
    remaining = Math.floor(remaining / 32);
  }

  const bytes = new Uint8Array(10);
  fillRandom(bytes);
  let random = "";
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      random += CROCKFORD.charAt((buffer >>> (bits - 5)) & 31);
      bits -= 5;
    }
    buffer &= (1 << bits) - 1;
  }
  return `cus_${time}${random}`;
}

function addDays(day: string, days: number): string {
  return utcDay(new Date(dayStartUtc(day) + days * DAY_MS));
}

function addYears(day: string, years: number): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return utcDay(new Date(Date.UTC(y + years, m - 1, d)));
}

function collapse(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}
