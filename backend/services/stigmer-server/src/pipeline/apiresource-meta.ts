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
 * Go DefaultVisibilityFor: blueprint kinds flagged defaults_to_org_visibility
 * get visibility_org (blueprints are shared org assets — a private default
 * would silently hide new blueprints from teammates); all others get
 * visibility_private.
 */
export function defaultVisibilityFor(kind: ApiResourceKind): ApiResourceVisibility {
  const config = getKindMeta(kind).authorization?.visibility;
  return config?.defaultsToOrgVisibility === true
    ? ApiResourceVisibility.visibility_org
    : ApiResourceVisibility.visibility_private;
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
