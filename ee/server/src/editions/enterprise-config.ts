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
 *     who signs in may found an organization and write such URLs. `relaxed`:
 *     private and loopback addresses too (a federation issuer or MCP server
 *     on the operator's own network), with link-local still refused, which
 *     trusts every signed-in person with the operator's network. Any other
 *     value refuses the boot rather than guessing.
 *
 * `readEnterpriseSettings` is the one reading the process entry makes, and
 * it carries the order the promise needs: the key first, then the egress
 * posture only when a key is present. A keyless server therefore never
 * looks at the Enterprise variable, and a typo in it cannot refuse the boot
 * of a server that is the open-source edition exactly. The order lives here
 * rather than in the entry because the entry runs under no suite.
 */

/** The variable an operator sets to the license key. */
export const LICENSE_KEY_VARIABLE = "STIGMER_LICENSE_KEY";

/** The variable an operator sets to choose the egress posture. */
export const OUTBOUND_EGRESS_VARIABLE = "STIGMER_OUTBOUND_EGRESS";

/** Which addresses a person-written URL may reach. */
export type EgressPosture = "strict" | "relaxed";

/** What the entry hands the composition; `egress` is read only when a key is present. */
export interface EnterpriseSettings {
  readonly licenseKey: string | undefined;
  readonly egress?: EgressPosture;
}

/** The server's own settings, the key first and the egress posture only with a key. */
export function readEnterpriseSettings(env: NodeJS.ProcessEnv = process.env): EnterpriseSettings {
  const licenseKey = readLicenseKey(env);
  if (licenseKey === undefined) {
    return { licenseKey };
  }
  return { licenseKey, egress: readEgressPosture(env) };
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
