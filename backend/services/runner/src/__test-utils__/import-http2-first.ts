/**
 * Loaded with `--import` into an agent host under test
 * (`__tests__/harness-boot-order.test.ts`): imports `node:http2` as an ESM
 * namespace before anything else, as a stray `@connectrpc/connect-node`
 * import would, which freezes the namespace to the unpatched `connect`. The
 * Cursor adapter's boot in that host must then refuse, naming the facade.
 */

import * as http2 from "node:http2";

void http2.constants;
