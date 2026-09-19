/**
 * The one Node-bound piece of the egress module: a `LookupFn` over
 * `node:dns/promises`. Kept in its own file so the judgement (`check.ts`,
 * `address.ts`) stays free of I/O and a test composes the check with a
 * table instead of a resolver.
 *
 * `all: true` because the check must judge every address a name has;
 * `verbatim: true` so the resolver's order is kept rather than re-sorted,
 * which keeps the refusal's named address the one a socket would have
 * taken first.
 */
import { lookup } from "node:dns/promises";

import type { LookupFn } from "./check.js";

/** Resolve through the process's resolver, every record, in resolver order. */
export function nodeLookup(): LookupFn {
  return async (hostname) => {
    const records = await lookup(hostname, { all: true, verbatim: true });
    return records.map((record) => record.address);
  };
}
