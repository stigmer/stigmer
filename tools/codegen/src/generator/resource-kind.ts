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
import { IamRoleSchema } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

/** Enum number → lowercase constant name (e.g. 43 → "skill"). */
export const apiResourceKindEnumNames = new Map<number, string>();

/** Kinds whose kind_meta.is_versioned is true. */
export const versionedKinds = new Set<number>();

export interface KindMetaEntry {
  enumName: string;
  enumNumber: number;
  tier: ResourceTier;
  grantableRoles: number[];
}

const entries: KindMetaEntry[] = [];

for (const value of ApiResourceKindSchema.values) {
  apiResourceKindEnumNames.set(value.number, value.name);

  if (value.number === 0) continue;
  if (!hasOption(value, kind_meta)) continue;
  const meta = getOption(value, kind_meta);

  if (meta.isVersioned) {
    versionedKinds.add(value.number);
  }
  entries.push({
    enumName: value.name,
    enumNumber: value.number,
    tier: meta.tier,
    grantableRoles: meta.authorization?.grantableRoles ?? [],
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

/** Port of isVersionedKind: kind NAME → is_versioned. */
export function isVersionedKind(kindName: string): boolean {
  for (const [num, name] of apiResourceKindEnumNames) {
    if (name === kindName) return versionedKinds.has(num);
  }
  return false;
}
