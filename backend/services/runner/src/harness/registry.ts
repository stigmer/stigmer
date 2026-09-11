/**
 * The harness registry — the lifecycle fan-out over the adapters a worker
 * runs, and the byte-pinned binding from harness to Temporal activity name.
 *
 * Plain functions over an `adapters` argument, no module state and no DI
 * (the composition roots are staged plain functions; a missing adapter is a
 * compile error or a loud boot throw, never a silent no-op). ORDER IS
 * LOAD-BEARING: `bootHarnesses` runs adapters in declaration order because
 * the Cursor harness's interceptors must patch `node:http2` before anything
 * dials the control plane, and `shutdownHarnesses` runs them in reverse so
 * what was set up last is torn down first.
 *
 * Error posture, ruled at the entry's gate (Q-S1-10):
 *  - Boot validates the whole table BEFORE booting anything (a duplicate name
 *    is a configuration defect, and a half-booted worker is the worst state to
 *    discover it in), then fails fast at the first adapter that rejects. A
 *    worker that cannot boot a harness must not start.
 *  - Shutdown and session release CONTINUE past a failing adapter and throw
 *    one `AggregateError` at the end naming each failure, so one bad teardown
 *    never leaks the others' resources.
 *
 * What is NOT here yet: `createHarnessActivities` (its body is the turn
 * runtime, which does not exist until the extraction entry) and the table of
 * real adapters (they exist once the Cursor and native harnesses implement
 * the contract). Both land with the runtime; no empty table sits on `main`
 * between the two.
 *
 * `HarnessName` lives here and not in `types.ts` on purpose: the wire
 * vocabulary is the registry's concern. An adapter never declares the
 * activity it is bound to (its `name` is a diagnostic identity); the registry
 * row does.
 */

import type { Config } from "../config.js";
import type { HarnessAdapter } from "./types.js";

/** The harnesses the control plane can dispatch to, as the registry knows them. */
export type HarnessName = "cursor" | "deep-agent";

/**
 * Byte-pinned Temporal activity names, one per harness. The server side of
 * the pin is `stigmer-server/src/temporal/agentexecution/names.ts`
 * (`EXECUTE_CURSOR_ACTIVITY_NAME`, `EXECUTE_DEEP_AGENT_ACTIVITY_NAME`); the
 * two must stay byte-identical or the workflow schedules an activity no
 * worker registers. Never "cleaned up".
 */
export const HARNESS_ACTIVITY_NAMES = {
  cursor: "ExecuteCursor",
  "deep-agent": "ExecuteDeepAgent",
} as const satisfies Record<HarnessName, string>;

export type HarnessActivityName = (typeof HARNESS_ACTIVITY_NAMES)[HarnessName];

/**
 * Refuse a table two of whose adapters share a name. Names are the registry's
 * identity for diagnostics and for this check; a duplicate means two adapters
 * would be indistinguishable in every log line and kit message.
 */
function assertUniqueNames(adapters: readonly HarnessAdapter[]): void {
  const seen = new Set<string>();
  for (const adapter of adapters) {
    if (seen.has(adapter.name)) {
      throw new Error(`harness registry: duplicate adapter name '${adapter.name}'; every adapter must have a unique name`);
    }
    seen.add(adapter.name);
  }
}

/**
 * Boot every adapter in declaration order, one at a time, awaiting each. The
 * table is validated first; the first rejection stops the boot and propagates
 * (adapters after it are never booted; adapters before it stay booted for the
 * caller's shutdown path to release).
 */
export async function bootHarnesses(adapters: readonly HarnessAdapter[], config: Config): Promise<void> {
  assertUniqueNames(adapters);
  for (const adapter of adapters) {
    await adapter.boot(config);
  }
}

/**
 * Shut every adapter down in reverse declaration order, continuing past
 * failures. Rejects with one `AggregateError` carrying every failure once all
 * adapters have been given their chance.
 */
export async function shutdownHarnesses(adapters: readonly HarnessAdapter[]): Promise<void> {
  const failures: Error[] = [];
  for (const adapter of [...adapters].reverse()) {
    try {
      await adapter.shutdown();
    } catch (err) {
      failures.push(describeFailure(adapter, "shutdown", err));
    }
  }
  throwIfAny(failures, "harness registry: shutdown failed for one or more adapters");
}

/**
 * Tell every adapter the session is done on this host, in declaration order,
 * continuing past failures. An adapter that parks nothing per session
 * resolves as a no-op; the registry does not know which do.
 */
export async function releaseHarnessSession(adapters: readonly HarnessAdapter[], sessionId: string): Promise<void> {
  const failures: Error[] = [];
  for (const adapter of adapters) {
    try {
      await adapter.releaseSession(sessionId);
    } catch (err) {
      failures.push(describeFailure(adapter, `releaseSession('${sessionId}')`, err));
    }
  }
  throwIfAny(failures, `harness registry: releaseSession('${sessionId}') failed for one or more adapters`);
}

function describeFailure(adapter: HarnessAdapter, call: string, err: unknown): Error {
  const cause = err instanceof Error ? err : new Error(String(err));
  return new Error(`${adapter.name}: ${call} rejected: ${cause.message}`, { cause });
}

function throwIfAny(failures: readonly Error[], message: string): void {
  if (failures.length > 0) throw new AggregateError(failures, `${message}: ${failures.map((f) => f.message).join("; ")}`);
}
