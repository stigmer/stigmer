// Pins the canonical form of an OpenFGA model (canonical.ts): what proto3
// JSON omits is dropped, what changes the model's meaning is kept, keys
// are sorted and arrays keep their order. Each case is a shape a real
// producer emits: the JavaScript parser's empty lists and empty
// `conditions` map, OpenFGA's read-back's empty strings and nulls, and the
// `"this": {}` every direct relation carries.
import { describe, expect, it } from "vitest";

import { canonicalize, formatCanonical, minifyCanonical } from "./canonical.js";

describe("canonicalize", () => {
  it("drops the unpopulated fields each producer emits", () => {
    expect(
      canonicalize({
        schema_version: "1.2",
        conditions: {},
        type_definitions: [
          {
            type: "doc",
            relations: { viewer: { this: {} } },
            metadata: {
              module: "",
              source_info: null,
              relations: { viewer: { directly_related_user_types: [] } },
            },
          },
        ],
      }),
    ).toEqual({
      schema_version: "1.2",
      type_definitions: [
        {
          metadata: { relations: { viewer: {} } },
          relations: { viewer: { this: {} } },
          type: "doc",
        },
      ],
    });
  });

  it("keeps an empty message: the direct marker and a relation's empty metadata", () => {
    expect(canonicalize({ relations: { owner: { this: {} } } })).toEqual({
      relations: { owner: { this: {} } },
    });
    expect(canonicalize({ metadata: { relations: { can_view: {} } } })).toEqual({
      metadata: { relations: { can_view: {} } },
    });
  });

  it("drops an empty map field, and a type with no relations loses the key", () => {
    expect(canonicalize({ type: "user", relations: {}, metadata: null })).toEqual({
      type: "user",
    });
  });

  it("decides what is a map by the field, never by a map's own keys", () => {
    // A relation named like a map field is data: its empty metadata stays.
    expect(
      canonicalize({ metadata: { relations: { relations: {}, parameters: {} } } }),
    ).toEqual({ metadata: { relations: { relations: {}, parameters: {} } } });
  });

  it("sorts keys at every level and keeps array order", () => {
    const rendered = minifyCanonical({
      union: { child: [{ computedUserset: { relation: "owner" } }, { this: {} }] },
      a: { z: 1, b: 2 },
    });
    expect(rendered).toBe(
      '{"a":{"b":2,"z":1},"union":{"child":[{"computedUserset":{"relation":"owner"}},{"this":{}}]}}',
    );
  });

  it("refuses what is not JSON, and an unpopulated list element", () => {
    expect(() => canonicalize({ n: Number.NaN })).toThrow("$.n is not a finite number");
    expect(() => canonicalize({ child: [{ this: {} }, null] })).toThrow(
      "$.child[1] is an unpopulated list element",
    );
    expect(() => canonicalize("")).toThrow("the model is empty");
  });
});

describe("formatCanonical", () => {
  it("is two-space indented with a trailing newline", () => {
    expect(formatCanonical({ type: "user", relations: {} })).toBe('{\n  "type": "user"\n}\n');
  });
});
