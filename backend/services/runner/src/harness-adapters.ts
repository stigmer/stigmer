/**
 * The harnesses this worker serves: one registry row per adapter, in boot
 * order. The ONE place an adapter's factory is named outside its own
 * directory; both composition roots read this table and nothing else to
 * learn which harnesses exist.
 *
 * Lives at the source root, beside the composition roots that read it, and
 * not in `harness/registry.ts`: a row imports its adapter from
 * `activities/`, and nothing under `src/harness/` may
 * (`harness/__tests__/import-direction.test.ts`; the rule the turn runtime
 * is written under). The registry knows rows, never which adapters exist.
 *
 * ORDER IS LOAD-BEARING (`registry.ts` `bootHarnesses`): the Cursor
 * adapter's interceptors must patch `node:http2` before anything dials the
 * control plane, so it boots first. The native deep-agent adapter boots
 * second; its `boot` registers the deepagents harness profiles and loads
 * LangChain, both after the patch (#1096, 2026-09-13; until then the roots
 * imported the native orchestrator directly beside this table).
 *
 * THIS MODULE'S STATIC GRAPH MUST STAY CONNECT- AND SDK-FREE. The roots
 * import it BEFORE they boot the harnesses, and the Cursor adapter's boot is
 * where `node:http2` is patched and `@cursor/sdk` first loaded; an adapter
 * factory that imported its SDK statically would defeat both. Every adapter
 * named here loads its vendor SDK inside `boot` (`execute-cursor/adapter.ts`
 * and `execute-deep-agent/adapter.ts` show the shape; the native adapter's
 * `__tests__/adapter-graph-is-sdk-free.test.ts` walks its static graph off
 * the syntax tree). `__tests__/harness-boot-order.test.ts` boots a fresh
 * process through this module — both rows — and fails if either graph
 * regresses.
 */

import { createCursorAdapter } from "./activities/execute-cursor/adapter.js";
import { createDeepAgentAdapter } from "./activities/execute-deep-agent/adapter.js";
import type { HarnessRow } from "./harness/registry.js";

export const HARNESS_ADAPTERS: readonly HarnessRow[] = [
  { harness: "cursor", adapter: createCursorAdapter() },
  { harness: "deep-agent", adapter: createDeepAgentAdapter() },
];
