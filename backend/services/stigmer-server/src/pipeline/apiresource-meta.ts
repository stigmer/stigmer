/**
 * Kind-metadata helpers — port backend/libs/go/apiresource/metadata.go.
 * The proto `kind_meta` enum-value extension is the single source of truth
 * for a kind's canonical name, id prefix, and visibility config; deriving
 * anything from enum spellings is forbidden (Go learned this at
 * stigmer/stigmer#545 — PascalCase cannot recover "oauth_app").
 *
 * Both editions resolve the same strings from the same proto metadata; the
 * visibility helpers mirror Cloud's VisibilityConfigResolver so the
 * cross-edition error contract is identical by construction.
 *
 * The contract carries TWO kind vocabularies, and this module holds one
 * lookup for each so they are never merged:
 *
 *   - A resource's own `kind` field is the `kind_meta.name` ("McpServer").
 *     `getKindEnum` reads it by canonical name (case-insensitive,
 *     underscores ignored) and throws on an unknown value.
 *   - An `ApiResourceRef.kind` — the IamPolicy spec's principal and
 *     resource, the FGA object type — is the enum MEMBER name
 *     ("mcp_server"). `kindByEnumName` reads it by the descriptor's exact
 *     proto name and never throws (20260913.01, Q-OR-2). Exact, because the
 *     IamPolicy id is derived from the spec's text (Q-OR-9): a lenient
 *     match would let "Organization" and "organization" mint two rows for
 *     one grant. Reading the descriptor's name is not deriving a spelling;
 *     the #545 rule is about recovering kind_meta.name from an enum, which
 *     neither lookup does. A reader asked about a kind that arrived
 *     through this vocabulary follows its doctrine: `grantableRolesFor`
 *     answers the empty list for the unknown kind instead of throwing,
 *     because the kind it is asked about may have come off the wire.
 */
import { getOption, hasOption } from "@bufbuild/protobuf";
import type { DescEnumValue } from "@bufbuild/protobuf";

import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import {
  ApiResourceKind,
  ApiResourceKindSchema,
  kind_meta,
} from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { ApiResourceKindMeta } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

/** Go GetKindMeta: the kind_meta extension of the enum value. */
export function getKindMeta(kind: ApiResourceKind): ApiResourceKindMeta {
  const valueDesc = kindValueDescriptor(kind);
  if (valueDesc === undefined || !hasOption(valueDesc, kind_meta)) {
    throw new Error(`kind_meta extension not found for kind: ${kind}`);
  }
  return getOption(valueDesc, kind_meta);
}

/** Go GetIdPrefix: e.g. agent → "agt". */
export function getIdPrefix(kind: ApiResourceKind): string {
  return getKindMeta(kind).idPrefix;
}

/** Go GetKindName: the canonical name, e.g. agent → "Agent" (error copy uses this). */
export function getKindName(kind: ApiResourceKind): string {
  return getKindMeta(kind).name;
}

/**
 * Go GetKindEnum: resolve a resource's `kind` string field to the enum via
 * canonical kind_meta.name matching (case-insensitive, underscores
 * ignored) — twin of Cloud's ApiResourceKindExtractor.
 */
export function getKindEnum(kindValue: string): ApiResourceKind {
  if (kindValue === "") {
    throw new Error("kind field is empty");
  }
  const kind = kindsByCanonicalName().get(canonicalKindName(kindValue));
  if (kind === undefined) {
    throw new Error(`unknown kind: ${kindValue}`);
  }
  return kind;
}

/**
 * Resolves an `ApiResourceRef.kind` — a kind's enum MEMBER name, exactly
 * as the proto spells it ("organization", "identity_account") — to the
 * enum. Anything else, including the kind_meta spelling, a different case,
 * the empty string and the zero value's own name, is
 * `api_resource_kind_unknown`; never a throw, because the Authorize step
 * resolves `resource_kind_path` through this at position 1 of every chain
 * and resolution never fails a request (authorize.ts header). See the
 * module header for why the match is exact.
 */
export function kindByEnumName(value: string): ApiResourceKind {
  return (
    kindsByEnumName().get(value) ?? ApiResourceKind.api_resource_kind_unknown
  );
}

/**
 * Go DefaultVisibilityFor: blueprint kinds flagged defaults_to_org_visibility
 * get visibility_org (blueprints are shared org assets — a private default
 * would silently hide new blueprints from teammates); all others get
 * visibility_private.
 */
