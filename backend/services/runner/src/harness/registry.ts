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
 * `createHarnessActivities` binds each row to its Temporal activity over the
 * turn runtime (`run-turn.ts`). The table of real rows is NOT here: it lives
 * at the source root (`src/harness-adapters.ts`), because a row imports its
 * adapter from `activities/` and nothing under `src/harness/` may
 * (`__tests__/import-direction.test.ts`; Q-M3-1). The registry knows rows,
 * never which adapters exist.
 *
 * `HarnessName` lives here and not in `types.ts` on purpose: the wire
 * vocabulary is the registry's concern. An adapter never declares the
 * activity it is bound to (its `name` is a diagnostic identity); the registry
 * row does.
 */

import type { Config } from "../config.js";
import { StigmerClient } from "../client/stigmer-client.js";
import { activityFinished, activityStarted } from "../idle-watchdog.js";
import { normalizeActivityInput, type ExecuteActivityInput } from "../shared/activity-input.js";
import { runTurnActivity } from "./run-turn.js";
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

/** One harness the worker serves: the wire name it answers to and the adapter that runs its turns. */
export interface HarnessRow {
  readonly harness: HarnessName;
  readonly adapter: HarnessAdapter;
}

/**
 * The legacy positional activity signature, kept as the wire shape both
 * control planes send until they both send the typed object
 * (`shared/activity-input.ts`). Every harness's activity has it.
 */
export type HarnessActivity = (arg0: ExecuteActivityInput | string, arg1?: string) => Promise<unknown>;

/** The adapters of a row list, for the lifecycle functions below. */
export function adaptersOf(rows: readonly HarnessRow[]): HarnessAdapter[] {
  return rows.map((row) => row.adapter);
}

/**
 * One Temporal activity per row, under the row's byte-pinned name, over ONE
 * `StigmerClient` for all of them (each harness used to build its own). The
 * activity normalizes the wire input, brackets the turn with the idle
 * watchdog, and hands the turn runtime the adapter. The roots spread the
 * result into the worker's activity map beside the activities the runtime
 * does not own.
 */
export function createHarnessActivities(
  rows: readonly HarnessRow[],
  config: Config,
): Partial<Record<HarnessActivityName, HarnessActivity>> {
  const client = new StigmerClient({
    endpoint: config.stigmerBackendEndpoint,
    token: config.stigmerToken,
    tokenRef: config.stigmerTokenRef,
    runnerTokenRef: config.stigmerRunnerTokenRef,
  });
  const activities: Partial<Record<HarnessActivityName, HarnessActivity>> = {};
  for (const row of rows) {
    const activityName = HARNESS_ACTIVITY_NAMES[row.harness];
    const deps = { adapter: row.adapter, activityName, client, config };
    activities[activityName] = async (arg0, arg1) => {
      const input = normalizeActivityInput(arg0, arg1);
      activityStarted();
      try {
        return await runTurnActivity(deps, input);
      } finally {
        activityFinished();
      }
    };
  }
  return activities;
}

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
