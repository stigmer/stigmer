// Pure license-standing derivation: the renewal calendar's vocabulary,
// computed on read from the signed dates and an injected clock.
//
// A license's standing is two independent facts:
//
//   - The time state, in the contract's own `LicenseState` words (valid,
//     expiring, grace, expired). This is the same question an Enterprise
//     server answers about the ticket it holds, asked here from the
//     issuing side, so the operator and the licensed server speak one
//     language. `absent` and `invalid` describe a server's configuration
//     and never apply to an issued license.
//   - The renewal fact: a later license for the same customer covers past
//     this one's expiry. A renewed license needs no action even while its
//     own term runs, so the badge says "Renewed" and the calendar mutes it.
//
// "Expiring" is a window before expiry: 30 days, or the last quarter of the
// term when that is shorter. A flat 30 days would mark every 30-day trial
// Expiring from the day it was issued, and a badge that is always on warns
// nobody.

import { LicenseState } from "@stigmer/protos/ai/stigmer/platform/v1/license_pb";
import type { License } from "@stigmer/protos/ai/stigmer/billing/license/v1/api_pb";
import type { StatusPhase } from "../resource-workbench/types.js";
import { coveredThroughDay, toDate } from "./license-format.js";

/** The longest "expiring" window before a license's expiry, in days. */
export const EXPIRING_WINDOW_MAX_DAYS = 30;

/** The share of the term, counted back from expiry, that reads as expiring. */
export const EXPIRING_WINDOW_TERM_FRACTION = 0.25;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The time states an issued license can be in. */
export type LicenseTimeState =
  | LicenseState.valid
  | LicenseState.expiring
  | LicenseState.grace
  | LicenseState.expired;

/** A license's derived standing: both facts plus the shared-badge rendering. */
export interface LicenseStanding {
  /** Where the license's own term stands against the clock. */
  readonly timeState: LicenseTimeState;
  /** The id of the later license that renews this one, when there is one. */
  readonly renewedBy: string | undefined;
  /** `StatusPhase` for the shared `StatusBadge` (`--stgm-status-*` tokens). */
  readonly phase: StatusPhase;
  /** The badge label: the time state, or "Renewed" when renewed. */
  readonly label: string;
  /** One sentence saying why, for the badge's tooltip. */
  readonly reason: string;
}

/** Counts of the customers whose current license is in each live state. */
export interface LicenseCalendarSummary {
  readonly active: number;
  readonly expiring: number;
  readonly grace: number;
}

/**
 * The time state of one license at `now`.
 *
 * A license missing its expiry reads as expired: every issued license
 * carries one (the contract requires it), so its absence is damage, and
 * damage must never read as coverage.
 */
export function deriveTimeState(license: License, now: Date): LicenseTimeState {
  const expiresAt = toDate(license.spec?.expiresAt);
  if (!expiresAt) return LicenseState.expired;
  const graceUntil = toDate(license.spec?.graceUntil) ?? expiresAt;
  const t = now.getTime();

  if (t >= expiresAt.getTime()) {
    return t < graceUntil.getTime() ? LicenseState.grace : LicenseState.expired;
  }
  return t >= expiresAt.getTime() - expiringWindowMs(license, expiresAt)
    ? LicenseState.expiring
    : LicenseState.valid;
}

/**
 * The standing of every license in the list, keyed by license id. The
 * renewal fact needs the whole list: a license is renewed by the one of
 * its customer's licenses that covers furthest past it.
 */
export function deriveLicenseStandings(
  licenses: readonly License[],
  now: Date,
): ReadonlyMap<string, LicenseStanding> {
  const furthestByCustomer = new Map<string, License>();
  for (const license of licenses) {
    const customerId = license.spec?.customer?.id;
    if (!customerId) continue;
    const current = furthestByCustomer.get(customerId);
    if (!current || expiryMs(license) > expiryMs(current)) {
      furthestByCustomer.set(customerId, license);
    }
  }

  const standings = new Map<string, LicenseStanding>();
  for (const license of licenses) {
    const id = license.metadata?.id ?? "";
    const furthest = furthestByCustomer.get(license.spec?.customer?.id ?? "");
    const renewal =
      furthest && furthest !== license && expiryMs(furthest) > expiryMs(license)
        ? furthest
        : undefined;
    standings.set(id, standingOf(license, deriveTimeState(license, now), renewal));
  }
  return standings;
}

