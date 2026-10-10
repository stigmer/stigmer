// ApiResourceKind metadata for the emitters, read from @stigmer/protos'
// generated descriptors — the TS analogue of the Go generator's
// resource_kind.go / sdk_kind_meta_ts.go init-time extension reads (which
// used the compiled Go stubs). Values derive from api_resource_kind.proto's
// kind_meta options so they can never drift from the protos.

import { getOption, hasOption } from "@bufbuild/protobuf";
import {
  ApiResourceKindSchema,
  kind_meta,
  ResourceTier,
} from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { AuthorizationScopeType } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/authorization_config_pb";
import { IamRoleSchema, role_meta } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

/** Enum number → lowercase constant name (e.g. 43 → "skill"). */
export const apiResourceKindEnumNames = new Map<number, string>();

/** Kinds whose kind_meta.is_versioned is true. */
export const versionedKinds = new Set<number>();

/**
 * Kinds whose metadata.org the contract says is empty: the platform-level
 * resources whose kind_meta.authorization.scope_type is NONE (License,
 * Plan), and Organization, which belongs to no organization (its scope is
 * its owner's, which it shares with kinds that do carry one).
 */
export const orglessKinds = new Set<number>();

export interface KindMetaEntry {
  enumName: string;
  enumNumber: number;
  tier: ResourceTier;
  grantableRoles: number[];
  /** The roles a team may be granted on the kind (a subset of grantableRoles). */
  teamGrantableRoles: number[];
  /** What each grantable role means on the kind (role_descriptions). */
  roleDescriptions: { role: number; description: string }[];
}

/** kind_meta.name → kind_meta.id_prefix (port of buildIdPrefixMap). */
export const idPrefixByMetaName = new Map<string, string>();

const entries: KindMetaEntry[] = [];

for (const value of ApiResourceKindSchema.values) {
  apiResourceKindEnumNames.set(value.number, value.name);

  if (value.number === 0) continue;
  if (!hasOption(value, kind_meta)) continue;
  const meta = getOption(value, kind_meta);

  if (meta.isVersioned) {
    versionedKinds.add(value.number);
  }
  if (
    meta.authorization?.scopeType === AuthorizationScopeType.NONE ||
    value.name === "organization"
  ) {
    orglessKinds.add(value.number);
  }
  if (meta.name !== "") {
    idPrefixByMetaName.set(meta.name, meta.idPrefix);
  }
  entries.push({
    enumName: value.name,
    enumNumber: value.number,
    tier: meta.tier,
    grantableRoles: meta.authorization?.grantableRoles ?? [],
    teamGrantableRoles: meta.authorization?.teamGrantableRoles ?? [],
    roleDescriptions: (meta.authorization?.roleDescriptions ?? []).map((entry) => ({
      role: entry.role,
      description: entry.description,
    })),
  });
}

entries.sort((a, b) => a.enumNumber - b.enumNumber);

/** kind_meta entries in enum-number order (port of extractKindMetaEntries). */
export function kindMetaEntries(): KindMetaEntry[] {
  return entries;
}

export { ResourceTier };

/** IamRole number → enum value name. */
export function iamRoleName(role: number): string {
  return IamRoleSchema.values.find((v) => v.number === role)?.name ?? String(role);
}

/** One IamRole value's role_meta: its name and its kindless sentence. */
export interface IamRoleMetaEntry {
  role: number;
  name: string;
  displayName: string;
  description: string;
}

/** Every IamRole value carrying role_meta, in enum-number order. */
export function iamRoleMetaEntries(): IamRoleMetaEntry[] {
  return IamRoleSchema.values
    .filter((value) => value.number !== 0 && hasOption(value, role_meta))
    .map((value) => {
      const meta = getOption(value, role_meta);
      return {
        role: value.number,
        name: value.name,
        displayName: meta.displayName,
        description: meta.description,
      };
    });
}

/** Port of isVersionedKind: kind NAME → is_versioned. */
export function isVersionedKind(kindName: string): boolean {
  for (const [num, name] of apiResourceKindEnumNames) {
    if (name === kindName) return versionedKinds.has(num);
  }
  return false;
}

/** Kind NAME → whether the kind has no organization (scope_type NONE). */
export function isOrglessKind(kindName: string): boolean {
  for (const [num, name] of apiResourceKindEnumNames) {
    if (name === kindName) return orglessKinds.has(num);
  }
  return false;
}
