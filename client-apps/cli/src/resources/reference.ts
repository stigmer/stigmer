// Parse a user-supplied resource reference into either an ID lookup or an
// org/slug lookup, mirroring the Go CLI's parseOrgSlug + ID detection.
//
//   "agt_abc123"        -> by ID
//   "my-org/my-agent"   -> by org/slug (explicit org)
//   "my-agent"          -> by org/slug (org from --org/context)
//
// The kind's id_prefix disambiguates a bare token: "org" resolves "org_x" as an
// ID but "acme" as a slug.
//
// The lower half of this module adds the *strict* classification the run/resume
// resolvers need (Go's pkg/reference): prefix-by-kind detection and full ID
// validation (prefix + 26-char ULID, or UUID). This is deliberately distinct
// from parseReference's lenient `${prefix}_` test — `run my-agent` must not
// treat a slug that merely starts with a known prefix as an ID.

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { KIND_META } from "../registry/index.js";

export type ParsedReference =
  | { readonly kind: "id"; readonly id: string }
  | { readonly kind: "ref"; readonly org: string; readonly slug: string };

export function parseReference(ref: string, defaultOrg: string, idPrefix: string): ParsedReference {
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

// Crockford base-32 ULID body length. Mirrors Go's reference.ulidLength: the
// resolver only checks the length (not the alphabet), so a 26-char body after a
// known prefix is accepted as a complete ID.
const ULID_LENGTH = 26;

// Execution-runtime prefixes that are not in KIND_META (which only carries the
// addressable, registry-relevant kinds) but that the run resolver must still
// recognize so it can reject them with explicit-form guidance. "wex" is the
// workflow-execution prefix; "aex" is already in KIND_META.
const RUNTIME_ID_PREFIXES: readonly string[] = ["wex"];

/** The id_prefix for a kind (from the proto kind_meta mirror), or "". */
function idPrefixFor(kind: ApiResourceKind): string {
  return KIND_META.get(kind)?.idPrefix ?? "";
}

// Every known resource-ID prefix, deduped. Built once from the kind_meta mirror
// plus the runtime prefixes so there is a single source of truth shared with
// the rest of the CLI (the registry) rather than a hand-rolled prefix list.
const ALL_ID_PREFIXES: readonly string[] = (() => {
  const set = new Set<string>(RUNTIME_ID_PREFIXES);
  for (const meta of KIND_META.values()) {
    if (meta.idPrefix !== "") set.add(meta.idPrefix);
  }
  return [...set];
})();

// Mirrors Go's reference.isResourceIDWithKind: a kind prefix followed by either
// separator the backend accepts ("_" canonical, "-" legacy). Case-sensitive.
function hasKindPrefix(ref: string, prefix: string): boolean {
  if (prefix === "") return false;
  const trimmed = ref.trim();
  return trimmed.startsWith(`${prefix}_`) || trimmed.startsWith(`${prefix}-`);
}

/** True if `ref` carries the agent ID prefix (`agt_…`/`agt-…`). */
export function isAgentId(ref: string): boolean {
  return hasKindPrefix(ref, idPrefixFor(ApiResourceKind.agent));
}

/** True if `ref` carries the workflow ID prefix (`wfl_…`/`wfl-…`). */
export function isWorkflowId(ref: string): boolean {
  return hasKindPrefix(ref, idPrefixFor(ApiResourceKind.workflow));
}

/** True if `ref` carries the session ID prefix (`ses_…`/`ses-…`). */
export function isSessionId(ref: string): boolean {
  return hasKindPrefix(ref, idPrefixFor(ApiResourceKind.session));
}

/** True if `ref` carries the schedule ID prefix (`sch_…`/`sch-…`). */
export function isScheduleId(ref: string): boolean {
  return hasKindPrefix(ref, idPrefixFor(ApiResourceKind.schedule));
}

/**
 * True if `ref` starts with ANY known resource-ID prefix (length-agnostic).
 * Mirrors Go's reference.HasResourceIDPrefix: use it to detect *intent* (the
 * user typed something ID-shaped), then {@link validateResourceId} to enforce
 * completeness.
 */
export function hasResourceIdPrefix(ref: string): boolean {
  if (ALL_ID_PREFIXES.some((prefix) => hasKindPrefix(ref, prefix))) return true;
  return isUuid(ref.trim());
}

/**
 * Validate that `ref` is a syntactically complete resource ID. Returns null
 * when valid, or a user-facing error message otherwise. Mirrors Go's
 * reference.ValidateResourceID/ResourceIDKind: a known prefix followed by a
 * 26-char ULID body, or a bare UUID (legacy). A matched prefix with the wrong
 * body length is reported as "incomplete" so callers can guide the user to
 * paste the full ID.
 */
export function validateResourceId(ref: string): string | null {
  const trimmed = ref.trim();
  for (const prefix of ALL_ID_PREFIXES) {
    for (const sep of ["_", "-"]) {
      const pfx = `${prefix}${sep}`;
      if (!trimmed.startsWith(pfx)) continue;
      const body = trimmed.slice(pfx.length);
      if (body.length !== ULID_LENGTH) {
        return "incomplete resource ID: expected 26-character ULID after prefix";
      }
      return null;
    }
  }
  if (isUuid(trimmed)) return null;
  return "not a recognized resource ID";
}

// Mirrors Go's reference.isUUID: 8-4-4-4-12 hex with hyphens at fixed offsets.
function isUuid(value: string): boolean {
  if (value.length !== 36) return false;
  if (value[8] !== "-" || value[13] !== "-" || value[18] !== "-" || value[23] !== "-") {
    return false;
  }
  for (let i = 0; i < value.length; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) continue;
    if (!isHexDigit(value[i])) return false;
  }
  return true;
}

function isHexDigit(c: string): boolean {
  return (c >= "0" && c <= "9") || (c >= "a" && c <= "f") || (c >= "A" && c <= "F");
}
