// Parse a user-supplied resource reference into either an ID lookup or an
// org/slug lookup, mirroring the Go CLI's parseOrgSlug + ID detection.
//
//   "agt_abc123"        -> by ID
//   "my-org/my-agent"   -> by org/slug (explicit org)
//   "my-agent"          -> by org/slug (org from --org/context)
//
// The kind's id prefixes disambiguate a bare token: "org" resolves "org_x" as
// an ID but "acme" as a slug. A kind's retired prefixes count too (a run
// minted as "aex_…" before the run kind's prefix became "run"): ids are never
// rewritten, so a stored id keeps the prefix it was minted with.
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

export function parseReference(
  ref: string,
  defaultOrg: string,
  idPrefixes: string | readonly string[],
): ParsedReference {
  const trimmed = ref.trim();

  const slash = trimmed.indexOf("/");
  if (slash > 0) {
    return { kind: "ref", org: trimmed.slice(0, slash), slug: trimmed.slice(slash + 1) };
  }

  const prefixes = typeof idPrefixes === "string" ? [idPrefixes] : idPrefixes;
  if (prefixes.some((prefix) => prefix !== "" && trimmed.startsWith(`${prefix}_`))) {
    return { kind: "id", id: trimmed };
  }

  return { kind: "ref", org: defaultOrg, slug: trimmed };
}

// Crockford base-32 ULID body length. Mirrors Go's reference.ulidLength: the
// resolver only checks the length (not the alphabet), so a 26-char body after a
// known prefix is accepted as a complete ID.
const ULID_LENGTH = 26;

/**
 * Every prefix a kind's ids may carry (from the proto kind_meta mirror): its
 * id_prefix, then its retired ones. Empty for a kind the mirror lacks.
 */
export function idPrefixesFor(kind: ApiResourceKind): readonly string[] {
  const meta = KIND_META.get(kind);
  if (meta === undefined) return [];
  return [meta.idPrefix, ...(meta.retiredIdPrefixes ?? [])].filter((prefix) => prefix !== "");
}

// Every known resource-ID prefix, current and retired, deduped. Built once
// from the kind_meta mirror so there is a single source of truth shared with
// the rest of the CLI (the registry) rather than a hand-rolled prefix list.
const ALL_ID_PREFIXES: readonly string[] = (() => {
  const set = new Set<string>();
  for (const kind of KIND_META.keys()) {
    for (const prefix of idPrefixesFor(kind)) set.add(prefix);
  }
  return [...set];
})();

// The legacy "-" separator (Go's reference package) predates the run kind's
// "run" prefix: no id was ever minted "run-…", and "run-" is how an agent slug
// such as "run-nightly-report" starts, so that prefix takes "_" only.
const UNDERSCORE_ONLY_PREFIXES: ReadonlySet<string> = new Set(["run"]);

/** The separators an id may carry after `prefix`: "_" canonical, "-" legacy. */
function separatorsFor(prefix: string): readonly string[] {
  return UNDERSCORE_ONLY_PREFIXES.has(prefix) ? ["_"] : ["_", "-"];
}

// Mirrors Go's reference.isResourceIDWithKind: a kind prefix followed by a
// separator {@link separatorsFor} allows it. Case-sensitive.
function hasKindPrefix(ref: string, prefix: string): boolean {
  if (prefix === "") return false;
  const trimmed = ref.trim();
  return separatorsFor(prefix).some((sep) => trimmed.startsWith(`${prefix}${sep}`));
}

/** True if `ref` carries one of `kind`'s id prefixes, current or retired. */
function hasPrefixOf(ref: string, kind: ApiResourceKind): boolean {
  return idPrefixesFor(kind).some((prefix) => hasKindPrefix(ref, prefix));
}

/** True if `ref` carries the agent ID prefix (`agt_…`/`agt-…`). */
export function isAgentId(ref: string): boolean {
  return hasPrefixOf(ref, ApiResourceKind.agent);
}

/** True if `ref` carries the session ID prefix (`ses_…`/`ses-…`). */
export function isSessionId(ref: string): boolean {
  return hasPrefixOf(ref, ApiResourceKind.session);
}

/** True if `ref` carries the schedule ID prefix (`sch_…`/`sch-…`). */
export function isScheduleId(ref: string): boolean {
  return hasPrefixOf(ref, ApiResourceKind.schedule);
}

/**
 * True if `ref` is a run ID: `run_…`, or `aex_…` (either separator) for a run
 * minted before the run kind's prefix changed. Case-sensitive, so "RUN_" is
 * not one.
 */
export function isRunId(ref: string): boolean {
  return hasPrefixOf(ref, ApiResourceKind.run);
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
    for (const sep of separatorsFor(prefix)) {
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
