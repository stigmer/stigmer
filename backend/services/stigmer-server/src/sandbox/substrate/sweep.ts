/**
 * The open-source idle sweep for the substrate driver: it pauses a
 * session's sandbox after a few idle minutes and suspends it to storage
 * after half an hour, so an idle session holds a stored workspace instead
 * of a running machine. Open source keeps no record of its sandboxes, so
 * the sweep keeps none either and reads what the server already has
 * (SessionActivityReader): a session's executions say whether it is busy
 * and when it was last active.
 *
 * Only session sandboxes sleep. A workflow's sandbox is ensured once,
 * before the workflow starts, and nothing would wake it for the
 * workflow's next activity; a connect sandbox lives for one request. Both
 * end when their run ends (sandbox/steps.ts).
 *
 * Actor names are hashes, so the sweep maps a sandbox back to its session
 * from the driver's own ensures and, for sandboxes this process has not
 * ensured (after a restart, or ensured by another replica), from a scan of
 * every session id. A scan runs at most once per SCAN_INTERVAL_MS, and a
 * sandbox no scan has named is an orphan only when a scan that began after
 * the sandbox was created still did not name it; until then it is left
 * alone, so a session created through another replica since the last scan
 * is never mistaken for one. An orphan (its session is gone and its delete
 * failed) is suspended and logged, never deleted: deleting a workspace is
 * the session delete's act, and a wrong scan must cost a stored archive,
 * not a user's files.
 *
 * Each action is decided twice: once from the pass's reads, then again
 * inside the driver's per-actor queue right before the call, from fresh
 * reads. A pause is followed by one more busy check: every turn's
 * execution is saved before its ensure runs (the create chain persists,
 * starts the workflow, then ensures), so a turn that began while the
 * pause was in flight shows as busy here and the sweep resumes the
 * sandbox at once. That closes the race with a turn on another server
 * replica too, for pauses. For suspends it does not: a turn whose push
 * lands on another replica in the moment between this replica's last
 * check and its suspend loses its runner and times out; the user's next
 * message wakes the sandbox again. Every suspend comes from PAUSED, so
 * the window is that narrow.
 *
 * Each pass also makes the egress policy of every running or paused
 * sandbox this configuration's, once per process (driver.ts), moves
 * suspended sandboxes on an older template to the current one, and retires
 * templates no sandbox uses.
 */
import type { Logger } from "../../boot/logger.js";
import { sandboxBaseName } from "../naming.js";
import type {
  SandboxBackgroundHandle,
  SessionActivity,
  SessionActivityReader,
} from "../provisioner.js";
import type {
  SubstrateDriverInternals,
  SubstrateSandboxLifecycle,
} from "./driver.js";
import { ActorState } from "./gen/ateapipb/ateapi_pb.js";
import type { SubstrateActorView } from "./gateway.js";
import { decideIdle, type IdleAction } from "./idle-decision.js";
import { CLOCK_SKEW_ALLOWANCE_MS } from "./limits.js";

/** The fewest milliseconds between two scans of every session id. */
export const SCAN_INTERVAL_MS = 10 * 60_000;
/** Every session sandbox's name starts so (naming.ts, the session scope's code). */
const SESSION_ACTOR_PREFIX = "sbx-ses-";

export interface SubstrateSweepOptions {
  readonly driver: SubstrateDriverInternals;
  readonly lifecycle: SubstrateSandboxLifecycle;
  readonly sessions: SessionActivityReader;
  readonly logger: Logger;
  readonly now?: () => number;
  /** True once the sweep is stopping: a pass ends between sandboxes. */
  readonly stopping?: () => boolean;
}

/** What one sweep keeps between passes. */
export interface SweepState {
  lastScanStartedAt: number | undefined;
}

export function newSweepState(): SweepState {
  return { lastScanStartedAt: undefined };
}

