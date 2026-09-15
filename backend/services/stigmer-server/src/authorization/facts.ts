/**
 * The facts a stored row carries that its authorization tuples are
 * derived from, as the built-in authorizer names them — the seam's
 * `RowAuthorizationFacts` (extensions/resource-authorization.ts) with the
 * kind beside them, because the derivation (derived-tuples.ts) reads the
 * kind's `kind_meta` and names the object by its type.
 *
 * The facts have two producers and one resolver. A LOADED row (the
 * point-check driver's path, `rowFactsOf`) and a list lane's candidate
 * (`ListEntryMeta`, built by the lanes' shared helper; `rowFactsOfEntry`)
 * both read through pipeline/steps/authorization-facts.ts — the read-time
 * twin of the tuple lifecycle's create-time resolution, lenient where that
 * one throws (a legacy row's missing organization is a fact, not a fault),
 * and pinned equal to it in __tests__/facts.test.ts. Naming the shape once
 * is what lets the derivation stay one function and what states exactly
 * which facts a list candidate must carry: a candidate's facts ARE these,
 * so a list evaluates the model over what the lane already decoded and
 * never reads a candidate's row a second time.
 */
import type { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { RowAuthorizationFacts } from "../extensions/resource-authorization.js";
import { rowAuthorizationFactsOf } from "../pipeline/steps/authorization-facts.js";

export interface RowFacts extends RowAuthorizationFacts {
  readonly kind: ApiResourceKind;
}

/** The facts of a loaded row of `kind`. */
export function rowFactsOf(kind: ApiResourceKind, row: object): RowFacts {
  return { kind, ...rowAuthorizationFactsOf(kind, row) };
}

/** The facts a list candidate of `kind` carries — the same facts, already read by the lane's helper. */
export function rowFactsOfEntry(
  kind: ApiResourceKind,
  entry: RowAuthorizationFacts,
): RowFacts {
  return {
    kind,
    id: entry.id,
    org: entry.org,
    visibility: entry.visibility,
    createdBy: entry.createdBy,
    parentLinks: entry.parentLinks,
  };
}
