// Parse a user-supplied resource reference into either an ID lookup or an
// org/slug lookup.
//
//   "agt_abc123"        -> by ID
//   "my-org/my-agent"   -> by org/slug (explicit org)
//   "my-agent"          -> by org/slug (org from --org/context)
//
// The kind's id prefix disambiguates a bare token: "org" resolves "org_x" as
// an ID but "acme" as a slug.
//
// The lower half of this module adds the *strict* classification the run/resume
// resolvers need: prefix-by-kind detection and full ID validation (prefix, "_"
// and a 26-char ULID, the only id shape the server mints). This is deliberately
// distinct from parseReference's lenient `${prefix}_` test — `run my-agent` must not
// treat a slug that merely starts with a known prefix as an ID.

import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { KIND_META } from "../registry/index.js";

export type ParsedReference =
  | { readonly kind: "id"; readonly id: string }
  | { readonly kind: "ref"; readonly org: string; readonly slug: string };

export function parseReference(
  ref: string,
  defaultOrg: string,
  idPrefix: string,
): ParsedReference {
  const trimmed = ref.trim();

  const slash = trimmed.indexOf("/");
  if (slash > 0) {
    return { kind: "ref", org: trimmed.slice(0, slash), slug: trimmed.slice(slash + 1) };
  }

  if (idPrefix !== "" && trimmed.startsWith(`${idPrefix}_`)) {
    return { kind: "id", id: trimmed };
  }

  return { kind: "ref", org: defaultOrg, slug: trimmed };
}

// Crockford base-32 ULID body length. The resolver checks only the length (not
// the alphabet), so a 26-char body after a known prefix is accepted as a
// complete ID; the server judges the rest.
const ULID_LENGTH = 26;

/**
 * The prefix a kind's ids carry (from the proto kind_meta mirror); "" for a
 * kind the mirror lacks.
 */
export function idPrefixOf(kind: ApiResourceKind): string {
  return KIND_META.get(kind)?.idPrefix ?? "";
}

// Every known resource-ID prefix, deduped. Built once from the kind_meta
// mirror so there is a single source of truth shared with the rest of the CLI
// (the registry) rather than a hand-rolled prefix list.
const ALL_ID_PREFIXES: readonly string[] = (() => {
  const set = new Set<string>();
  for (const kind of KIND_META.keys()) {
    const prefix = idPrefixOf(kind);
    if (prefix !== "") set.add(prefix);
  }
  return [...set];
})();

// A kind prefix followed by "_". Case-sensitive, so "RUN_" is not a run id.
function hasKindPrefix(ref: string, prefix: string): boolean {
  if (prefix === "") return false;
  return ref.trim().startsWith(`${prefix}_`);
}

/** True if `ref` carries `kind`'s id prefix. */
function hasPrefixOf(ref: string, kind: ApiResourceKind): boolean {
  return hasKindPrefix(ref, idPrefixOf(kind));
}

/** True if `ref` carries the agent ID prefix (`agt_…`). */
export function isAgentId(ref: string): boolean {
  return hasPrefixOf(ref, ApiResourceKind.agent);
}

/** True if `ref` carries the session ID prefix (`ses_…`). */
export function isSessionId(ref: string): boolean {
  return hasPrefixOf(ref, ApiResourceKind.session);
}

/** True if `ref` carries the routine ID prefix (`rtn_…`). */
export function isRoutineId(ref: string): boolean {
  return hasPrefixOf(ref, ApiResourceKind.routine);
}

/** True if `ref` is a run ID (`run_…`). Case-sensitive, so "RUN_" is not one. */
export function isRunId(ref: string): boolean {
  return hasPrefixOf(ref, ApiResourceKind.run);
}

/**
 * True if `ref` starts with ANY known resource-ID prefix (length-agnostic):
 * use it to detect *intent* (the user typed something ID-shaped), then
 * {@link validateResourceId} to enforce completeness.
 */
export function hasResourceIdPrefix(ref: string): boolean {
  return ALL_ID_PREFIXES.some((prefix) => hasKindPrefix(ref, prefix));
}

/**
 * Validate that `ref` is a syntactically complete resource ID. Returns null
 * when valid, or a user-facing error message otherwise: a known prefix and
 * "_" followed by a 26-char ULID body. A matched prefix with the wrong body
 * length is reported as "incomplete" so callers can guide the user to paste
 * the full ID.
 */
export function validateResourceId(ref: string): string | null {
  const trimmed = ref.trim();
  for (const prefix of ALL_ID_PREFIXES) {
    const pfx = `${prefix}_`;
    if (!trimmed.startsWith(pfx)) continue;
    if (trimmed.length - pfx.length !== ULID_LENGTH) {
      return "incomplete resource ID: expected 26-character ULID after prefix";
    }
    return null;
  }
  return "not a recognized resource ID";
}
