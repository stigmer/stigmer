/**
 * The harness registry — the lifecycle fan-out over the adapters a worker
 * runs, and the byte-pinned binding from harness to Temporal activity name.
 *
 * Plain functions over an `adapters` argument, no module state and no DI
 * (the composition roots are staged plain functions; a missing adapter is a
 * compile error or a loud boot throw, never a silent no-op).
 * `bootHarnesses` runs adapters in declaration order, and
 * `shutdownHarnesses` runs them in reverse so what was set up last is torn
 * down first.
 *
 * Error posture (fixed in #1064):
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
 * (`__tests__/import-direction.test.ts`). The registry knows rows,
 * never which adapters exist.
 *
 * `HarnessName` lives here and not in `types.ts` on purpose: the wire
 * vocabulary is the registry's concern. An adapter never declares the
 * activity it is bound to (its `name` is a diagnostic identity); the registry
 * row does.
 *
 * Both composition roots import this module BEFORE they boot the
 * harnesses, so its static graph stays small: `StigmerClient` (and with it
 * `@connectrpc/connect-node`) is loaded with a dynamic import inside
 * `createHarnessActivities`, which the roots call once the harnesses have
 * booted. `__tests__/harness-boot-order.test.ts` boots a fresh process
 * through this module.
 */

import {
  EXECUTE_CLAUDE_ACTIVITY_NAME,
  EXECUTE_DEEP_AGENT_ACTIVITY_NAME,
} from "@stigmer/temporal-codecs/activity-names";

import type { Config } from "../config.js";
import type { StigmerClient } from "../client/stigmer-client.js";
import { activityFinished, activityStarted } from "../idle-watchdog.js";
import { normalizeActivityInput, type ExecuteActivityInput } from "../shared/activity-input.js";
import { runTurnActivity } from "./run-turn.js";
import type { HarnessAdapter } from "./types.js";

/** The harnesses the control plane can dispatch to, as the registry knows them. */
export type HarnessName = "stigmer" | "claude";

/**
 * The Temporal activity name each harness answers to. The names are
 * declared once, in `@stigmer/temporal-codecs/activity-names`, which the
 * server's workflow schedules by too: a split would leave the workflow
 * scheduling an activity no worker registers. A harness gets its entry
 * with its adapter row, since only a row is ever looked up.
 */
export const HARNESS_ACTIVITY_NAMES = {
  stigmer: EXECUTE_DEEP_AGENT_ACTIVITY_NAME,
  claude: EXECUTE_CLAUDE_ACTIVITY_NAME,
} as const satisfies Record<HarnessName, string>;

export type HarnessActivityName = (typeof HARNESS_ACTIVITY_NAMES)[HarnessName];

/** One harness the worker serves: the wire name it answers to and the adapter that runs its turns. */
export interface HarnessRow {
  readonly harness: HarnessName;
  readonly adapter: HarnessAdapter;
}

/** Every harness's activity signature: the typed object (`shared/activity-input.ts`). */
export type HarnessActivity = (input: ExecuteActivityInput) => Promise<unknown>;

/** The row serving `harness`; a harness the table lacks is a wiring defect, so it throws. */
export function harnessRowFor(rows: readonly HarnessRow[], harness: HarnessName): HarnessRow {
  const row = rows.find((r) => r.harness === harness);
  if (!row) throw new Error(`harness registry: no adapter serves '${harness}'`);
  return row;
}

/** The adapters of a row list, for the lifecycle functions below. */
export function adaptersOf(rows: readonly HarnessRow[]): HarnessAdapter[] {
  return rows.map((row) => row.adapter);
}

/**
 * One Temporal activity per row, under the row's byte-pinned name, over ONE
 * `StigmerClient` for all of them. The
 * activity normalizes the wire input, brackets the turn with the idle
 * watchdog, and hands the turn runtime the adapter. The roots spread the
 * result into the worker's activity map beside the activities the runtime
 * does not own.
 *
 * Async because the client is loaded here, not at the top of the module (see
 * the header): the roots call this after the harnesses have booted.
 */
export async function createHarnessActivities(
  rows: readonly HarnessRow[],
  config: Config,
): Promise<Partial<Record<HarnessActivityName, HarnessActivity>>> {
  const { StigmerClient } = await import("../client/stigmer-client.js");
  const client: StigmerClient = new StigmerClient({
    endpoint: config.stigmerBackendEndpoint,
    tokenRef: config.stigmerTokenRef,
    runnerTokenRef: config.stigmerRunnerTokenRef,
  });
  const activities: Partial<Record<HarnessActivityName, HarnessActivity>> = {};
  for (const row of rows) {
    const activityName = HARNESS_ACTIVITY_NAMES[row.harness];
    const deps = { adapter: row.adapter, activityName, client, config };
    activities[activityName] = async (wire) => {
      const input = normalizeActivityInput(wire);
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
