/**
 * The facts a stored row carries that its authorization tuples are
 * derived from — one named shape with, eventually, two producers: a
 * LOADED row (this module, the point-check driver's path) and a list
 * lane's candidate metadata (the list scope that follows). Naming the shape
 * is what lets the derivation (derived-tuples.ts) stay one function, and
 * what states exactly which facts a list candidate must carry.
 *
 * Resolution reads the same primitives the tuple lifecycle writes with —
 * `metadata.org`, `parentIdOf` over the kind's `kind_meta` parent config,
 * `metadata.visibility`, the audit's creator stamp — and deliberately not
 * the lifecycle's `resolveParentLinks`: that function throws when a
 * create is missing its organization or parent (a create must not
 * half-succeed), while a row read back years later is a fact, missing
 * pieces included (an empty organization resolves `admin from
 * organization` to nobody; it does not fault the check). The two readers
 * cannot drift unnoticed: __tests__/facts.test.ts pins that a well-formed
 * row resolves to the same links and shapes through both.
 */
import type { Message } from "@bufbuild/protobuf";

import type { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { AuthorizationScopeType } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/authorization_config_pb";
import type { ParentRelationConfig } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/authorization_config_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";

import type { ResolvedParentLink } from "../extensions/resource-authorization.js";
import { getKindEnum, getKindMeta } from "../pipeline/apiresource-meta.js";
import { auditOf } from "../pipeline/steps/defaults.js";
import { metadataOf, parentIdOf } from "../pipeline/steps/shapes.js";
import type { KindDeclaration } from "./model/rewrite.js";

export interface RowFacts {
  readonly kind: ApiResourceKind;
  readonly id: string;
  /** `metadata.org`; "" for kinds outside organization scope and for legacy rows that never named one. */
  readonly org: string;
  readonly visibility: ApiResourceVisibility;
  /** `status.audit.spec_audit.created_by.id` as stamped; "" when absent. Classified by the derivation, not here. */
  readonly createdBy: string;
  /**
   * The scope link and every configured additional parent, in the tuple
   * lifecycle's order, from the row's own fields; a parent the row does
   * not name is absent, never a fault.
   */
  readonly parentLinks: ReadonlyArray<ResolvedParentLink>;
}

export function rowFactsOf(
  declaration: KindDeclaration,
  row: Message,
): RowFacts {
  const metadata = metadataOf(row);
  const org = metadata?.org ?? "";
  return {
    kind: declaration.kind,
    id: metadata?.id ?? "",
    org,
    visibility:
      metadata?.visibility ??
      ApiResourceVisibility.api_resource_visibility_unspecified,
    createdBy: auditOf(declaration.schema, row)?.specAudit?.createdBy?.id ?? "",
    parentLinks: parentLinksOf(declaration.kind, row, org),
  };
}

function parentLinksOf(
  kind: ApiResourceKind,
  row: Message,
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
        pushLink(links, row, config.parent);
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
    pushLink(links, row, parent);
  }
  return links;
}

function pushLink(
  links: ResolvedParentLink[],
  row: Message,
  parent: ParentRelationConfig,
): void {
  const parentId = parentIdOf(row, parent.specField);
  if (parentId !== "") {
    links.push({
      relation: parent.relation,
      parentKind: getKindEnum(parent.kind),
      parentId,
    });
  }
}
