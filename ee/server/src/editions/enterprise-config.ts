/**
 * The self-hosted Enterprise server's settings of its own, read once at
 * boot. Everything else the server reads (the database, the operator's
 * issuer, the ports) is the library's configuration, read by its process
 * body.
 *
 *   - `STIGMER_LICENSE_KEY`: the license key an operator pastes. Blank or
 *     unset means no key, and the server runs as open source.
 *   - `STIGMER_OUTBOUND_EGRESS`: which addresses a licensed server may dial
 *     when it reaches a URL a person wrote (a federation issuer's
 *     discovery, keys and userinfo; an MCP or plugin install probe; a vault
 *     sign-in). Without a key the server is the open-source edition exactly,
 *     with open source's own posture, and this setting is not read. Unset,
 *     blank or `strict`: public addresses only, the default, because anyone
 *     who signs in may found an organization (unless the operator lists who
 *     may) and write such URLs. `relaxed`:
 *     private and loopback addresses too (a federation issuer or MCP server
 *     on the operator's own network), with link-local still refused, which
 *     trusts every signed-in person with the operator's network. Any other
 *     value refuses the boot rather than guessing.
 *   - `STIGMER_ACCESS_HISTORY_RETENTION_DAYS`: how many days a licensed
 *     server keeps the access history. Unset or blank keeps every entry.
 *     A whole number of days, at least 1, is the window: once an hour the
 *     server removes the entries older than it, in every organization,
 *     deleted ones included. Any other value (`0`, `-5`, `365d`, `1y`)
 *     refuses the boot: an operator who believes records are destroyed
 *     after a year must not find them kept, nor kept ones destroyed.
 *   - `STIGMER_ORGANIZATION_CREATORS`: who may create a top-level
 *     organization on a licensed server (editions/organization-creators.ts).
 *     Unset, blank or `anyone`: anyone signed in, the library's contract.
 *     Otherwise a comma-separated list of account ids (`ida_...`, what
 *     `stigmer auth whoami` prints), whitespace around each trimmed and
 *     duplicates collapsed: only those accounts. An entry that is not an
 *     account id, an empty entry, or `anyone` inside a list refuses the
 *     boot naming it: an operator who believes creation is restricted must
 *     not find it open over a typo. A change takes a restart.
 *
 * `readEnterpriseSettings` is the one reading the process entry makes, and
 * it carries the order the promise needs: the key first, then the egress
 * posture, the retention window and the creators list only when a key is
 * present. A keyless
 * server therefore never looks at an Enterprise variable, and a typo in one
 * cannot refuse the boot of a server that is the open-source edition
 * exactly. The order lives here
 * rather than in the entry because the entry runs under no suite.
 */

import { isAccountId } from "./organization-creators.js";

/** The variable an operator sets to the license key. */
export const LICENSE_KEY_VARIABLE = "STIGMER_LICENSE_KEY";

/** The variable an operator sets to choose the egress posture. */
export const OUTBOUND_EGRESS_VARIABLE = "STIGMER_OUTBOUND_EGRESS";

/** The variable an operator sets to the number of days the access history is kept. */
export const ACCESS_HISTORY_RETENTION_VARIABLE = "STIGMER_ACCESS_HISTORY_RETENTION_DAYS";

/** The variable an operator sets to the accounts that may create an organization. */
export const ORGANIZATION_CREATORS_VARIABLE = "STIGMER_ORGANIZATION_CREATORS";

/** The value that keeps creation open to anyone signed in, as unset does. */
const ANYONE = "anyone";

/** Which addresses a person-written URL may reach. */
export type EgressPosture = "strict" | "relaxed";

/** What the entry hands the composition; everything but the key is read only when a key is present. */
export interface EnterpriseSettings {
  readonly licenseKey: string | undefined;
  readonly egress?: EgressPosture;
  /** Days the access history is kept; absent keeps every entry. */
  readonly accessHistoryRetentionDays?: number;
  /** The accounts that may create a top-level organization; absent means anyone signed in. */
  readonly organizationCreators?: ReadonlySet<string>;
}

/** The server's own settings, the key first and the Enterprise variables only with a key. */
export function readEnterpriseSettings(env: NodeJS.ProcessEnv = process.env): EnterpriseSettings {
  const licenseKey = readLicenseKey(env);
  if (licenseKey === undefined) {
    return { licenseKey };
  }
  const egress = readEgressPosture(env);
  const accessHistoryRetentionDays = readAccessHistoryRetentionDays(env);
  const organizationCreators = readOrganizationCreators(env);
  return {
    licenseKey,
    egress,
    ...(accessHistoryRetentionDays === undefined ? {} : { accessHistoryRetentionDays }),
    ...(organizationCreators === undefined ? {} : { organizationCreators }),
  };
}

/** The key, or undefined when none is set. */
export function readLicenseKey(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const value = env[LICENSE_KEY_VARIABLE]?.trim() ?? "";
  return value === "" ? undefined : value;
}

/** The egress posture: strict unless the operator chose relaxed; any other value throws. */
export function readEgressPosture(env: NodeJS.ProcessEnv = process.env): EgressPosture {
  const value = env[OUTBOUND_EGRESS_VARIABLE]?.trim() ?? "";
  if (value === "" || value === "strict") {
    return "strict";
  }
  if (value === "relaxed") {
    return "relaxed";
  }
  throw new Error(`${OUTBOUND_EGRESS_VARIABLE} must be "strict" or "relaxed"; it is "${value}"`);
}

/** The access history's window in days, or undefined to keep every entry; any value but a whole number of days of at least 1 throws. */
export function readAccessHistoryRetentionDays(
  env: NodeJS.ProcessEnv = process.env,
): number | undefined {
  const value = env[ACCESS_HISTORY_RETENTION_VARIABLE]?.trim() ?? "";
  if (value === "") {
    return undefined;
  }
  const days = /^\d+$/.test(value) ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(days) || days < 1) {
    throw new Error(
      `${ACCESS_HISTORY_RETENTION_VARIABLE} must be a whole number of days, at least 1, or unset to keep the access history for good; it is "${value}"`,
    );
  }
  return days;
}

/** The accounts that may create a top-level organization, or undefined for anyone signed in; a malformed list throws naming the entry. */
export function readOrganizationCreators(
  env: NodeJS.ProcessEnv = process.env,
): ReadonlySet<string> | undefined {
  const value = env[ORGANIZATION_CREATORS_VARIABLE]?.trim() ?? "";
  if (value === "" || value === ANYONE) {
    return undefined;
  }
  const creators = new Set<string>();
  for (const raw of value.split(",")) {
    const entry = raw.trim();
    if (entry === "") {
      throw new Error(`${ORGANIZATION_CREATORS_VARIABLE} has an empty entry; it is "${value}"`);
    }
    if (entry === ANYONE) {
      throw new Error(
        `${ORGANIZATION_CREATORS_VARIABLE} is either "${ANYONE}" or a list of account ids, not both; it is "${value}"`,
      );
    }
    if (!isAccountId(entry)) {
      throw new Error(
        `${ORGANIZATION_CREATORS_VARIABLE} must be "${ANYONE}" or comma-separated account ids (ida_ and 26 characters, as stigmer auth whoami prints them); "${entry}" is not one`,
      );
    }
    creators.add(entry);
  }
  return creators;
}
