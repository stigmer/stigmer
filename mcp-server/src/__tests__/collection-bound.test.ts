// The collection bounds a request is held to before schema validation
// (collection-bound.ts, stigmer#2951): one collection's size, and the whole
// body's count of collection items at any depth, since the schema
// library's cost follows the total, whether it sits in one long array,
// nested collections each within the per-collection bound, or a JSON-RPC
// batch. The walk is iterative, so a deep body cannot overflow it.
import { describe, expect, it } from "vitest";

import { MAX_BODY_ITEMS, MAX_COLLECTION_ITEMS, collectionBoundMessage, crossedCollectionBound } from "../collection-bound";

describe("crossedCollectionBound", () => {
  it("passes scalars, and bodies within both bounds", () => {
    for (const body of [null, 1, "x", true, [], {}]) expect(crossedCollectionBound(body)).toBeUndefined();
    expect(crossedCollectionBound(Array(MAX_COLLECTION_ITEMS).fill(0))).toBeUndefined();
    const nine = Array.from({ length: 9 }, () => Array(MAX_COLLECTION_ITEMS - 1).fill(0));
    expect(crossedCollectionBound(nine)).toBeUndefined();
  });

  it("names one collection over its bound, array or object, wherever it is nested", () => {
    expect(crossedCollectionBound(Array(MAX_COLLECTION_ITEMS + 1).fill(0))).toEqual({ bound: "collection", items: MAX_COLLECTION_ITEMS + 1 });
    const keys = Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`k${i}`, i]));
    expect(crossedCollectionBound({ params: { arguments: { env: keys } } }, { collection: 4, body: 100 })).toEqual({ bound: "collection", items: 5 });
  });

  it("refuses nested collections each within the bound when together they cross the body's (the reviewed bypass)", () => {
    // The agent tool's hooks path: groups of handlers of args, each array
    // within 1,000, together millions of elements.
    const handlers = Array.from({ length: MAX_COLLECTION_ITEMS }, () => ({ args: Array(MAX_COLLECTION_ITEMS).fill(1) }));
    const body = { params: { arguments: { hooks: [{ inline: { groups: [{ handlers }, { handlers }] } }] } } };
    expect(crossedCollectionBound(body)?.bound).toBe("body");
    // A JSON-RPC batch of calls, each within the bound.
    const batch = Array.from({ length: 20 }, () => ({ jsonrpc: "2.0", method: "tools/call", params: { arguments: { tags: Array(900).fill(1) } } }));
    expect(crossedCollectionBound(batch)?.bound).toBe("body");
  });

  it("says which bound in the refusal", () => {
    expect(collectionBoundMessage({ bound: "collection", items: 1001 })).toBe(
      `Invalid Request: a collection holds 1001 items, more than ${MAX_COLLECTION_ITEMS}`,
    );
    expect(collectionBoundMessage({ bound: "body", items: 10_001 })).toBe(
      `Invalid Request: the body holds more than ${MAX_BODY_ITEMS} collection items`,
    );
  });

  it("walks a deeply nested body without overflowing the stack", () => {
    let deep: unknown = [];
    for (let i = 0; i < 9_000; i++) deep = [deep];
    expect(crossedCollectionBound(deep)).toBeUndefined();
  });
});
