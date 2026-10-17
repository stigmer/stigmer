/**
 * Pins the shape of every parent link `kind_meta` declares
 * (ParentRelationConfig): it names exactly one field the parent id is read
 * from, its spec's or its status's, so a reader never has to choose between
 * two. The one status-field link today is a fired session's routine, which
 * only the server writes; a second arrives as a reviewed edit of the table
 * below, never as a silent consequence of a kind_meta edit.
 */
import { describe, expect, it } from "vitest";

import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { getKindMeta } from "../apiresource-meta.js";

const KINDS = Object.values(ApiResourceKind)
  .filter((value): value is ApiResourceKind => typeof value === "number")
  .filter((kind) => kind !== ApiResourceKind.api_resource_kind_unknown);

function parentsOf(kind: ApiResourceKind) {
  const config = getKindMeta(kind).authorization;
  if (config === undefined) {
    return [];
  }
  return [...(config.parent === undefined ? [] : [config.parent]), ...config.additionalParents];
}

describe("every parent link kind_meta declares", () => {
  it("names exactly one of spec_field and status_field", () => {
    const malformed = KINDS.flatMap((kind) =>
      parentsOf(kind)
        .filter((parent) => (parent.specField === "") === (parent.statusField === ""))
        .map((parent) => `${ApiResourceKind[kind]}#${parent.relation}`),
    );
    expect(malformed).toEqual([]);
  });

  it("reads a status field only for a fired session's routine", () => {
    const fromStatus = KINDS.flatMap((kind) =>
      parentsOf(kind)
        .filter((parent) => parent.statusField !== "")
        .map((parent) => `${ApiResourceKind[kind]}#${parent.relation}@${parent.kind}.${parent.statusField}`),
    );
    expect(fromStatus).toEqual(["session#routine@routine.routine_id"]);
  });
});
