/**
 * The harnesses this worker serves: one registry row per adapter, in boot
 * order. The ONE place an adapter's factory is named outside its own
 * directory.
 *
 * Lives at the source root, beside the composition roots that read it, and
 * not in `harness/registry.ts`: a row imports its adapter from
 * `activities/`, and nothing under `src/harness/` may
 * (`harness/__tests__/import-direction.test.ts`; the rule the turn runtime
 * is written under). The registry knows rows, never which adapters exist.
 *
 * ORDER IS LOAD-BEARING (`registry.ts` `bootHarnesses`): the Cursor
 * adapter's interceptors must patch `node:http2` before anything dials the
 * control plane, so it boots first. The native deep-agent harness joins this
 * table at S3 of the harness runtime program; until then both roots import
 * its activities directly beside this table's.
 *
 * THIS MODULE'S STATIC GRAPH MUST STAY CONNECT- AND SDK-FREE. The roots
 * import it BEFORE they boot the harnesses, and the Cursor adapter's boot is
 * where `node:http2` is patched and `@cursor/sdk` first loaded; an adapter
 * factory that imported its SDK statically would defeat both. An adapter
 * named here loads its vendor SDK inside `boot` (`adapter.ts` shows the
 * shape). `__tests__/harness-boot-order.test.ts` boots a fresh process
 * through this module and fails if the graph regresses.
 */

import { createCursorAdapter } from "./activities/execute-cursor/adapter.js";
import type { HarnessRow } from "./harness/registry.js";

export const HARNESS_ADAPTERS: readonly HarnessRow[] = [{ harness: "cursor", adapter: createCursorAdapter() }];
