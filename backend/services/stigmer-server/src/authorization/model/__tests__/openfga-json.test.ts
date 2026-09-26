/**
 * Pins the compiled model's reader (openfga-json.ts): what it builds from
 * OpenFGA's JSON, and every refusal its header names, one case each, over
 * a small model in the compiled file's own canonical shape. The real model
 * goes through the same reader whenever model/index.ts loads, so a model
 * this server cannot evaluate fails every suite that imports it; these
 * cases say which input fails, and with what message.
 */
import { describe, expect, it } from "vitest";

import { readOpenFgaModel } from "../openfga-json.js";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** The compiled file's shape, as far as these fixtures edit it. */
interface CompiledModel {
  schema_version: string;
  conditions?: Json;
  type_definitions: TypeDefinition[];
}

interface TypeDefinition {
  type: string;
  relations?: { [relation: string]: Json };
  metadata: {
    module: string;
    source_info: { file: string };
    relations?: { [relation: string]: { directly_related_user_types?: Json[] } };
  };
}

/**
 * A three-type model as the generator writes it: an organization with a
 * direct `admin`, and a doc whose `viewer` unions a direct list (a person
 * or an organization's admins), its `owner`, and `admin from org`.
 */
function baseModel(): CompiledModel {
  return {
    schema_version: "1.2",
    type_definitions: [
      {
        metadata: {
          module: "core",
          relations: { admin: { directly_related_user_types: [{ type: "identity_account" }] } },
          source_info: { file: "core.fga" },
        },
        relations: { admin: { this: {} } },
        type: "organization",
      },
      {
        metadata: { module: "core", source_info: { file: "core.fga" } },
        type: "identity_account",
      },
      {
        metadata: {
          module: "docs",
          relations: {
            org: { directly_related_user_types: [{ type: "organization" }] },
            owner: { directly_related_user_types: [{ type: "identity_account" }] },
            viewer: {
              directly_related_user_types: [
                { type: "identity_account" },
                { relation: "admin", type: "organization" },
              ],
            },
          },
          source_info: { file: "docs/doc.fga" },
        },
        relations: {
          org: { this: {} },
          owner: { this: {} },
          viewer: {
            union: {
              child: [
                { this: {} },
                { computedUserset: { relation: "owner" } },
                {
                  tupleToUserset: {
                    computedUserset: { relation: "admin" },
                    tupleset: { relation: "org" },
                  },
                },
              ],
            },
          },
        },
        type: "doc",
      },
    ],
  };
}

/** The base model with one edit applied to a fresh copy. */
function edited(edit: (model: CompiledModel) => void): unknown {
  const model = baseModel();
  edit(model);
  return model;
}

/** The doc type's relations and their metadata, both present in the base model. */
function docOf(model: CompiledModel): {
  relations: { [relation: string]: Json };
  metadata: { [relation: string]: { directly_related_user_types?: Json[] } };
} {
  const doc = model.type_definitions[2];
  if (doc?.relations === undefined || doc.metadata.relations === undefined) {
    throw new Error("the base model's doc type has relations");
  }
  return { relations: doc.relations, metadata: doc.metadata.relations };
}

