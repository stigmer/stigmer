/**
 * The open-source idle sweep for the substrate driver: it suspends a
 * session's sandbox after its idle window (config.ts: 300 s by default, on
 * a pass every 30 s), which keeps its workspace on its node and copies it
 * to storage in the background, so an idle session holds a stored
 * workspace instead of a running machine. Open source keeps no record of its sandboxes, so
 * the sweep keeps none either and reads what the server already has
 * (SessionActivityReader): a session's executions say whether it is busy
 * and when it was last active. Busy means a run is working; a turn parked
 * on a person's answer or a pause is not, so its sandbox sleeps after the
 * window like any idle one, and the run workflow asks for it again before
 * the turn carries on (stigmer#3122).
 *
 * Only session sandboxes sleep. A connect sandbox lives for one request
 * and ends when the connect settles (domain/plugin/tools/sandbox.ts).
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
 * reads. The pass reads only what changed in the session since its last
 * look (SessionActivityReader.recentActivity), which may lag a
 * recovered run but never makes a session look busier or later than it
 * is; the second decision reads the session's every execution, so a lag
 * can only cost an act that the second decision refuses. A suspend is
 * followed by one more busy check: every turn's execution is saved
 * before its ensure runs (the create chain persists, starts the
 * workflow, then ensures), and a parked turn that carries on reads
 * IN_PROGRESS before its workflow asks again (a resume and a recovery
 * write it first; after an answer the workflow writes it itself), so a
 * turn that began or carried on while the suspend was in flight shows as
 * busy here and the sweep wakes the sandbox again at
 * once, a fresh runner that turn's ensure pushes to. A turn on another
 * server replica whose push lands in the moment between this replica's
 * last check and its suspend loses its runner and times out (a suspend
 * keeps no runner, template.ts); the user's next message wakes the
 * sandbox again. The check sits right before the call, so the window is
 * that narrow.
 *
 * A worker leaving. Each pass asks the driver which running sandboxes sit
 * on a draining worker (driver.ts, "Workers leaving"), and the decision
 * (idle-decision.ts) stores each one, a durable suspend, as soon as its
 * session is not busy, whatever its idle window, or once the drain
 * deadline has passed; its next message wakes it on a healthy worker,
 * with its files. A store past the deadline ends the turn in flight (a
 * suspend keeps no runner), so it is not thawed for that turn: there is
 * no runner left to hand it, and the session's next message wakes the
 * sandbox. An orphan on a draining worker is stored too. A pass that
 * cannot read the workers warns once and runs the ladder as before.
 *
 * The act re-decides inside the actor's queue, as every act does, and
 * stores only while the sandbox is still on the worker that was draining:
 * one stored and woken again by a new turn since the pass read it runs on
 * a healthy worker, and is the ladder's again. Stores run one at a time,
 * like every act of a pass, each waiting for its upload. So when a roll
 * drains many workers at once, the sandboxes still busy at the deadline
 * share the last ten of Substrate's thirty minutes one upload after
 * another, and on a large enough install the last of them can still be
 * lost; the self-hosting guide says so.
 *
 * An older configuration. A sandbox awake on another template than the
 * driver's current one was started under another configuration, which
 * may have granted it network lanes this server no longer does: a release
 * or a development build that narrowed them, or an operator who did
 * (template.ts names the template by those lanes too). The decision
 * suspends it as soon as its session is not busy, whatever its idle
 * window, and logs it apart from an idle suspend, naming both templates.
 * The next pass's upkeep moves it to the current template, and its next
 * wake writes the current policy (stigmer#2984). The pass and the act
 * each read the template from the actor they judge, so one a turn moved
 * in between is left alone. During a rolling update a replica still on
 * the old configuration sees the new template as the other one and may
 * put a sandbox to sleep that a new replica woke; it costs that sandbox a
 * wake, never its files, as a turn's move between configurations does
 * (driver.ts).
 *
 * A routine's fire. A session a routine's fire started
 * (SessionActivity.routineFire) is suspended as soon as it is not busy,
 * whatever its idle window, and logged apart (idle-decision.ts).
 *
 * Making room for a waiting run. When a run waits because no worker has
 * room, its workflow's ask calls the provisioner's `makeRoom`
 * (provisioner.ts), which the built-in answers here (builtin.ts). It
 * chooses from the last pass's listing of awake session sandboxes and
 * draining ones, so an ask usually costs no Substrate listing. When that
 * listing offers nothing that would yield (before the first pass, or when
 * every awake sandbox started since it was read, as a fleet filling up
 * within one interval does), it lists Substrate once and chooses again;
 * an ask that cannot read which workers are leaving then makes no room.
 * It leaves out the waiting session's own sandbox,
 * every one it cannot map to a session and every one on a leaving worker,
 * reads each session's cheap activity, and orders them with the shared
 * decision (../make-room.ts): plain idle before parked, longest idle
 * first, by the same last-active clock the ladder uses. It then suspends
 * the first whose guarded suspend lands, and stops: one sandbox per ask.
 * Its guard is its own, not the ladder's re-decision, which would refuse
 * every sandbox inside its idle window: inside the actor's queue it
 * proceeds only while the sandbox is still running on the worker it was
 * listed on, that worker is not leaving by a fresh read (a listing can be
 * an interval old, and a pass's read of the leaving workers can fail; a
 * fresh read that fails refuses), and a fresh full read says its session
 * is not busy, and after
 * the suspend it thaws the sandbox when a turn arrived, as every guarded
 * suspend does. A sandbox that slept or moved since the listing, or that a
 * turn took, is skipped for the next; a second replica choosing the same
 * one finds it no longer running. The ordinary suspend keeps the
 * workspace, so the slept session's next message wakes it with its files.
 * A sandbox this replica cannot map to a session is never chosen: with
 * several server replicas, one another replica started since this one's
 * last scan of the sessions (at most SCAN_INTERVAL_MS ago) waits for that
 * scan before it can yield here, while the waiting run asks on.
 *
 * The suspend itself, and every pass's upkeep (a sleeping sandbox moved
 * to the current template, unused templates retired, a stuck delete
 * repeated; no egress policy, which only an ensure writes), are the driver's lifecycle
 * operations, the same ones a composition with its own sweep calls
 * (driver.ts); this sweep holds only the decision of what is idle and the
 * map from sandboxes to sessions. Upkeep returns the sandboxes it failed
 * on rather than logging each, and the sweep sums them in one warning per
 * pass: a delete Substrate keeps refusing is repeated every pass, and a
 * line per sandbox per pass is one nobody can count.
 */
