/**
 * The bound a request's JSON collections are held to before any schema
 * validates them (stigmer#2951).
 *
 * The tool input schemas are checked by a schema library that records one
 * issue per failing element of an array or record (zod 3, which has no
 * release patched for it; #2871 moves to zod 4). So a body at the handler's
 * byte cap holding millions of wrong-typed elements costs memory in
 * proportion to the element count, about 1.4 GiB at 10 MiB, before any tool
 * runs. No tool input needs a collection anywhere near this bound (an
 * agent's tags, tools, plugins, MCP servers, hooks), nor does a JSON-RPC
 * batch, so a larger one is refused as an invalid request.
 *
 * The walk is iterative, so the bound check itself cannot overflow the
 * stack on a deeply nested body.
 */

/** The most elements an array, or keys an object, may hold anywhere in a request. */
export const MAX_COLLECTION_ITEMS = 1000;

/** The size of the first collection over the bound, or undefined when every collection is within it. */
export function oversizedCollection(body: unknown, max: number = MAX_COLLECTION_ITEMS): number | undefined {
  const pending: unknown[] = [body];
  while (pending.length > 0) {
    const value = pending.pop();
    if (value === null || typeof value !== "object") continue;
    const items: unknown[] = Array.isArray(value) ? value : Object.values(value);
    if (items.length > max) return items.length;
    for (const item of items) {
      if (item !== null && typeof item === "object") pending.push(item);
    }
  }
  return undefined;
}
