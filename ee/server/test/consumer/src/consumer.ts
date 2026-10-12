/**
 * The compile proof of `@stigmer/enterprise`'s exports map: a host that
 * composes the Enterprise identity unit beside the library's own server
 * names the builder, its ports, the Postgres side, the license verifier and
 * a contract kit through the package's one entry, and nothing else. It runs
 * against the file-linked package and, in `npm run verify:consumer`, against
 * the packed tarball, so a `files` omission or a missing declaration fails
 * here. Never executed.
 */
import type { ServerExtension } from "@stigmer/server";
import {
  ENTERPRISE_IDENTITY_UNIT,
  type EnterpriseIdentityPorts,
  type EnterprisePostgres,
  type LicenseVerification,
  newEnterpriseIdentityExtension,
  newEnterprisePostgres,
  runEnterpriseMigrations,
  teamStoreContract,
  verifyLicenseTicket,
} from "@stigmer/enterprise";

/** The unit's builder takes its ports and returns a library extension. */
export const buildUnit: (ports: EnterpriseIdentityPorts) => ServerExtension = newEnterpriseIdentityExtension;

/** The unit's name, as boot logs and registration errors carry it. */
export const unitName: string = ENTERPRISE_IDENTITY_UNIT;

/** The Postgres side is built over a host's pool. */
export const buildPostgres: (...args: Parameters<typeof newEnterprisePostgres>) => EnterprisePostgres = newEnterprisePostgres;

/** The schema chain runs from the unit's start, and a host may run it too. */
export const migrate: typeof runEnterpriseMigrations = runEnterpriseMigrations;

/** The verifier answers whether a ticket verifies against the ring it is given. */
export const verify: (...args: Parameters<typeof verifyLicenseTicket>) => LicenseVerification = verifyLicenseTicket;

/** A contract kit an adapter of the team store runs. */
export const teamContract: typeof teamStoreContract = teamStoreContract;
