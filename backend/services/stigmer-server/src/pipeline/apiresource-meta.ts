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
 *     `kindEnumName` is the inverse — how server code SPELLS a kind when
 *     it builds an `ApiResourceRef` itself (the built-in role lifecycle's
 *     cleanup refs; the organization-role specs) — so no caller reaches
 *     for the enum's reverse index by hand.
 *
 * A kind's TIER meets the served EDITION in exactly one place on the
 * server, `tierServedByEdition` / `kindServedByEdition` (20260913.01
 * Q-OR-8; claim check C5) — the twin of the SDK's rank functions
 * (sdk/typescript/src/resource-availability.ts), pinned equal on the whole
 * matrix by __tests__/kind-served-by-edition.test.ts. The console reads
 * the SDK's answer to decide what to SHOW; `checkMyPermission` reads the
 * server's to decide what is HELD; a disagreement is a surface that
 * appears and then fails. The enum NUMBERS are wire identifiers, never
 * ranks (`enterprise` sits at 3 in both enums and ranks second).
 */
import { getOption, hasOption } from "@bufbuild/protobuf";
import type { DescEnumValue } from "@bufbuild/protobuf";

import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import {
  ApiResourceKind,
  ApiResourceKindSchema,
  ResourceTier,
  kind_meta,
} from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { ApiResourceKindMeta } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import {
  AuthorizationScopeType,
  OwnerAttributionType,
} from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/authorization_config_pb";
import type { ParentRelationConfig } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/authorization_config_pb";
import type { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";
import { ServerEdition } from "@stigmer/protos/ai/stigmer/platform/v1/server_info_pb";

/** Go GetKindMeta: the kind_meta extension of the enum value. */
export function getKindMeta(kind: ApiResourceKind): ApiResourceKindMeta {
  const valueDesc = kindValueDescriptor(kind);
  if (valueDesc === undefined || !hasOption(valueDesc, kind_meta)) {
    throw new Error(`kind_meta extension not found for kind: ${kind}`);
  }
  return getOption(valueDesc, kind_meta);
}

/**
 * The parent a kind's authorization IS — the `kind_meta` declaration that
 * a kind's permissions are its parent's whole, not its own: PARENT scope
 * (the one structural link is to that parent) AND INHERITED owner (no
 * owner tuple of its own; `owner from <parent>` in the FGA model).
 * Undefined for every other kind, including kinds with additional parents
 * whose inheritance is partial (a workflow_execution's opt-in
 * `execution_viewer from workflow_instance` sits beside its own owner).
 *
 * Today exactly one kind answers: agent_execution → session (its
 * `can_view` is `viewer or can_view from session`, and `viewer` is the
 * session's). The list read scope reads this to carry the parent on every
 * candidate (`ListEntryMeta.authorizationParent`, 20260913.04 T04), so a
 * composed driver may ask its authorization backend about the parent —
 * direct tuples — instead of the child, whose resolution walks the
 * parent's whole set. A second kind declaring the pair gets the behavior
 * from this declaration alone; the table pin in __tests__ makes that a
 * reviewed change.
 */
export function inheritedAuthorizationParentOf(
  kind: ApiResourceKind,
): ParentRelationConfig | undefined {
  const config = getKindMeta(kind).authorization;
  if (
    config?.scopeType !== AuthorizationScopeType.PARENT ||
    config.ownerType !== OwnerAttributionType.INHERITED
  ) {
    return undefined;
  }
  return config.parent;
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
 * The inverse of `kindByEnumName`: a kind spelled as an `ApiResourceRef.kind`
 * — the descriptor's exact proto name ("organization", "identity_account").
 * Total over the enum: the unknown kind spells itself, so a ref built from
 * it round-trips to the unknown kind and the gate that reads it refuses
 * the way it refuses a wire caller's garbage; never a throw.
 */
export function kindEnumName(kind: ApiResourceKind): string {
  // A number that is no member (a cast from outside the enum) spells as
  // the unknown kind, which every descriptor carries as its zero value.
  const value =
    kindValueDescriptor(kind) ??
    kindValueDescriptor(ApiResourceKind.api_resource_kind_unknown);
  return value?.name ?? "";
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
 * Whether an edition serves a tier: the tier names the MINIMUM edition,
 * the editions are ordered oss < enterprise < cloud (each composes the
 * previous one's units), so a tier admits its own edition and every one
 * above. An edition the server does not know (`server_edition_unspecified`)
 * serves everything — the SDK's own fallback: an older client against a
 * newer server hides nothing. A tier the proto forgot is treated as core
 * for the same reason the SDK does: hiding a served kind is the worse
 * failure.
 */
export function tierServedByEdition(
  tier: ResourceTier,
  edition: ServerEdition,
): boolean {
  if (edition === ServerEdition.server_edition_unspecified) {
    return true;
  }
  return editionRank(edition) >= tierRank(tier);
}

/**
 * Whether this edition serves a kind: its `kind_meta.tier` through the
 * table above. Throws for a kind without `kind_meta` (the unknown kind):
 * a caller that reaches this with wire input has skipped the kind
 * refusals, and "served" for it would hide that bug.
 */
export function kindServedByEdition(
  kind: ApiResourceKind,
  edition: ServerEdition,
): boolean {
  return tierServedByEdition(getKindMeta(kind).tier, edition);
}

function editionRank(edition: ServerEdition): number {
  switch (edition) {
    case ServerEdition.oss:
      return 1;
    case ServerEdition.enterprise:
      return 2;
    case ServerEdition.cloud:
    case ServerEdition.server_edition_unspecified:
      return 3;
    default: {
      const exhaustive: never = edition;
      throw new Error(`unknown server edition: ${String(exhaustive)}`);
    }
  }
}

function tierRank(tier: ResourceTier): number {
  switch (tier) {
    case ResourceTier.open_source:
    case ResourceTier.resource_tier_unspecified:
      return 1;
    case ResourceTier.enterprise:
      return 2;
    case ResourceTier.cloud_only:
      return 3;
    default: {
      const exhaustive: never = tier;
      throw new Error(`unknown resource tier: ${String(exhaustive)}`);
    }
  }
}

/**
 * Whether a kind may hold a visibility level — the one predicate behind the
 * ValidateVisibility doors on every create and updateVisibility chain.
 *
 * PRIVATE and UNSPECIFIED are always supported (no visibility grant is
 * written for them); ORG and PLATFORM require the matching supports_* flag
 * on the kind's VisibilityConfig, so kinds with no config are private-only.
 * PUBLIC is refused for every kind: the level is retired (it made a row
 * readable to every account on the server), no config may declare it, and
 * the answer is fixed here rather than read from a flag that no longer
 * exists. Every level is named so a level added to the enum must be taught
 * here before any row can hold it; the closing arm is unreachable by wire
 * input, because both doors validate the field `defined_only` first.
 */
export function supportsVisibility(
  kind: ApiResourceKind,
  visibility: ApiResourceVisibility,
): boolean {
  const config = getKindMeta(kind).authorization?.visibility;
  switch (visibility) {
    case ApiResourceVisibility.api_resource_visibility_unspecified:
    case ApiResourceVisibility.visibility_private:
      return true;
    case ApiResourceVisibility.visibility_org:
      return config?.supportsOrg === true;
    case ApiResourceVisibility.visibility_platform:
      return config?.supportsPlatform === true;
    case ApiResourceVisibility.visibility_public:
      return false;
    default: {
      const exhaustive: never = visibility;
      throw new Error(`unknown visibility level: ${String(exhaustive)}`);
    }
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

/**
 * The kind a minted resource id belongs to, read off its prefix — the
 * inverse of `getIdPrefix` over the ids `generateId` mints
 * (`<prefix>_<ulid>`, pipeline/steps/defaults.ts). The one consumer today
 * is the runner-credential lane, whose token binds an execution by id and
 * must know whether that id names an agent execution or a workflow
 * execution without a second claim or a guess. Anything that is not
 * `<known prefix>_<rest>` — no underscore, an unknown prefix, the empty
 * string — is `api_resource_kind_unknown`; never a throw, because the id
 * arrived inside a credential and the caller refuses with its own
 * sentence. Every `id_prefix` in the contract is unique; the table pin in
 * __tests__ makes a future duplicate a reviewed change, since this lookup
 * would otherwise resolve it silently to one of the two.
 */
export function kindByIdPrefix(id: string): ApiResourceKind {
  const separator = id.indexOf("_");
  if (separator <= 0) {
    return ApiResourceKind.api_resource_kind_unknown;
  }
  return (
    kindsByIdPrefix().get(id.slice(0, separator)) ??
    ApiResourceKind.api_resource_kind_unknown
  );
}

let idPrefixCache: Map<string, ApiResourceKind> | undefined;

function kindsByIdPrefix(): Map<string, ApiResourceKind> {
  if (idPrefixCache === undefined) {
    idPrefixCache = new Map(
      ApiResourceKindSchema.values
        .filter((value) => hasOption(value, kind_meta))
        .map((value) => [
          getOption(value, kind_meta).idPrefix,
          value.number as ApiResourceKind,
        ]),
    );
  }
  return idPrefixCache;
}