describe("readOpenFgaModel", () => {
  it("reads every type in file order, its source under fga/model, and its relations as the evaluator's vocabulary", () => {
    const types = readOpenFgaModel(baseModel());
    expect(types.map((t) => t.type)).toEqual(["organization", "identity_account", "doc"]);
    expect(types.map((t) => t.source)).toEqual([
      "fga/model/core.fga",
      "fga/model/core.fga",
      "fga/model/docs/doc.fga",
    ]);
    const doc = types[2];
    expect([...(doc?.relations.keys() ?? [])]).toEqual(["org", "owner", "viewer"]);
    expect(doc?.relations.get("viewer")).toEqual({
      node: "union",
      members: [
        {
          node: "this",
          subjects: [
            { form: "object", type: "identity_account" },
            { form: "userset", type: "organization", relation: "admin" },
          ],
        },
        { node: "computed", relation: "owner" },
        { node: "from", relation: "admin", tupleset: "org" },
      ],
    });
    expect(types[1]?.relations.size).toBe(0);
  });

  it("keeps a union's children in the file's order, and accepts nesting to any depth", () => {
    const types = readOpenFgaModel(
      edited((model) => {
        docOf(model).relations["viewer"] = {
          intersection: {
            child: [
              {
                union: {
                  child: [{ computedUserset: { relation: "owner" } }, { this: {} }],
                },
              },
              {
                tupleToUserset: {
                  computedUserset: { relation: "admin" },
                  tupleset: { relation: "org" },
                },
              },
            ],
          },
        };
      }),
    );
    const viewer = types[2]?.relations.get("viewer");
    expect(viewer?.node).toBe("intersection");
    if (viewer?.node !== "intersection") return;
    expect(viewer.members.map((m) => m.node)).toEqual(["union", "from"]);
    const inner = viewer.members[0];
    expect(inner?.node === "union" ? inner.members.map((m) => m.node) : []).toEqual([
      "computed",
      "this",
    ]);
  });

  describe("refuses what the evaluator does not implement", () => {
    it("a schema version other than 1.2", () => {
      expect(() =>
        readOpenFgaModel(edited((model) => (model.schema_version = "1.1"))),
      ).toThrow("schema_version '1.1' is not 1.2");
    });

    it("conditions", () => {
      expect(() =>
        readOpenFgaModel(edited((model) => (model.conditions = { in_hours: {} }))),
      ).toThrow("conditions are not evaluated by this server");
      expect(() =>
        readOpenFgaModel(
          edited((model) => {
            const types = docOf(model).metadata["owner"]?.directly_related_user_types;
            types?.push({ type: "identity_account", condition: "in_hours" });
          }),
        ),
      ).toThrow("conditional subject types are not evaluated by this server");
    });

    it("a wildcard subject type", () => {
      expect(() =>
        readOpenFgaModel(
          edited((model) => {
            docOf(model).metadata["owner"]?.directly_related_user_types?.push({
              type: "identity_account",
              wildcard: {},
            });
          }),
        ),
      ).toThrow("wildcard subject types are not evaluated by this server");
    });

    it("'but not' (difference)", () => {
      expect(() =>
        readOpenFgaModel(
          edited((model) => {
            docOf(model).relations["owner"] = {
              difference: {
                base: { this: {} },
                subtract: { computedUserset: { relation: "viewer" } },
              },
            };
          }),
        ),
      ).toThrow("'but not' (difference) is not evaluated by this server");
    });

    it("a computed relation on another object", () => {
      expect(() =>
        readOpenFgaModel(
          edited((model) => {
            docOf(model).relations["viewer"] = {
              computedUserset: { object: "doc:x", relation: "owner" },
            };
            delete docOf(model).metadata["viewer"];
          }),
        ),
      ).toThrow("a relation on another object is not evaluated by this server");
    });

    it("an unknown key anywhere, named by where it is", () => {
      expect(() =>
        readOpenFgaModel(edited((model) => Object.assign(model, { id: "01ABC" }))),
      ).toThrow("authorization-model.json: unknown key 'id'");
      expect(() =>
        readOpenFgaModel(
          edited((model) => {
            docOf(model).relations["org"] = { this: { extra: true } };
          }),
        ),
      ).toThrow("relations.org.this: unknown key 'extra'");
    });

    it("a node with more than one form, and an operator with no children", () => {
      expect(() =>
        readOpenFgaModel(
          edited((model) => {
            docOf(model).relations["org"] = { this: {}, computedUserset: { relation: "owner" } };
          }),
        ),
      ).toThrow("a rewrite node has exactly one form, found 2");
      expect(() =>
        readOpenFgaModel(
          edited((model) => {
            docOf(model).relations["viewer"] = { union: { child: [] } };
            delete docOf(model).metadata["viewer"];
          }),
        ),
      ).toThrow("an operator with no children");
    });

    it("a type defined twice", () => {
      expect(() =>
        readOpenFgaModel(
          edited((model) => {
            model.type_definitions.push({
              metadata: { module: "core", source_info: { file: "core.fga" } },
              type: "identity_account",
            });
          }),
        ),
      ).toThrow("type 'identity_account' is defined twice");
    });
  });

  describe("re-asserts what OpenFGA proved, so a hand edit fails at load", () => {
    it("a computed target or a tupleset the type does not define", () => {
      expect(() =>
        readOpenFgaModel(
          edited((model) => {
            docOf(model).relations["owner"] = { computedUserset: { relation: "editor" } };
            delete docOf(model).metadata["owner"];
          }),
        ),
      ).toThrow("doc#owner: names relation 'editor', which doc does not define");
      expect(() =>
        readOpenFgaModel(
          edited((model) => {
            docOf(model).relations["owner"] = {
              tupleToUserset: {
                computedUserset: { relation: "admin" },
                tupleset: { relation: "parent" },
              },
            };
            delete docOf(model).metadata["owner"];
          }),
        ),
      ).toThrow("doc#owner: names tupleset 'parent', which doc does not define");
    });

    it("a subject type the model does not define, or a userset relation its type does not define", () => {
      expect(() =>
        readOpenFgaModel(
          edited((model) => {
            docOf(model).metadata["owner"]?.directly_related_user_types?.push({
              type: "team",
            });
          }),
        ),
      ).toThrow("doc#owner: admits subject type 'team', which the model does not define");
      expect(() =>
        readOpenFgaModel(
          edited((model) => {
            docOf(model).metadata["owner"]?.directly_related_user_types?.push({
              type: "organization",
              relation: "member",
            });
          }),
        ),
      ).toThrow("doc#owner: admits 'organization#member', which organization does not define");
    });

    it("a direct list exactly where the rewrite has a direct node", () => {
      expect(() =>
        readOpenFgaModel(
          edited((model) => {
            delete docOf(model).metadata["owner"];
          }),
        ),
      ).toThrow("relations.owner: a direct relation with no directly_related_user_types");
      expect(() =>
        readOpenFgaModel(
          edited((model) => {
            docOf(model).relations["owner"] = { computedUserset: { relation: "org" } };
          }),
        ),
      ).toThrow("relations.owner: directly_related_user_types on a relation with no direct node");
      expect(() =>
        readOpenFgaModel(
          edited((model) => {
            docOf(model).metadata["editor"] = {
              directly_related_user_types: [{ type: "identity_account" }],
            };
          }),
        ),
      ).toThrow("metadata.relations.editor: metadata for a relation doc does not define");
    });
  });
});