import type { Logger } from "../../boot/logger.js";
import { orderSandboxesToFree, type MakeRoomCandidate } from "../make-room.js";
import { sandboxBaseName } from "../naming.js";
import type {
  SandboxBackgroundHandle,
  SessionActivity,
  SessionActivityReader,
} from "../provisioner.js";
import type {
  SubstrateActorSummary,
  SubstrateDrainingSandbox,
  SubstrateDriverInternals,
  SubstrateMaintenance,
  SubstrateSandboxLifecycle,
} from "./driver.js";
import { decideIdle, type IdleAction } from "./idle-decision.js";
import { CLOCK_SKEW_ALLOWANCE_MS } from "./limits.js";

/** The fewest milliseconds between two scans of every session id. */
export const SCAN_INTERVAL_MS = 10 * 60_000;
/** Every session sandbox's name starts so (naming.ts, the session scope's code). */
const SESSION_ACTOR_PREFIX = "sbx-ses-";
/** How many failed sandboxes a pass's upkeep warning names; the count covers all. */
const UPKEEP_FAILURES_SAMPLED = 5;
/** Substrate's workflow errors run to several hundred characters; a sample keeps their start. */
const UPKEEP_ERROR_MAX_LENGTH = 300;

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
  /** The last pass's awake session sandboxes and draining ones, which make-room chooses from (module header). */
  listing: SweepListing | undefined;
}

/** The awake session sandboxes one pass listed, and the draining ones by name. */
export interface SweepListing {
  readonly awake: readonly SubstrateActorSummary[];
  readonly draining: ReadonlyMap<string, Drain>;
}

export function newSweepState(): SweepState {
  return { lastScanStartedAt: undefined, listing: undefined };
}

/** A started sweep: its background handle, and make-room over its last listing. */
export interface SubstrateSweepHandle extends SandboxBackgroundHandle {
  /** Puts one idle sandbox to sleep for the waiting session (module header); false once stopping. */
  makeRoom(forSessionId: string): Promise<boolean>;
}

