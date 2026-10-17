/**
 * The license-status provider a licensed Enterprise server registers
 * (`drivers.licenseStatus`): what `getLicenseStatus` answers.
 *
 * It is built from a key that already verified, so it only ever reports a
 * verified state, with the key id the key named and the claims it carried.
 * A key that does not verify never gets this far (the boot refuses it), and
 * a server with no key registers no provider, so the library's `absent`
 * answers. The state is read from the instant the controller hands in
 * (state.ts), never the wall clock, so a report and its `checked_at` agree.
 */
import type { LicenseClaims } from "@stigmer/apis/ai/stigmer/platform/v1/license_pb";
import type { LicenseStatusProvider } from "@stigmer/server";

import { licenseStateAt } from "./state.js";

export interface VerifiedLicense {
  readonly keyId: string;
  readonly claims: LicenseClaims;
}

export function newLicenseStatusProvider(license: VerifiedLicense): LicenseStatusProvider {
  return {
    status: (now) =>
      Promise.resolve({
        state: licenseStateAt(license.claims, now),
        keyId: license.keyId,
        claims: license.claims,
      }),
  };
}
