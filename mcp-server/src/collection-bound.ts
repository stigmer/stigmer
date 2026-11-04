/**
 * The bound a request's JSON collections are held to before any schema
 * validates them (stigmer#2951).
 *
 * The tool input schemas are checked by a schema library that records one
 * issue per failing element of an array or record (zod 3, which has no
 * release patched for it; #2871 moves to zod 4). So a body at the handler's
 * byte cap holding millions of wrong-typed elements costs memory in
 * proportion to the element count, about 1.4 GiB at 10 MiB, before any tool
 * runs. The cost follows the total number of elements, wherever they sit:
 * one long array, collections nested in collections, or a JSON-RPC batch
 * of calls. So two bounds hold together:
 *
 *   - the whole body holds at most MAX_BODY_ITEMS collection items (every
 *     array element and every object key, counted once, at any depth);
 *   - no one collection holds more than MAX_COLLECTION_ITEMS.
 *
 * No tool input needs anything near either (an agent's tags, tools,
 * plugins, MCP servers and hooks are each a handful), nor does a batch.
 * The walk is iterative and stops at the first bound crossed, so the check
 * itself neither overflows the stack on a deep body nor walks a huge one
 * whole.
 */

/** The most elements an array, or keys an object, may hold anywhere in a request. */
export const MAX_COLLECTION_ITEMS = 1000;

/** The most collection items (array elements and object keys) a whole request may hold. */
export const MAX_BODY_ITEMS = 10_000;

/** Which bound a body crossed, with the count that crossed it. */
export type CollectionBoundCrossed =
  | { readonly bound: "collection"; readonly items: number }
  | { readonly bound: "body"; readonly items: number };

/** The first bound the body crosses, or undefined when it holds within both. */
export function crossedCollectionBound(
  body: unknown,
  limits: { readonly collection: number; readonly body: number } = {
    collection: MAX_COLLECTION_ITEMS,
    body: MAX_BODY_ITEMS,
  },
): CollectionBoundCrossed | undefined {
  const pending: unknown[] = [body];
  let total = 0;
  while (pending.length > 0) {
    const value = pending.pop();
    if (value === null || typeof value !== "object") continue;
    const items: unknown[] = Array.isArray(value) ? value : Object.values(value);
    if (items.length > limits.collection) return { bound: "collection", items: items.length };
    total += items.length;
    if (total > limits.body) return { bound: "body", items: total };
    for (const item of items) {
      if (item !== null && typeof item === "object") pending.push(item);
    }
  }
  return undefined;
}

/** The refusal's message for a crossed bound. */
export function collectionBoundMessage(crossed: CollectionBoundCrossed): string {
  return crossed.bound === "collection"
    ? `Invalid Request: a collection holds ${crossed.items} items, more than ${MAX_COLLECTION_ITEMS}`
    : `Invalid Request: the body holds more than ${MAX_BODY_ITEMS} collection items`;
}
