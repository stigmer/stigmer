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
 * Imported DYNAMICALLY by the roots, after the fetch interceptor is
 * installed: `@cursor/sdk` captures `global.fetch` at import time, and the
 * adapter's modules import the SDK statically.
 */

import { createCursorAdapter } from "./activities/execute-cursor/adapter.js";
import type { HarnessRow } from "./harness/registry.js";

export const HARNESS_ADAPTERS: readonly HarnessRow[] = [{ harness: "cursor", adapter: createCursorAdapter() }];
