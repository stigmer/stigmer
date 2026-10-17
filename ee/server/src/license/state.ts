/**
 * Where a verified license stands at an instant: the contract's verified
 * states (`ai.stigmer.platform.v1.LicenseState`), read from the claims and
 * a clock reading the caller passes in, never from the wall clock here.
 *
 *   valid     until EXPIRING_WINDOW_DAYS before `expires_at`;
 *   expiring  from then until `expires_at`, so a console can warn ahead;
 *   grace     from `expires_at` until `grace_until`;
 *   expired   from `grace_until` on.
 *
 * Each boundary instant belongs to the later state (`expires_at` itself is
 * grace, `grace_until` itself is expired), the way an "until" timestamp
 * reads. Claims the verifier accepted always carry both instants and
 * `grace_until >= expires_at` (the contract's rules); a grace instant that
 * is missing or earlier is read as no grace at all rather than trusted.
 *
 * Only `expired` is a lapse: the freeze (growth.ts) refuses growth then,
 * and nothing else changes with the state.
 */
import { timestampDate } from "@bufbuild/protobuf/wkt";

import { LicenseState, type LicenseClaims } from "@stigmer/apis/ai/stigmer/platform/v1/license_pb";
import type { LicenseStatusReport } from "@stigmer/server";

/** How long before `expires_at` a license reports `expiring`. */
export const EXPIRING_WINDOW_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The states a verified license can be in (the library's report arms that carry claims). */
export type VerifiedLicenseState = Extract<LicenseStatusReport, { claims: LicenseClaims }>["state"];

/** The license's state at `now`. */
export function licenseStateAt(claims: LicenseClaims, now: Date): VerifiedLicenseState {
  if (claims.expiresAt === undefined) {
    throw new Error("verified license claims carry no expires_at");
  }
  const at = now.getTime();
  const expiresAt = timestampDate(claims.expiresAt).getTime();
  const graceUntil = Math.max(
    expiresAt,
    claims.graceUntil === undefined ? expiresAt : timestampDate(claims.graceUntil).getTime(),
  );
  if (at < expiresAt - EXPIRING_WINDOW_DAYS * DAY_MS) {
    return LicenseState.valid;
  }
  if (at < expiresAt) {
    return LicenseState.expiring;
  }
  if (at < graceUntil) {
    return LicenseState.grace;
  }
  return LicenseState.expired;
}

/** Whether a license in `state` has lapsed: its term and grace have both ended. */
export function isLapsed(state: VerifiedLicenseState): boolean {
  return state === LicenseState.expired;
}