/** Starts the sweep: one pass now, then one per interval, never two at once. */
export function startSubstrateSweep(
  options: SubstrateSweepOptions,
): SubstrateSweepHandle {
  const { driver, lifecycle, logger } = options;
  const state = newSweepState();
  let running: Promise<void> | undefined;
  let stopped = false;

  // Prepare the template in the background, so the first turn rarely waits
  // for its golden snapshot; prepare() logs a failure and never rejects.
  void lifecycle.prepare();

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
    makeRoom: (forSessionId) =>
      stopped
        ? Promise.resolve(false)
        : makeRoom(state, { ...options, stopping: () => stopped }, forSessionId),
  };
}

/** One pass over every sandbox in this server's atespace. */
export async function runSweepPass(
  state: SweepState,
  options: SubstrateSweepOptions,
): Promise<void> {
  const { driver, lifecycle, sessions, logger } = options;
  const now = options.now ?? Date.now;
  const stopping = options.stopping ?? (() => false);
  const actors = await lifecycle.list();
  const draining = await leaving(options);

  const awake = awakeSessions(actors);
  state.listing = { awake, draining };
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

  for (const actor of awake) {
    // A shutdown waits for the sandbox in hand, never for the whole pass.
    if (stopping()) return;
    try {
      const sessionId = driver.sessionByActor.get(actor.name);
      if (sessionId === undefined) {
        if (
          state.lastScanStartedAt !== undefined &&
          !createdAfter(actor, state.lastScanStartedAt)
        ) {
          await suspendOrphan(actor, draining.has(actor.name), options);
        }
        continue;
      }
      const drain = draining.get(actor.name);
      const action = decide(
        actor,
        await sessions.recentActivity(sessionId),
        options,
        now(),
        drain?.since,
      );
      if (action !== "none") {
        await act(sessionId, action, drain, options, now);
      }
    } catch (error) {
      logger.warn("Substrate idle sweep skipped a sandbox", {
        actor: actor.name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (stopping()) return;
  logUpkeepFailures(await lifecycle.maintain(actors, { stopping }), logger);
}

/** The awake session sandboxes of a listing. */
function awakeSessions(
  actors: readonly SubstrateActorSummary[],
): SubstrateActorSummary[] {
  return actors.filter(
    (actor) =>
      actor.name.startsWith(SESSION_ACTOR_PREFIX) && actor.state === "running",
  );
}

/** A sandbox's drain as the pass read it: its worker, and when the driver first saw that worker draining. */
export interface Drain {
  readonly worker: string | undefined;
  readonly since: Date;
}

/**
 * The running sandboxes on a draining worker, by name, each with its
 * drain; empty, after one warning, when the workers cannot be read this
 * pass (module header).
 */
async function leaving(
  options: SubstrateSweepOptions,
): Promise<Map<string, Drain>> {
  try {
    return new Map(
      (await options.lifecycle.draining()).map((sandbox) => [
        sandbox.actor.name,
        { worker: sandbox.actor.worker, since: sandbox.drainingSince },
      ]),
    );
  } catch (error) {
    options.logger.warn(
      "Substrate idle sweep could not read which workers are leaving; this pass protects no sandbox from one",
      { error: error instanceof Error ? error.message : String(error) },
    );
    return new Map();
  }
}

/** One warning for every sandbox a pass's upkeep failed on: a count and a capped sample. */
function logUpkeepFailures(upkeep: SubstrateMaintenance, logger: Logger): void {
  if (upkeep.failed.length === 0) return;
  logger.warn(
    "Substrate idle sweep could not keep up sandboxes; each is tried again next pass",
    {
      count: upkeep.failed.length,
      sample: upkeep.failed
        .slice(0, UPKEEP_FAILURES_SAMPLED)
        .map((failure) => ({
          actor: failure.name,
          state: failure.state,
          since: failure.since,
          error: failure.error.slice(0, UPKEEP_ERROR_MAX_LENGTH),
        })),
    },
  );
}

/** Whether a sandbox may be newer than `instant`, leaning that way by the clock-skew allowance. */
function createdAfter(actor: SubstrateActorSummary, instant: number): boolean {
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

/**
 * The decision for one sandbox as `actor` shows it: the pass's listing, or
 * the act's fresh read inside the queue, so a sandbox a turn moved to the
 * current template in between is no longer outdated.
 */
function decide(
  actor: SubstrateActorSummary,
  activity: SessionActivity,
  options: SubstrateSweepOptions,
  now: number,
  drainingSince: Date | undefined,
): IdleAction {
  const { driver, lifecycle } = options;
  return decideIdle({
    state: actor.state,
    busy: activity.busy,
    lastActiveAt: lastActiveOf(actor, activity, driver, now),
    now: new Date(now),
    suspendAfterMs: driver.settings.suspendAfterSeconds * 1000,
    ...(drainingSince !== undefined ? { drainingSince } : {}),
    outdated: actor.template !== lifecycle.currentTemplate(),
    routineFire: activity.routineFire,
  });
}

/**
 * When a sandbox's session was last active, by the sweep's clock: the
 * latest of its session's activity, this process's last ensure of it, and
 * its creation; `now` when none is known.
 */
function lastActiveOf(
  actor: SubstrateActorSummary,
  activity: SessionActivity,
  driver: SubstrateDriverInternals,
  now: number,
): Date {
  const stamps = [
    activity.lastActiveAt?.getTime(),
    driver.lastEnsuredAt(actor.name)?.getTime(),
    actor.createTime?.getTime(),
  ].filter((ms): ms is number => ms !== undefined);
  return new Date(stamps.length > 0 ? Math.max(...stamps) : now);
}

/**
 * Acts through the lifecycle, whose guard re-decides inside the actor's
 * queue from fresh reads and, after the suspend, thaws the sandbox when a
 * turn has arrived (module header). A store is a durable suspend.
 */
async function act(
  sessionId: string,
  planned: IdleAction,
  drain: Drain | undefined,
  options: SubstrateSweepOptions,
  now: () => number,
): Promise<void> {
  const { lifecycle, sessions, logger } = options;
  const actor = sandboxBaseName("session", sessionId);
  // A store decided while the session was busy is forced (the deadline
  // passed): it ends that turn, so the turn is no reason to thaw.
  let forced = false;
  // The template the sandbox was on when the act re-decided, for the log.
  let template: string | undefined;
  // Whether a routine's fire started the session, for the log.
  let routineFire = false;
  const proceed = async (fresh: SubstrateActorSummary): Promise<boolean> => {
    const activity = await sessions.activity(sessionId);
    forced = planned === "store" && activity.busy;
    template = fresh.template;
    routineFire = activity.routineFire;
    // Still on the worker that was draining, or the drain no longer applies.
    const since =
      drain !== undefined && fresh.worker === drain.worker
        ? drain.since
        : undefined;
    return decide(fresh, activity, options, now(), since) === planned;
  };
  const outcome = await lifecycle.suspend(
    "session",
    sessionId,
    {
      proceed,
      stillIdle: async () =>
        forced || !(await sessions.activity(sessionId)).busy,
    },
    { durable: planned === "store" },
  );
  if (outcome === "thawed") {
    logger.info("A turn arrived while its sandbox suspended; resumed it", {
      actor,
      sessionId,
    });
  } else if (outcome === "done" && planned === "store") {
    logger.info("Substrate sandbox stored before its worker drained", {
      actor,
      sessionId,
      endedTurn: forced,
    });
  } else if (outcome === "done" && template !== lifecycle.currentTemplate()) {
    logger.info(
      "Substrate sandbox suspended: it ran under an older configuration, whose network lanes this server may no longer grant; its next wake starts on the current one",
      { actor, sessionId, template, current: lifecycle.currentTemplate() },
    );
  } else if (outcome === "done" && routineFire) {
    logger.info(
      "Substrate sandbox suspended: its routine's run ended, so it holds no seat for the idle window",
      { actor, sessionId },
    );
  } else if (outcome === "done") {
    logger.info("Substrate sandbox suspended (idle)", { actor, sessionId });
  }
}

/**
 * Puts one idle sandbox to sleep so the waiting session can start; true
 * when one went to sleep (module header, "Making room for a waiting
 * run").
 */
export async function makeRoom(
  state: SweepState,
  options: SubstrateSweepOptions,
  forSessionId: string,
): Promise<boolean> {
  const stopping = options.stopping ?? (() => false);
  if (state.listing !== undefined && (await freeOne(state.listing, options, forSessionId))) {
    return true;
  }
  if (stopping()) return false;
  // Nothing in the last listing would yield: every awake sandbox may have
  // started since it was read. One fresh listing, then choose again.
  let draining: SubstrateDrainingSandbox[];
  try {
    draining = await options.lifecycle.draining();
  } catch (error) {
    // An ordinary suspend on a leaving worker could lose files, so an ask
    // that cannot see which are leaving makes no room (module header).
    options.logger.warn("Could not read which workers are leaving; made no room for a waiting run", {
      sessionId: forSessionId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
  state.listing = {
    awake: awakeSessions(await options.lifecycle.list()),
    draining: new Map(
      draining.map((sandbox) => [
        sandbox.actor.name,
        { worker: sandbox.actor.worker, since: sandbox.drainingSince },
      ]),
    ),
  };
  return freeOne(state.listing, options, forSessionId);
}

/** Whether `actor` sits on a leaving worker now; true when that cannot be read. */
async function leavingNow(
  actor: SubstrateActorSummary,
  options: SubstrateSweepOptions,
): Promise<boolean> {
  try {
    return (await options.lifecycle.draining()).some(
      (sandbox) => sandbox.actor.name === actor.name,
    );
  } catch (error) {
    options.logger.warn("Could not read which workers are leaving; made no room for a waiting run", {
      actor: actor.name,
      error: error instanceof Error ? error.message : String(error),
    });
    return true;
  }
}

/** Puts the first sandbox `listing` offers to sleep (module header); true when one went to sleep. */
async function freeOne(
  listing: SweepListing,
  options: SubstrateSweepOptions,
  forSessionId: string,
): Promise<boolean> {
  const { driver, lifecycle, sessions, logger } = options;
  const now = options.now ?? Date.now;
  const stopping = options.stopping ?? (() => false);
  const own = sandboxBaseName("session", forSessionId);
  // Each candidate's sandbox as listed, by session id.
  const listedOn = new Map<string, SubstrateActorSummary>();
  const candidates: MakeRoomCandidate[] = [];
  for (const actor of listing.awake) {
    const sessionId = driver.sessionByActor.get(actor.name);
    if (actor.name === own || sessionId === undefined) continue;
    try {
      const activity = await sessions.recentActivity(sessionId);
      listedOn.set(sessionId, actor);
      candidates.push({
        id: sessionId,
        busy: activity.busy,
        parked: activity.parked,
        draining: listing.draining.has(actor.name),
        lastActiveAt: lastActiveOf(actor, activity, driver, now()),
      });
    } catch (error) {
      logger.warn("Making room for a waiting run skipped a sandbox", {
        actor: actor.name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const chosen = orderSandboxesToFree(candidates).flatMap((sessionId) => {
    const listed = listedOn.get(sessionId);
    return listed === undefined ? [] : [{ sessionId, listed }];
  });
  for (const { sessionId, listed } of chosen) {
    if (stopping()) return false;
    let parked = false;
    const outcome = await lifecycle.suspend("session", sessionId, {
      proceed: async (fresh) => {
        if (fresh.state !== "running" || fresh.worker !== listed.worker) {
          return false;
        }
        // The listing may be up to an interval old, or its read of the
        // leaving workers may have failed: read them again, and refuse
        // when they cannot be read (module header).
        if (await leavingNow(fresh, options)) {
          return false;
        }
        const activity = await sessions.activity(sessionId);
        parked = activity.parked;
        return !activity.busy;
      },
      stillIdle: async () => !(await sessions.activity(sessionId)).busy,
    });
    if (outcome === "done") {
      const lastActiveAt =
        candidates.find((c) => c.id === sessionId)?.lastActiveAt.getTime() ??
        now();
      logger.info(
        "Put the longest-idle sandbox to sleep so a waiting run can start; its next message wakes it with its files",
        {
          actor: listed.name,
          sessionId,
          idleSeconds: Math.round((now() - lastActiveAt) / 1000),
          parked,
          forSessionId,
        },
      );
      return true;
    }
    if (outcome === "thawed") {
      logger.info("A turn arrived while its sandbox suspended; resumed it", {
        actor: listed.name,
        sessionId,
      });
    }
  }
  return false;
}

async function suspendOrphan(
  actor: SubstrateActorSummary,
  durable: boolean,
  options: SubstrateSweepOptions,
): Promise<void> {
  const { driver, logger } = options;
  await driver.serialize(actor.name, async () => {
    // An ensure that named it while this waited in the queue wins.
    if (driver.sessionByActor.has(actor.name)) return;
    await driver.gateway.suspendActor(actor.name, { durable });
    logger.error(
      "Substrate sandbox belongs to no session; suspended it (its workspace is kept)",
      { actor: actor.name },
    );
  });
}
