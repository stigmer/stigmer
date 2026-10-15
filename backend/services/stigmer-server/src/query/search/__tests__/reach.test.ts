/**
 * Pins that every searchable kind declares where search finds its
 * candidates (reach.ts): the searchable set is derived from `kind_meta` at
 * run time, so a kind that becomes searchable without a reach fails here,
 * not as a search that throws for that kind. An organization's kinds name
 * the list index of their own kind.
 */
import { describe, expect, it } from "vitest";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { searchIndexedKinds } from "../criteria.js";
import { searchReachOf } from "../reach.js";

describe("search reach", () => {
  it.each(searchIndexedKinds().map((kind) => [ApiResourceKind[kind], kind]))(
    "the searchable kind %s declares a reach",
    (_name, kind) => {
      const reach = searchReachOf(kind);
      if (reach.reach === "organization") {
        expect(reach.index.kind).toBe(kind);
      }
    },
  );

  it("throws for a kind that declares none, rather than leave it unrestricted", () => {
    expect(() => searchReachOf(ApiResourceKind.vault)).toThrow(/declares no reach/);
  });
});
