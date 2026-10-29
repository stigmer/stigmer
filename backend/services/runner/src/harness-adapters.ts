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
 * Boot order is declaration order (`registry.ts` `bootHarnesses`), and
 * shutdown runs in reverse. The native deep-agent adapter boots first; its
 * `boot` registers the deepagents harness profiles and loads LangChain
 * (#1096). The Claude adapter boots second; its `boot` loads the Agent SDK
 * when the runner carries it and records its absence otherwise, so a runner
 * without the engine still serves native. Neither boot depends on the
 * other's.
 *
 * THIS MODULE'S STATIC GRAPH MUST STAY SDK-FREE. The roots import it BEFORE
 * they boot the harnesses, and the runner's own process loads no engine:
 * every engine runs in the agent host (`HOSTED_HARNESSES` below). Every
 * adapter named here loads its vendor SDK inside `boot`
 * (`execute-deep-agent/adapter.ts` shows the shape; the native adapter's
 * `__tests__/adapter-graph-is-sdk-free.test.ts` walks its static graph off
 * the syntax tree). `__tests__/harness-boot-order.test.ts` boots a fresh
 * process through this module — every row — and fails if the runner's
 * process loads an engine's SDK.
 */

import { createClaudeAdapter } from "./activities/execute-claude/adapter.js";
import { createDeepAgentAdapter } from "./activities/execute-deep-agent/adapter.js";
import type { HarnessName, HarnessRow } from "./harness/registry.js";

export const HARNESS_ADAPTERS: readonly HarnessRow[] = [
  { harness: "stigmer", adapter: createDeepAgentAdapter() },
  { harness: "claude", adapter: createClaudeAdapter() },
];

/**
 * The harnesses whose engines run in the agent host, the runner's separate
 * process that holds none of its keys (`agent-host/hosting.ts`, #2016):
 * every one. Each adapter's boot (the engines' SDKs) and its approval hook
 * server run there, and the runner's own process loads no engine
 * (`__tests__/harness-boot-order.test.ts`).
 */
export const HOSTED_HARNESSES: ReadonlySet<HarnessName> = new Set<HarnessName>(["stigmer", "claude"]);