/**
 * The calendar's order: what needs action first (in grace, then expiring,
 * soonest first), then the active licenses by expiry, then history (expired,
 * then renewed), most recent first.
 */
export function sortForCalendar(
  licenses: readonly License[],
  standings: ReadonlyMap<string, LicenseStanding>,
): readonly License[] {
  const rank = (license: License): number => {
    const standing = standings.get(license.metadata?.id ?? "");
    if (!standing || standing.renewedBy) return 4;
    switch (standing.timeState) {
      case LicenseState.grace:
        return 0;
      case LicenseState.expiring:
        return 1;
      case LicenseState.valid:
        return 2;
      case LicenseState.expired:
        return 3;
      default: {
        const unreachable: never = standing.timeState;
        return unreachable;
      }
    }
  };
  return [...licenses].sort((a, b) => {
    const byRank = rank(a) - rank(b);
    if (byRank !== 0) return byRank;
    const byExpiry = expiryMs(a) - expiryMs(b);
    return rank(a) >= 3 ? -byExpiry : byExpiry;
  });
}

/**
 * Counts customers, not licenses: each customer is counted once, by the
 * license no other license of theirs renews. A renewed customer has two
 * licenses and one standing.
 */
export function summarizeCalendar(
  standings: ReadonlyMap<string, LicenseStanding>,
): LicenseCalendarSummary {
  let active = 0;
  let expiring = 0;
  let grace = 0;
  for (const standing of standings.values()) {
    if (standing.renewedBy) continue;
    if (standing.timeState === LicenseState.valid) active += 1;
    else if (standing.timeState === LicenseState.expiring) expiring += 1;
    else if (standing.timeState === LicenseState.grace) grace += 1;
  }
  return { active, expiring, grace };
}

function standingOf(
  license: License,
  timeState: LicenseTimeState,
  renewal: License | undefined,
): LicenseStanding {
  const expiresAt = toDate(license.spec?.expiresAt);
  const through = expiresAt ? coveredThroughDay(expiresAt) : "an unknown day";

  if (renewal) {
    const renewalExpiry = toDate(renewal.spec?.expiresAt);
    return {
      timeState,
      renewedBy: renewal.metadata?.id,
      phase: "disabled",
      label: "Renewed",
      reason: renewalExpiry
        ? `Renewed by a license covering through ${coveredThroughDay(renewalExpiry)}`
        : "Renewed by a later license",
    };
  }

  switch (timeState) {
    case LicenseState.valid:
      return {
        timeState,
        renewedBy: undefined,
        phase: "ready",
        label: "Active",
        reason: `Covered through ${through}`,
      };
    case LicenseState.expiring:
      return {
        timeState,
        renewedBy: undefined,
        phase: "degraded",
        label: "Expiring",
        reason: `Covered through ${through}; renew before it lapses`,
      };
    case LicenseState.grace: {
      const graceUntil = toDate(license.spec?.graceUntil);
      return {
        timeState,
        renewedBy: undefined,
        phase: "failed",
        label: "In grace",
        reason: graceUntil
          ? `Coverage ended after ${through}; grace runs through ${coveredThroughDay(graceUntil)}`
          : `Coverage ended after ${through}`,
      };
    }
    case LicenseState.expired:
      return {
        timeState,
        renewedBy: undefined,
        phase: "disabled",
        label: "Expired",
        reason: `Coverage ended after ${through}`,
      };
    default: {
      const unreachable: never = timeState;
      return unreachable;
    }
  }
}

function expiringWindowMs(license: License, expiresAt: Date): number {
  const cap = EXPIRING_WINDOW_MAX_DAYS * DAY_MS;
  const issuedAt = toDate(license.status?.issuedAt);
  if (!issuedAt) return cap;
  const termMs = Math.max(0, expiresAt.getTime() - issuedAt.getTime());
  return Math.min(cap, termMs * EXPIRING_WINDOW_TERM_FRACTION);
}

function expiryMs(license: License): number {
  return toDate(license.spec?.expiresAt)?.getTime() ?? Number.NEGATIVE_INFINITY;
}
