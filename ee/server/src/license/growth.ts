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
 * `GrowthGate` port, iam/growth-gate.ts); the chains ask it, and this
 * module alone decides and words the answer.
 *
 * The organization create chain asks it through its own step, which first
 * admits the server acting as itself (caller class `internal`): the freeze
 * refuses the growth people ask for, and the organization a license of one
 * makes at its first start (the library's boot/single-organization.ts) is
 * not that. An expired license is never worse than no license, and without
 * a key the server holds its one organization; the creators step
 * (editions/organization-creators.ts) admits the same caller on the same
 * slot for the same reason. Today that boot is the only create the server
 * makes as itself; a later one that makes organizations for people decides
 * on its own whether it is growth.
 *
 * The state is read from the clock at every ask, not once at boot: a
 * server that is never restarted must still lapse when its grace ends.
 *
 * The refusal is FAILED_PRECONDITION with the LICENSE_RENEWAL_REQUIRED
 * reason the contract documents on each gated command, so a console tells a
 * renewal refusal by its reason, never by its copy.
 */
import type { LicenseClaims } from "@stigmer/protos/ai/stigmer/platform/v1/license_pb";
import type { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import type { PipelineStep, RequestContext } from "@stigmer/server";
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

/** The organization create chain's growth step: the gate, after admitting the server acting as itself. */
export function newOrganizationGrowthStep(
  gate: GrowthGate,
): PipelineStep<typeof OrganizationSchema> {
  return {
    name: "GrowthGate",
    async execute(
      ctx: RequestContext<typeof OrganizationSchema>,
    ): Promise<void> {
      if (ctx.callerIdentity.callerClass === "internal") {
        return;
      }
      gate.assertGrowthAllowed();
    },
  };
}
