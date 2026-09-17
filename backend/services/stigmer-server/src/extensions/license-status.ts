/**
 * The license-status extension point: what license does this server hold?
 *
 * Every edition answers the question through
 * PlatformQueryController.getLicenseStatus, because a server's license is a
 * fact about the server, like its edition, and the console banner that
 * reads it ("licensed to Acme until March") must work wherever it is shown.
 * Only one edition ever has a license to report: the Enterprise composition
 * registers the provider that verifies the ticket it was configured with.
 * Open source and the cloud hold no key, so with no provider composed the
 * built-in `absent` answer below installs at the boot/compose.ts
 * consumption site (the default-lives-with-the-consumer doctrine; see
 * drivers.ts).
 *
 * The port speaks the generated claim types rather than a domain twin. The
 * claims ARE the wire — the ticket's payload is the proto JSON of
 * LicenseClaims — so a hand-written copy would be exactly the duplicate of a
 * generated type the SDK and server guides forbid.
 *
 * The controller owns the clock: it hands the provider ONE instant and
 * stamps the answer's checked_at from the same one, so a report and its
 * timestamp can never disagree about when the license was evaluated. A
 * provider therefore takes `now` and never reads the wall clock itself.
 *
 * The report is a union keyed on the state, not a bag of optional fields,
 * so the wire's presence contract (GetLicenseStatusOutput) is a fact the
 * compiler holds rather than a sentence a provider has to remember: an
 * `invalid` report cannot carry the claims that did not verify, a `valid`
 * one cannot omit them, and `unspecified` cannot be reported at all.
 */
import type { LicenseClaims } from "@stigmer/protos/ai/stigmer/platform/v1/license_pb";
import { LicenseState } from "@stigmer/protos/ai/stigmer/platform/v1/license_pb";

/**
 * The states in which a ticket's signature verified and its claims are
 * trusted; what separates them is only where the clock stands in the term.
 */
export type VerifiedLicenseState =
  | LicenseState.valid
  | LicenseState.expiring
  | LicenseState.grace
  | LicenseState.expired;

/**
 * A provider's answer, evaluated at the instant it was given. One arm per
 * presence shape: no ticket configured; a ticket that named a key and did
 * not verify; a ticket that verified, with the key it named and the claims
 * it carried. The controller copies the arm to the wire field for field.
 */
export type LicenseStatusReport =
  | { readonly state: LicenseState.absent }
  | { readonly state: LicenseState.invalid; readonly keyId: string }
  | {
      readonly state: VerifiedLicenseState;
      readonly keyId: string;
      readonly claims: LicenseClaims;
    };

/** The provider contract (single-instance point, ExtensionDrivers.licenseStatus). */
export interface LicenseStatusProvider {
  /** The license's state as of `now`, the instant the answer is stamped with. */
  status(now: Date): Promise<LicenseStatusReport>;
}

/**
 * The built-in answer for a server that holds no license: open source and
 * the cloud, and an Enterprise composition that registered no provider.
 */
export const ABSENT_LICENSE_STATUS: LicenseStatusProvider = {
  status: () => Promise.resolve({ state: LicenseState.absent }),
};
