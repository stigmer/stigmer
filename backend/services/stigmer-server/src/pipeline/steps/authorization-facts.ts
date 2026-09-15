/**
 * The facts a stored row's authorization tuples derive from, read back
 * from the row (`RowAuthorizationFacts`, extensions/resource-authorization.ts)
 * — the read-time twin of the tuple lifecycle's create-time resolution in
 * authorization-tuples.ts, and deliberately not that function: the
 * create-time one throws when a row is missing its organization or its
 * parent (a create must not half-succeed), while a row read back years
 * later is a fact, missing pieces included — an empty organization
 * resolves `admin from organization` to nobody, it does not fault a read.
 * The two cannot drift unnoticed: src/authorization/__tests__/facts.test.ts
 * pins that a well-formed row resolves to the same links through both.
 *
 * Two readers share this one resolver, which is the reason it is a leaf
 * of its own: the list lanes' shared helper (extensions/list-read-scope.ts)
 * builds every candidate's `ListEntryMeta` through it, and the built-in
 * authorizer (src/authorization/facts.ts) derives a loaded row's tuples
 * through it. It imports the two pure leaves it needs (apiresource-meta,
 * shapes) and the protos, and nothing else, so the seam may import it by
 * value without a cycle — the third such leaf, beside those two.
 *
 * Every read is structural (shapes.ts's own premise: protobuf-es messages
 * are plain objects sharing the generated metadata and audit types), so
 * the resolver needs no schema — a list lane holds decoded rows of a kind
 * it names, not their descriptors.
 */
import { AuthorizationScopeType } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/authorization_config_pb";
import type { ParentRelationConfig } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/authorization_config_pb";
import type { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import type { ApiResourceAudit } from "@stigmer/protos/ai/stigmer/commons/apiresource/status_pb";

import type {
  ResolvedParentLink,
  RowAuthorizationFacts,
} from "../../extensions/resource-authorization.js";
import { getKindEnum, getKindMeta } from "../apiresource-meta.js";
import { parentIdOf } from "./shapes.js";
import type { HasMetadataShape } from "./shapes.js";

/** The one path every stored API resource keeps its audit under. */
interface HasAuditShape {
  status?: { audit?: ApiResourceAudit };
}

/** The row's facts, read structurally; every absence is the empty value, never a throw. */
export function rowAuthorizationFactsOf(
  kind: ApiResourceKind,
  resource: object,
): RowAuthorizationFacts {
  const metadata = (resource as HasMetadataShape).metadata;
  const org = metadata?.org ?? "";
  return {
    id: metadata?.id ?? "",
    org,
    visibility:
      metadata?.visibility ??
      ApiResourceVisibility.api_resource_visibility_unspecified,
    createdBy: createdByOf(resource),
    parentLinks: parentLinksOf(kind, resource, org),
  };
}

/** `status.audit.spec_audit.created_by.id` as stamped — "" when any link is absent. */
export function createdByOf(resource: object): string {
  return (
    (resource as HasAuditShape).status?.audit?.specAudit?.createdBy?.id ?? ""
  );
}

/**
 * The scope link and every configured additional parent the row names, in
 * the tuple lifecycle's order. A parent the row does not name is left out.
 */
export function parentLinksOf(
  kind: ApiResourceKind,
  resource: object,
  org: string,
): ReadonlyArray<ResolvedParentLink> {
  const config = getKindMeta(kind).authorization;
  if (config === undefined) {
    return [];
  }
  const links: ResolvedParentLink[] = [];
  switch (config.scopeType) {
    case AuthorizationScopeType.ORGANIZATION:
      if (org !== "") {
        links.push({
          relation: "organization",
          parentKind: getKindEnum("organization"),
          parentId: org,
        });
      }
      break;
    case AuthorizationScopeType.PARENT:
      if (config.parent !== undefined) {
        pushLink(links, resource, config.parent);
      }
      break;
    case AuthorizationScopeType.OWNER_ONLY:
    case AuthorizationScopeType.PLATFORM:
    case AuthorizationScopeType.NONE:
    case AuthorizationScopeType.UNSPECIFIED:
      // No scope link: OWNER_ONLY by design; PLATFORM is dead config in
      // both editions (the lifecycle warns and writes none); NONE and
      // UNSPECIFIED are kinds outside the model.
      break;
    default: {
      const exhaustive: never = config.scopeType;
      throw new Error(`unknown scope type: ${String(exhaustive)}`);
    }
  }
  for (const parent of config.additionalParents) {
    pushLink(links, resource, parent);
  }
  return links;
}

function pushLink(
  links: ResolvedParentLink[],
  resource: object,
  parent: ParentRelationConfig,
): void {
  const parentId = parentIdOf(resource, parent.specField);
  if (parentId !== "") {
    links.push({
      relation: parent.relation,
      parentKind: getKindEnum(parent.kind),
      parentId,
    });
  }
}
