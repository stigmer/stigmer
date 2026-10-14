/**
 * The freeze: once a Stigmer Enterprise license and its grace period have
 * ended, the server refuses to grow its setup and keeps everything else
 * working.
 *
 * Growth is a new organization, a new team, and a new or changed identity
 * provider. People keep signing in, being invited and joining teams, and
 * every removal stays open, so a late renewal never stops a new hire's
 * onboarding or an admin cutting off a compromised provider. The gate
 * below is what the Enterprise host hands the identity unit (its neutral
 * `GrowthGate` port, iam/growth-gate.ts) and registers on the organization
 * create chain; the chains ask it, and this module alone decides and words
 * the answer.
 *
 * The state is read from the clock at every ask, not once at boot: a
 * server that is never restarted must still lapse when its grace ends.
 *
 * The refusal is FAILED_PRECONDITION with the LICENSE_RENEWAL_REQUIRED
 * reason the contract documents on each gated command, so a console tells a
 * renewal refusal by its reason, never by its copy.
 */
import type { LicenseClaims } from "@stigmer/protos/ai/stigmer/platform/v1/license_pb";
import { failedPreconditionError } from "@stigmer/server";

import type { GrowthGate } from "../iam/growth-gate.js";
import { isLapsed, licenseStateAt } from "./state.js";

/** The reason a renewal refusal carries (stigmer/stigmer's organization, team and federation issuer command protos). */
export const LICENSE_RENEWAL_REQUIRED = "LICENSE_RENEWAL_REQUIRED";

/** The refusal's copy: what ended, what renewing unlocks, and that nothing stops. */
export const LICENSE_RENEWAL_MESSAGE =
  "This server's Stigmer Enterprise license has ended; renew it to create organizations, teams or federation issuers. Everything that exists keeps working.";

export interface LicenseGrowthInput {
  readonly claims: LicenseClaims;
  /** The wall clock, read at each ask; tests pass their own. */
  readonly clock: () => Date;
}

/** The gate: refuses growth exactly while the license is lapsed. */
export function newLicenseGrowthGate(input: LicenseGrowthInput): GrowthGate {
  return {
    assertGrowthAllowed(): void {
      if (isLapsed(licenseStateAt(input.claims, input.clock()))) {
        throw failedPreconditionError(LICENSE_RENEWAL_MESSAGE, {
          reason: LICENSE_RENEWAL_REQUIRED,
        });
      }
    },
  };
}