export function defaultVisibilityFor(
  kind: ApiResourceKind,
): ApiResourceVisibility {
  const config = getKindMeta(kind).authorization?.visibility;
  return config?.defaultsToOrgVisibility === true
    ? ApiResourceVisibility.visibility_org
    : ApiResourceVisibility.visibility_private;
}

/**
 * The roles a user may be granted on a resource of `kind` according to the
 * CONTRACT — `kind_meta.authorization.grantable_roles`, the one source of
 * "what can be granted at all" (Java AuthorizationConfigResolver
 * .getGrantableRoles; the cloud's iam/policy/roles.ts grantableRolesFor,
 * which this replaces at the 20260913.01 re-point). A kind that lists none
 * is system-managed in every edition (identity_account, api_key,
 * iam_policy, invitation, agent_execution); an edition's PolicyGrantScope
 * (extensions/policy-grant-scope.ts) only narrows this list.
 *
 * Total, never a throw: the kind is an `ApiResourceRef.kind` resolved by
 * `kindByEnumName`, so the unknown kind — the one member without
 * `kind_meta` — is a legitimate argument and answers the empty list
 * (module header, the second vocabulary).
 */
export function grantableRolesFor(
  kind: ApiResourceKind,
): ReadonlyArray<IamRole> {
  const valueDesc = kindValueDescriptor(kind);
  if (valueDesc === undefined || !hasOption(valueDesc, kind_meta)) {
    return [];
  }
  return getOption(valueDesc, kind_meta).authorization?.grantableRoles ?? [];
}

/**
 * Go SupportsVisibility: PRIVATE and UNSPECIFIED are always supported (no
 * visibility grant); every other level requires the matching supports_*
 * flag. Kinds with no VisibilityConfig are private-only.
 */
export function supportsVisibility(
  kind: ApiResourceKind,
  visibility: ApiResourceVisibility,
): boolean {
  const config = getKindMeta(kind).authorization?.visibility;
  switch (visibility) {
    case ApiResourceVisibility.visibility_public:
      return config?.supportsPublic === true;
    case ApiResourceVisibility.visibility_org:
      return config?.supportsOrg === true;
    case ApiResourceVisibility.visibility_platform:
      return config?.supportsPlatform === true;
    default:
      return true;
  }
}

/**
 * Go SupportedVisibilityLevels: comma-joined level names, always starting
 * with visibility_private — both editions build the same INVALID_ARGUMENT
 * copy from this exact format.
 */
export function supportedVisibilityLevels(kind: ApiResourceKind): string {
  const config = getKindMeta(kind).authorization?.visibility;
  let levels = "visibility_private";
  if (config?.supportsOrg === true) {
    levels += ", visibility_org";
  }
  if (config?.supportsPublic === true) {
    levels += ", visibility_public";
  }
  if (config?.supportsPlatform === true) {
    levels += ", visibility_platform";
  }
  return levels;
}

function kindValueDescriptor(kind: ApiResourceKind): DescEnumValue | undefined {
  return ApiResourceKindSchema.values.find((value) => value.number === kind);
}

/** Canonical spelling: lowercase, underscores stripped (Go canonicalKindName). */
function canonicalKindName(value: string): string {
  return value.toLowerCase().replaceAll("_", "");
}

let canonicalNameCache: Map<string, ApiResourceKind> | undefined;

function kindsByCanonicalName(): Map<string, ApiResourceKind> {
  if (canonicalNameCache === undefined) {
    canonicalNameCache = new Map(
      ApiResourceKindSchema.values
        .filter((value) => hasOption(value, kind_meta))
        .map((value) => [
          canonicalKindName(getOption(value, kind_meta).name),
          value.number as ApiResourceKind,
        ]),
    );
  }
  return canonicalNameCache;
}

let enumNameCache: Map<string, ApiResourceKind> | undefined;

/**
 * Every member by its descriptor name, the zero value included (it maps to
 * itself, which is the unknown kind either way). A Map rather than the TS
 * enum's reverse mapping, so a prototype key or a number spelled as text
 * cannot resolve to anything.
 */
function kindsByEnumName(): Map<string, ApiResourceKind> {
  if (enumNameCache === undefined) {
    enumNameCache = new Map(
      ApiResourceKindSchema.values.map((value) => [
        value.name,
        value.number as ApiResourceKind,
      ]),
    );
  }
  return enumNameCache;
}
