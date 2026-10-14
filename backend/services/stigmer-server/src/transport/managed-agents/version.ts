/**
 * The Claude Managed Agents version this lane serves, and how a request's
 * `anthropic-beta` header selects it.
 *
 * The claim is one dated beta version, as typed by one exact
 * `@anthropic-ai/sdk` release (apis/ai/stigmer/agentic/session/docs/
 * README.md names both; scripts/managed-agents-claim.test.mjs holds every
 * copy of the version equal). A later version is one more entry in the
 * served set, proved by its own conformance run, never a silent change of
 * the shapes this one serves.
 *
 * The header rule: absent, the request is served at the current version,
 * so a plain HTTP client needs no Anthropic header at all; naming a served
 * version, beside any other betas, is served; naming any other
 * `managed-agents-*` version is refused, so a client written for a later
 * version learns it at once instead of misreading this version's shapes.
 * Betas that are not Managed Agents versions are none of this lane's
 * business and are ignored.
 */

/** The Managed Agents beta version the lane serves. */
export const MANAGED_AGENTS_VERSION = "managed-agents-2026-04-01";

/** Every version the lane serves; the newest is MANAGED_AGENTS_VERSION. */
export const SERVED_MANAGED_AGENTS_VERSIONS: ReadonlySet<string> = new Set([MANAGED_AGENTS_VERSION]);

const MANAGED_AGENTS_BETA_PREFIX = "managed-agents-";

/** The version a request is served at, or the refusal's message. */
export type VersionSelection =
  | { readonly served: true; readonly version: string }
  | { readonly served: false; readonly message: string };

/** Reads the `anthropic-beta` header (a comma list, possibly repeated and joined). */
export function selectManagedAgentsVersion(header: string | undefined): VersionSelection {
  const named = (header ?? "")
    .split(",")
    .map((beta) => beta.trim())
    .filter((beta) => beta.startsWith(MANAGED_AGENTS_BETA_PREFIX));
  if (named.length === 0) {
    return { served: true, version: MANAGED_AGENTS_VERSION };
  }
  const unserved = named.find((beta) => !SERVED_MANAGED_AGENTS_VERSIONS.has(beta));
  if (unserved !== undefined) {
    return {
      served: false,
      message: `this server serves ${MANAGED_AGENTS_VERSION}, not ${unserved}`,
    };
  }
  return { served: true, version: named[0] ?? MANAGED_AGENTS_VERSION };
}