/** Starts the sweep: one pass now, then one per interval, never two at once. */
export function startSubstrateSweep(
  options: SubstrateSweepOptions,
): SandboxBackgroundHandle {
  const { driver, logger } = options;
  const state = newSweepState();
  let running: Promise<void> | undefined;
  let stopped = false;

  // Prepare the template in the background, so the first turn rarely waits
  // for its golden snapshot; a failure is logged and the next ensure retries.
  driver.keeper.ready().catch((error: unknown) => {
    logger.error(
      "Substrate template preparation failed; the next sandbox ensure retries it",
      {
        template: driver.keeper.name,
        error: error instanceof Error ? error.message : String(error),
      },
    );
  });

  const tick = (): void => {
    if (stopped || running !== undefined) return;
    running = runSweepPass(state, { ...options, stopping: () => stopped })
      .catch((error: unknown) => {
        logger.error("Substrate idle sweep pass failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        running = undefined;
      });
  };
  const timer = setInterval(tick, driver.settings.sweepIntervalSeconds * 1000);
  timer.unref();
  tick();

  return {
    async stop() {
      stopped = true;
      clearInterval(timer);
      await running;
    },
  };
}

/** One pass over every sandbox in this server's atespace. */
export async function runSweepPass(
  state: SweepState,
  options: SubstrateSweepOptions,
): Promise<void> {
  const { driver, sessions, logger } = options;
  const now = options.now ?? Date.now;
  const actors = await driver.gateway.listActors();

  const awake = actors.filter(
    (actor) =>
      actor.name.startsWith(SESSION_ACTOR_PREFIX) &&
      (actor.state === ActorState.RUNNING || actor.state === ActorState.PAUSED),
  );
  const unnamed = awake.filter(
    (actor) => !driver.sessionByActor.has(actor.name),
  );
  const needsScan = unnamed.some(
    (actor) =>
      state.lastScanStartedAt === undefined ||
      createdAfter(actor, state.lastScanStartedAt),
  );
  if (
    needsScan &&
    (state.lastScanStartedAt === undefined ||
      now() - state.lastScanStartedAt >= SCAN_INTERVAL_MS)
  ) {
    await scanSessions(state, options);
  }

  for (const actor of actors) {
    // A shutdown waits for the sandbox in hand, never for the whole pass.
    if (options.stopping?.() === true) return;
    try {
      if (actor.state === ActorState.DELETING) {
        // A delete that failed part-way leaves the actor DELETING; deleting
        // again resumes it (Substrate's API guide).
        await driver.serialize(actor.name, () =>
          driver.gateway.deleteActor(actor.name),
        );
        continue;
      }
      if (actor.state === ActorState.SUSPENDED) {
        if (actor.template !== driver.keeper.name) {
          await driver.serialize(actor.name, async () => {
            const fresh = await driver.gateway.getActor(actor.name);
            if (fresh?.state === ActorState.SUSPENDED)
              await driver.moveToCurrent(fresh);
          });
        }
        continue;
      }
      if (
        actor.state === ActorState.RUNNING ||
        actor.state === ActorState.PAUSED
      ) {
        // Any scope: a sandbox awake since before this process started gets
        // this configuration's egress rules now, not at its next wake.
        await driver.serialize(actor.name, () =>
          driver.reconcileEgress(actor.name),
        );
      }
      if (!awake.includes(actor)) continue;

      const sessionId = driver.sessionByActor.get(actor.name);
      if (sessionId === undefined) {
        if (
          state.lastScanStartedAt !== undefined &&
          !createdAfter(actor, state.lastScanStartedAt)
        ) {
          await suspendOrphan(actor, options);
        }
        continue;
      }
      const action = decide(
        actor,
        await sessions.activity(sessionId),
        driver,
        now(),
      );
      if (action !== "none") {
        await act(actor.name, sessionId, action, options, now);
      }
    } catch (error) {
      logger.warn("Substrate idle sweep skipped a sandbox", {
        actor: actor.name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (options.stopping?.() === true) return;
  await options.lifecycle.retireTemplates();
}

/** Whether a sandbox may be newer than `instant`, leaning that way by the clock-skew allowance. */
function createdAfter(actor: SubstrateActorView, instant: number): boolean {
  return (
    actor.createTime === undefined ||
    actor.createTime.getTime() >= instant - CLOCK_SKEW_ALLOWANCE_MS
  );
}

/** Maps every session's sandbox name back to it (the inverse of naming.ts's derivation). */
async function scanSessions(
  state: SweepState,
  options: SubstrateSweepOptions,
): Promise<void> {
  const { driver, sessions, logger } = options;
  const now = options.now ?? Date.now;
  const started = now();
  let count = 0;
  for await (const sessionId of sessions.sessionIds()) {
    driver.sessionByActor.set(sandboxBaseName("session", sessionId), sessionId);
    count += 1;
  }
  state.lastScanStartedAt = started;
  logger.info("Substrate idle sweep scanned sessions", {
    sessions: count,
    ms: now() - started,
  });
}

function decide(
  actor: SubstrateActorView,
  activity: SessionActivity,
  driver: SubstrateDriverInternals,
  now: number,
): IdleAction {
  const stamps = [
    activity.lastActiveAt?.getTime(),
    driver.lastEnsuredAt(actor.name)?.getTime(),
    actor.createTime?.getTime(),
  ].filter((ms): ms is number => ms !== undefined);
  return decideIdle({
    state: actor.state,
    busy: activity.busy,
    lastActiveAt: new Date(stamps.length > 0 ? Math.max(...stamps) : now),
    now: new Date(now),
    pauseAfterMs: driver.settings.pauseAfterSeconds * 1000,
    suspendAfterMs: driver.settings.suspendAfterSeconds * 1000,
  });
}

/** Re-decides inside the actor's queue from fresh reads, then acts (module header). */
async function act(
  name: string,
  sessionId: string,
  planned: IdleAction,
  options: SubstrateSweepOptions,
  now: () => number,
): Promise<void> {
  const { driver, sessions, logger } = options;
  await driver.serialize(name, async () => {
    const actor = await driver.gateway.getActor(name);
    if (actor === undefined) return;
    if (
      decide(actor, await sessions.activity(sessionId), driver, now()) !==
      planned
    )
      return;
    if (planned === "pause") {
      await driver.gateway.pauseActor(name);
      if ((await sessions.activity(sessionId)).busy) {
        await driver.gateway.resumeActor(name);
        logger.info("A turn arrived while its sandbox paused; resumed it", {
          actor: name,
          sessionId,
        });
        return;
      }
      logger.info("Substrate sandbox paused (idle)", {
        actor: name,
        sessionId,
      });
      return;
    }
    await driver.gateway.suspendActor(name);
    logger.info("Substrate sandbox suspended (idle)", {
      actor: name,
      sessionId,
    });
  });
}

async function suspendOrphan(
  actor: SubstrateActorView,
  options: SubstrateSweepOptions,
): Promise<void> {
  const { driver, logger } = options;
  await driver.serialize(actor.name, async () => {
    // An ensure that named it while this waited in the queue wins.
    if (driver.sessionByActor.has(actor.name)) return;
    await driver.gateway.suspendActor(actor.name);
    logger.error(
      "Substrate sandbox belongs to no session; suspended it (its workspace is kept)",
      { actor: actor.name },
    );
  });
}
