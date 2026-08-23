/**
 * Shared lookup helpers — port steps/helpers.go. Full-scan slug and label
 * lookups, exactly Go's semantics (indexability is guaranteed at the store
 * interface, not here — D2 §3).
 */
import { fromBinary } from "@bufbuild/protobuf";
import type { DescMessage, MessageShape } from "@bufbuild/protobuf";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { AuthorizationScopeType } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/authorization_config_pb";

import type { Store } from "../../store/interface.js";
import { getKindMeta } from "../apiresource-meta.js";
import { internalError, invalidArgumentError } from "../errors.js";
import { metadataOf } from "./shapes.js";

/**
 * Finds one resource by slug, optionally narrowed to an org — Go
 * FindResourceBySlug. Slugs are org-scoped identifiers: the same slug can
 * exist in different orgs; an EMPTY org applies no filter (matches any
 * org). Not-found is a normal outcome (undefined), never an error.
 */
export async function findResourceBySlug<Desc extends DescMessage>(
  store: Store,
  kind: ApiResourceKind,
  schema: Desc,
  slug: string,
  org: string,
): Promise<MessageShape<Desc> | undefined> {
  const rows = await store.listResources(kind);
  for (const data of rows) {
    let resource: MessageShape<Desc>;
    try {
      resource = fromBinary(schema, data);
    } catch {
      continue; // skip malformed rows, as Go does
    }
    const metadata = metadataOf(resource);
    if (metadata === undefined || metadata.slug !== slug) {
      continue;
    }
    if (org !== "" && metadata.org !== org) {
      continue;
    }
    return resource;
  }
  return undefined;
}

/**
 * Finds one resource by (labelKey=labelValue, org) — Go
 * FindResourceByLabelAndOrg. Org is matched EXACTLY here, unlike the slug
 * helper: (label, org) together form the composite uniqueness key, and
 * treating an empty org as a wildcard would make an empty-org resource
 * collide with matching resources in EVERY org — the cross-tenant
 * over-matching this helper exists to prevent (metadata.org is
 * proto-unconstrained on create, so empty is a reachable input).
 */
export async function findResourceByLabelAndOrg<Desc extends DescMessage>(
  store: Store,
  kind: ApiResourceKind,
  schema: Desc,
  labelKey: string,
  labelValue: string,
  org: string,
): Promise<MessageShape<Desc> | undefined> {
  const rows = await store.listResources(kind);
  for (const data of rows) {
    let resource: MessageShape<Desc>;
    try {
      resource = fromBinary(schema, data);
    } catch {
      continue;
    }
    const metadata = metadataOf(resource);
    if (metadata === undefined) {
      continue;
    }
    if (metadata.labels[labelKey] === labelValue && metadata.org === org) {
      return resource;
    }
  }
  return undefined;
}

/**
 * Rejects a getByReference lookup that omits org for an org-scoped kind —
 * Go RequireOrgForReference. For AUTHORIZATION_SCOPE_TYPE_ORGANIZATION
 * kinds a slug is unique only WITHIN an org; resolving an org-less
 * reference globally would cross tenant boundaries. The message matches
 * the cloud edition verbatim (cross-edition error contract).
 *
 * Belongs at the getByReference boundary only — the low-level slug finders
 * are legitimately called with a relative (possibly empty) org by internal
 * resolvers.
 */
export function requireOrgForReference(
  kind: ApiResourceKind,
  org: string,
): void {
  if (org !== "") {
    return;
  }
  let scopeType: AuthorizationScopeType | undefined;
  let kindName: string;
  try {
    const meta = getKindMeta(kind);
    scopeType = meta.authorization?.scopeType;
    kindName = meta.name;
  } catch (error) {
    throw internalError(error, "failed to resolve kind metadata for reference org check");
  }
  // protobuf-es strips the shared enum prefix: proto
  // AUTHORIZATION_SCOPE_TYPE_ORGANIZATION generates as ORGANIZATION.
  if (scopeType === AuthorizationScopeType.ORGANIZATION) {
    throw invalidArgumentError(`org is required for ${kindName} lookup`);
  }
}
