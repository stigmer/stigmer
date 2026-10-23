/**
 * The substrate sandbox driver: every sandbox is an Agent Substrate actor,
 * a gVisor sandbox that can be paused (stopped, its workspace kept on its
 * node) or suspended (its workspace committed to storage, the node let
 * go) and resumed with its files. A session's sandbox therefore sleeps
 * while the session is idle and wakes when the next turn arrives.
 *
 * Every wake starts a fresh runner. The template captures volumes only
 * (template.ts), so neither a pause nor a suspend keeps the runner's
 * memory: Substrate 0.5 snapshots a pause and a suspend at one fidelity,
 * and a memory fidelity would bring a suspended runner back with the
 * secrets it slept with, where a fresh start takes this configuration's.
 *
 * Shape: a gateway is the only surface touching
 * Substrate (gateway.ts), the provisioner is built over it, and
 * newSubstrateSandboxDriverOverGateway is the test seam. State is
 * Substrate's, never a store table: an actor is named by
 * sandboxBaseName(scope, id), the same name the runner's attach waiter
 * derives from its queue.
 *
 * The ensure state machine, from the actor's state:
 *
 *   - absent: wait for the template (template.ts), create the actor from
 *     it; a created actor is suspended.
 *   - suspended: move it to the current template when it is on an older
 *     one and the current one is ready (a running or paused actor is never
 *     disturbed); make its egress policy this configuration's (below);
 *     resume; push.
 *   - paused: make its egress policy this configuration's; resume on its
 *     node; push.
 *   - running: push; the waiter keeps its runner and takes the fresh token
 *     for a restart.
 *   - crashed: revert, then from the state that leaves.
 *   - resuming, pausing, suspending, reverting: wait for it to settle.
 *   - deleting: refused.
 *
 * The ensure's log line names, in `arm`, the path the ensure took from the
 * first settled state it found, never the arm it ended in, because the
 * wake budgets are measured per path: `created` (absent, created, then
 * woken), `suspended` (woken from storage), `paused` (woken on its node),
 * `running` (pushed only), `crashed` (reverted, then brought up). A state
 * in transition that the ensure waits out names nothing.
 *
 * Any call answering ABORTED (another operation holds the actor, or it
 * crashed while resuming) sends the ensure back to reading the actor; no
 * free worker is thrown unretried, so the session step stamps it and the
 * connect lane refuses, as for any provisioning failure. The walk is
 * bounded, so an actor that never settles fails loudly.
 *
 * A rotated secret: the waiter keeps its first push's secrets for the
 * runner's life and refuses a push that changes them (`secrets_changed`),
 * because a process inside the sandbox can reach the waiter too. The
 * driver's secrets change only when this server restarts with new
 * settings, and every wake starts a fresh runner, so only a running actor
 * can hold old ones: it keeps its runner, logs the refusal, and takes the
 * new secrets at its next wake, after its next idle pause.
 *
 * The egress policy is this configuration's and the session's
 * Environment's (egress.ts) on every actor the server ensures: created
 * when missing (which also repairs an actor whose creator died before
 * writing it; an actor without one reaches nothing) and replaced when its
 * rules differ. Every ensure, so every turn, computes the rules and writes
 * them when their digest differs from what this process last wrote for
 * the actor (always on a wake from storage), so a host an Environment no
 * longer lists stops being reachable at the conversation's next turn, and
 * a changed endpoint or HTTPS egress switched off reaches a sandbox at its
 * next turn or wake. A running turn keeps the policy it started with until
 * the next ensure; Substrate applies a replaced policy to a running actor
 * within its egress gateway's policy cache (`--egress-policy-cache-ttl`, 10 s by default;
 * at once on v0.3.0, measured 2026-10-18). The sweep writes no policy:
 * it does not know an awake sandbox's Environment, and the configuration's
 * bare rules would widen a limited one. The runner's own lanes are cleartext (egress.ts says
 * why), so the server's Temporal connection settings, every one of which
 * asks for TLS, are refused at boot rather than carried to the runner.
 *
 * A runner this process started (it woke the actor or created it) has
 * accepted no push but this process's, all with this
 * process's secrets, queue and kind of token. So a refusal from such a
 * runner saying it already serves other secrets, another token or another
 * queue means a push from elsewhere won its waiter's first,
 * unauthenticated push: the driver suspends the sandbox, which stops that
 * runner, and fails the ensure. It remembers those runners in memory, not
 * only for the ensure that woke them, so the check holds when that ensure
 * was cut short (a failed push, a suspend Substrate turned away) and a
 * later one finds the actor running or paused. Only a runner older than
 * this process may answer `secrets_changed` honestly. The router being
 * reachable by this server alone is what keeps a foreign push from
 * happening (egress.ts); this catches it if it does.
 *
 * One limit stays: a RUNNING runner that refuses rotated secrets also
 * refuses the push's fresh token, so it restarts, if it crashes, with the
 * last token it accepted. A runner crash-looping on an expired token
 * fails its runs, which ends its Session's busy state, and the sweep then
 * suspends it; its next wake starts fresh with both.
 *
 * Every ensure, delete and lifecycle operation on one actor runs through
 * one in-process queue, so a turn and the idle sweep (sweep.ts) never
 * interleave on an actor within one server.
 *
 * The lifecycle is everything an idle sweep needs except the decision of
 * what is idle, which belongs to whoever keeps the sweep: open source's
 * own (sweep.ts) or a composition that keeps records of its sandboxes and
 * runs its own. So pause, suspend and a delete by name take a guard the
 * sweep answers inside the actor's queue, from fresh reads, right before
 * the call (and, after a pause, once more: a turn that arrived while the
 * pause was in flight wakes the sandbox again at once, a fresh runner the
 * turn's own ensure pushes to); a delete's guard is how
 * a composition reaping orphans never deletes a sandbox a turn woke while
 * the delete waited in the queue; `maintain` is a pass's upkeep over the
 * sweep's own listing (a delete repeated, a sleeping sandbox moved to the
 * current template, unused templates retired); and
 * `prepare` readies the template before the first turn needs it.
 */
import type { Logger } from "../../boot/logger.js";
import {
  isSandboxBaseName,
  sandboxBaseName,
  sandboxTaskQueue,
} from "../naming.js";
import { RUNNER_SECRET_NAMES } from "../runner-secret-names.js";
import type {
  SandboxDriverConfig,
  SandboxFacts,
  SandboxProbeState,
  SandboxProvisioner,
  SandboxScope,
} from "../provisioner.js";
import type { SubstrateDriverSettings } from "./config.js";
import { delay } from "./delay.js";
import { runnerEnvironmentOf } from "../environment.js";
import { buildEgressRules, egressDigest } from "./egress.js";
import type { EgressRule } from "./gen/ateapipb/ateapi_pb.js";
import {
  SubstrateAbortedError,
  SubstrateNoWorkerError,
  type SubstrateActorView,
  type SubstrateGateway,
  type SubstrateSandboxState,
} from "./gateway.js";
import { pushAttach, type PushResult } from "./push.js";
import {
  buildRunnerTemplate,
  newTemplateKeeper,
  TEMPLATE_NAME_PREFIX,
  type SubstrateRunnerMode,
  type TemplateKeeper,
} from "./template.js";

export type { SubstrateSandboxState } from "./gateway.js";

/** One sandbox as a composition sees it. */
export interface SubstrateActorSummary {
  readonly name: string;
  readonly state: SubstrateSandboxState;
  readonly template: string;
  readonly createTime: Date | undefined;
  readonly updateTime: Date | undefined;
}

/**
 * The sweep's answer, asked inside the actor's queue right before a sleep
 * or a delete, from the actor as it is now: whether the call should still
 * be made. A turn that woke the sandbox, or a session that became busy,
 * since the sweep decided says no.
 */
export interface SubstrateSleepGuard {
  proceed(actor: SubstrateActorSummary): Promise<boolean>;
}

/**
 * A pause's guard also answers once the pause has landed: a turn that
 * arrived while it was in flight (on this server or another) is seen here
 * and the sandbox is thawed in place.
 */
export interface SubstratePauseGuard extends SubstrateSleepGuard {
  stillIdle(): Promise<boolean>;
}

/** What a guarded pause, suspend or delete did; only a pause thaws (wakes again at once). */
export type SubstrateSleepOutcome = "done" | "skipped" | "thawed";

/** The paths an ensure takes, named by the state it first acts on (module header). */
type EnsurePath = "created" | "suspended" | "paused" | "running" | "crashed";

/** What one pass of upkeep did (SubstrateSandboxLifecycle.maintain). */
export interface SubstrateMaintenance {
  /** Sandboxes left DELETING by a delete that failed part-way, deleted again. */
  readonly redeleted: number;
  /** Sleeping sandboxes moved to the current template. */
  readonly moved: number;
  /** Templates no sandbox uses any more, deleted. */
  readonly retired: number;
}

/**
 * The lifecycle operations, once, for every composition of this driver:
 * the open-source idle sweep uses them, and a composition with its own
 * records and its own sweep calls the same ones (module header).
 */
export interface SubstrateSandboxLifecycle {
  /** Pauses; with a guard, only if it proceeds, and thawed again if it is no longer idle afterwards. */
  pause(
    scope: SandboxScope,
    id: string,
    guard?: SubstratePauseGuard,
  ): Promise<SubstrateSleepOutcome>;
  /** Suspends to storage; with a guard, only if it proceeds. */
  suspend(
    scope: SandboxScope,
    id: string,
    guard?: SubstrateSleepGuard,
  ): Promise<SubstrateSleepOutcome>;
  /** The ensure: wakes (or creates) the sandbox and pushes its attachment. */
  resume(scope: SandboxScope, id: string, facts: SandboxFacts): Promise<void>;
  delete(scope: SandboxScope, id: string): Promise<void>;
  /**
   * Deletes a sandbox known only by its listed name (list()): a
   * composition's orphan, whose owner is gone, so its scope and id are
   * not to hand. Refuses a name this driver never gives (a template's own
   * actor). With a guard, deletes only if it proceeds, and a sandbox that
   * is gone is skipped.
   */
  deleteByName(
    name: string,
    guard?: SubstrateSleepGuard,
  ): Promise<Exclude<SubstrateSleepOutcome, "thawed">>;
  /**
   * A push with no lifecycle call: hands a running sandbox a fresh token
   * for its next restart, for a composition that renews tokens. A sandbox
   * that is not running is left alone, because the router would wake it
   * outside the ensure's rules; it takes a fresh token when it next wakes.
   */
  reattach(
    scope: SandboxScope,
    id: string,
    facts: SandboxFacts,
  ): Promise<SubstrateReattachResult>;
  list(): Promise<SubstrateActorSummary[]>;
  /**
   * One pass of upkeep over the caller's listing (list()): repeats a delete
   * left part-way, moves a sleeping sandbox on an older template to the
   * current one, then retires unused templates. It writes no egress policy:
   * an awake sandbox gets its own at its next ensure (module header). A
   * sandbox whose upkeep fails is logged and skipped. `stopping` ends the
   * pass after the sandbox in hand, before any template is retired.
   */
  maintain(
    listed: readonly SubstrateActorSummary[],
    options?: { readonly stopping?: () => boolean },
  ): Promise<SubstrateMaintenance>;
  /** Deletes this server's templates no actor uses any more; returns how many. */
  retireTemplates(): Promise<number>;
  /**
   * Prepares the current template (its golden snapshot) so the first turn
   * rarely waits for it. Never rejects: a failure is logged and the next
   * ensure prepares it again.
   */
  prepare(): Promise<void>;
}

/** What a reattach did: pushed, with the waiter's answer, or nothing, because the sandbox was not running. */
export type SubstrateReattachResult =
  | { readonly pushed: true; readonly result: PushResult }
  | {
      readonly pushed: false;
      readonly state: SubstrateSandboxState | "absent";
    };

/** The driver's parts a background sweep in this package works through. */
export interface SubstrateDriverInternals {
  readonly gateway: SubstrateGateway;
  readonly keeper: TemplateKeeper;
  readonly settings: SubstrateDriverSettings;
  /** Runs `body` alone among this server's operations on the actor `name`. */
  serialize<T>(name: string, body: () => Promise<T>): Promise<T>;
  /** When this process last ensured the actor, if it has. */
  lastEnsuredAt(name: string): Date | undefined;
  /** The session a session actor serves, as this process's ensures learned it. */
  readonly sessionByActor: Map<string, string>;
}

export interface SubstrateSandboxDriver {
  readonly provisioner: SandboxProvisioner;
  readonly lifecycle: SubstrateSandboxLifecycle;
  readonly internals: SubstrateDriverInternals;
}

export interface SubstrateDriverOptions {
  readonly config: SandboxDriverConfig;
  readonly settings: SubstrateDriverSettings;
  readonly logger: Logger;
  readonly gateway: SubstrateGateway;
  /** The runner's MODE in every sandbox (template.ts); `local` when absent. */
  readonly runnerMode?: SubstrateRunnerMode;
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
}

/** The most state transitions one ensure walks before it gives up. */
const MAX_TRANSITIONS = 8;
/** How long an ensure waits for an actor in transition to settle. */
const SETTLE_WAIT_MS = 60_000;
const SETTLE_POLL_MS = 250;
/** A template younger than this is never retired (another server may be preparing it). */
const TEMPLATE_RETIRE_GRACE_MS = 10 * 60_000;

/** The refusals that say a waiter already took another push (module header). */
const ATTACHED_ELSEWHERE: ReadonlySet<string> = new Set([
  "secrets_changed",
  "token_mismatch",
  "other_queue",
]);

const TRANSITIONAL: ReadonlySet<SubstrateSandboxState> = new Set([
  "resuming",
  "pausing",
  "suspending",
  "reverting",
]);

/** Checks the driver's configuration and builds the template and egress rules it needs. */
export function validateSubstrateDriverConfig(
  config: SandboxDriverConfig,
): void {
  if (config.backendEndpoint === "") {
    throw new Error(
      "sandbox provisioner 'substrate' requires STIGMER_SANDBOX_BACKEND_ENDPOINT — a sandbox cannot reach the server on this process's localhost",
    );
  }
  if (config.temporalAddress === "") {
    throw new Error(
      "sandbox provisioner 'substrate' requires STIGMER_SANDBOX_TEMPORAL_ADDRESS (or TEMPORAL_HOST_PORT) reachable from inside a sandbox",
    );
  }
  const temporalSettings = Object.keys(config.temporalConnectionEnv);
  if (temporalSettings.length > 0) {
    throw new Error(
      `sandbox provisioner 'substrate' needs the runner's Temporal lane in cleartext inside the cluster, but the server's Temporal connection settings ask for TLS (${temporalSettings.sort().join(", ")}): Substrate's egress gateway can carry TLS only by intercepting it, which breaks a client certificate or a pinned CA (egress.ts)`,
    );
  }
  const unknown = Object.keys(config.runnerSecretEnv).filter(
    (name) => !RUNNER_SECRET_NAMES.includes(name),
  );
  if (unknown.length > 0) {
    throw new Error(
      `sandbox provisioner 'substrate' cannot push ${unknown.join(", ")} from STIGMER_SANDBOX_RUNNER_SECRETS: a sandbox's runner accepts only its own secret variables (${RUNNER_SECRET_NAMES.join(", ")}); give anything else to the runner as a plain setting (STIGMER_SANDBOX_RUNNER_ENV) or through the run's environment`,
    );
  }
  if (!config.runnerImage.includes("@sha256:")) {
    throw new Error(
      `sandbox provisioner 'substrate' requires STIGMER_SANDBOX_RUNNER_IMAGE pinned by digest (image@sha256:…), because Substrate snapshots a template once; got ${config.runnerImage}`,
    );
  }
}

export function newSubstrateSandboxDriverOverGateway(
  options: SubstrateDriverOptions,
): SubstrateSandboxDriver {
  const { config, settings, logger, gateway } = options;
  validateSubstrateDriverConfig(config);
  const now = options.now ?? Date.now;
  const wait = options.sleep ?? delay;

  // Asked once at boot: a forbidden or unusable runner destination throws here.
  buildEgressRules(config, settings);
  const keeper = newTemplateKeeper({
    gateway,
    template: buildRunnerTemplate({
      config,
      settings,
      runnerMode: options.runnerMode ?? "local",
    }),
    logger,
    sleep: wait,
    now,
  });

  const queues = new Map<string, Promise<unknown>>();
  function serialize<T>(name: string, body: () => Promise<T>): Promise<T> {
    const previous = queues.get(name) ?? Promise.resolve();
    const next = previous.then(body, body);
    const settled = next.catch(() => undefined);
    queues.set(name, settled);
    void settled.then(() => {
      if (queues.get(name) === settled) queues.delete(name);
    });
    return next;
  }

  const ensuredAt = new Map<string, number>();
  const sessionByActor = new Map<string, string>();
  const refusedMoves = new Set<string>();
  /** The digest of the rules this process last wrote for each actor (module header). */
  const egressWritten = new Map<string, string>();
  /**
   * Actors whose runner this process started: woken by it.
   * An entry is dropped only when the actor is deleted; a stale one (the
   * actor since suspended and woken elsewhere) only makes a refusal from
   * it count as foreign, the safe reading (module header).
   */
  const startedHere = new Set<string>();

  async function reconcileEgress(
    name: string,
    facts: SandboxFacts,
    always = false,
  ): Promise<void> {
    const rules = buildEgressRules(config, settings, facts.environment);
    const digest = egressDigest(rules);
    if (!always && egressWritten.get(name) === digest) return;
    const outcome = await gateway.ensureEgressPolicy(name, rules);
    egressWritten.set(name, digest);
    if (outcome === "replaced") {
      logger.info(
        "Substrate sandbox egress policy replaced by this configuration's and its environment's",
        {
          actor: name,
          environment: facts.environment?.id ?? "",
        },
      );
    }
  }

  function assertQueue(
    scope: SandboxScope,
    id: string,
    taskQueue: string,
  ): void {
    const expected = sandboxTaskQueue(scope, id);
    if (taskQueue !== expected) {
      throw new Error(
        `the ${scope} sandbox for ${id} serves ${expected}, not ${taskQueue}`,
      );
    }
  }

  function secretsFor(facts: SandboxFacts): Record<string, string> {
    return {
      ...config.runnerSecretEnv,
      ...(facts.stigmerToken !== ""
        ? { STIGMER_TOKEN: facts.stigmerToken }
        : {}),
    };
  }

  async function push(name: string, facts: SandboxFacts): Promise<PushResult> {
    return pushAttach(
      {
        routerUrl: settings.routerUrl,
        atespace: settings.atespace,
        actor: name,
        taskQueue: facts.taskQueue,
        secrets: secretsFor(facts),
        ...(facts.environment !== undefined
          ? { environment: runnerEnvironmentOf(facts.environment) }
          : {}),
      },
      { ...(options.fetch ? { fetch: options.fetch } : {}), sleep: wait, now },
    );
  }

  /** Moves a SUSPENDED actor to the current template when it is ready; logs a refusal once; true when it moved. */
  async function moveToCurrent(actor: SubstrateActorView): Promise<boolean> {
    if (actor.template === keeper.name || !keeper.readyNow()) return false;
    const moved = await gateway.moveActor(actor, keeper.name);
    if (moved === "moved") {
      logger.info("Substrate sandbox moved to the current template", {
        actor: actor.name,
        from: actor.template,
        to: keeper.name,
      });
      return true;
    }
    if (!refusedMoves.has(actor.name)) {
      refusedMoves.add(actor.name);
      logger.warn(
        "Substrate refused to move a sandbox to the current template (its volumes or sandbox configuration differ); it stays on its own template",
        { actor: actor.name, template: actor.template, current: keeper.name },
      );
    }
    return false;
  }

  async function settle(name: string): Promise<SubstrateActorView | undefined> {
    const deadline = now() + SETTLE_WAIT_MS;
    for (;;) {
      const actor = await gateway.getActor(name);
      if (actor === undefined || !TRANSITIONAL.has(actor.state)) return actor;
      if (now() >= deadline) {
        throw new Error(
          `sandbox ${name} stayed ${actor.state} for ${SETTLE_WAIT_MS / 1000} s`,
        );
      }
      await wait(SETTLE_POLL_MS);
    }
  }

  async function ensure(
    scope: SandboxScope,
    id: string,
    facts: SandboxFacts,
  ): Promise<void> {
    assertQueue(scope, id, facts.taskQueue);
    const name = sandboxBaseName(scope, id);
    ensuredAt.set(name, now());
    if (scope === "session") sessionByActor.set(name, id);
    const started = now();
    await serialize(name, async () => {
      let recreatedTemplate = false;
      /** Set the first time the walk acts on a settled state (module header). */
      let path: EnsurePath | undefined;
      const ensured = (): void =>
        logger.info("Substrate sandbox ensured", {
          scope,
          id,
          actor: name,
          arm: path,
          ms: now() - started,
        });
      for (let transition = 0; transition < MAX_TRANSITIONS; transition += 1) {
        try {
          const actor = await gateway.getActor(name);
          if (actor === undefined) {
            const template = await keeper.ready();
            try {
              // Created here, or by another server meanwhile: then this
              // ensure names the state it finds next, as any other.
              if ((await gateway.createActor(name, template)) === "created")
                path ??= "created";
            } catch (error) {
              // The template a moment ago ready is gone when another
              // server retired it: prepare it again, once.
              if (recreatedTemplate || error instanceof SubstrateAbortedError)
                throw error;
              recreatedTemplate = true;
              keeper.invalidate();
              logger.warn(
                "Creating a sandbox failed; preparing the template again",
                {
                  actor: name,
                  error: error instanceof Error ? error.message : String(error),
                },
              );
            }
            continue;
          }
          switch (actor.state) {
            case "suspended":
            case "paused": {
              // A wake starts a fresh waiter, so this push is its first: a
              // refusal means another push won it (attach). A paused actor
              // stays on its template, pinned to its node until it wakes.
              if (actor.state === "suspended") {
                path ??= "suspended";
                await moveToCurrent(actor);
                await reconcileEgress(name, facts, true);
              } else {
                path ??= "paused";
                await reconcileEgress(name, facts);
              }
              startedHere.add(name);
              await gateway.resumeActor(name);
              await attach(scope, name, facts);
              ensured();
              return;
            }
            case "running": {
              path ??= "running";
              await reconcileEgress(name, facts);
              await attach(scope, name, facts);
              ensured();
              return;
            }
            case "crashed":
              path ??= "crashed";
              logger.warn("Substrate sandbox crashed; reverting it", {
                scope,
                id,
                actor: name,
              });
              await gateway.revertActor(name);
              continue;
            case "deleting":
              throw new Error(`sandbox ${name} is being deleted`);
            case "resuming":
            case "pausing":
            case "suspending":
            case "reverting":
            case "unknown":
              await settle(name);
              continue;
            default: {
              const exhaustive: never = actor.state;
              throw new Error(`sandbox ${name} is in an unknown state ${String(exhaustive)}`);
            }
          }
        } catch (error) {
          if (error instanceof SubstrateAbortedError) {
            await wait(100 + Math.floor(Math.random() * 400));
            continue;
          }
          if (error instanceof SubstrateNoWorkerError) {
            throw new Error(
              `no free Substrate worker for sandbox ${name}: ${error.message}`,
            );
          }
          throw error;
        }
      }
      throw new Error(
        `sandbox ${name} did not settle after ${MAX_TRANSITIONS} state changes`,
      );
    });
  }

  /** Pushes the attachment; a rotated secret on a runner older than this process is logged (module header). */
  async function attach(
    scope: SandboxScope,
    name: string,
    facts: SandboxFacts,
  ): Promise<void> {
    const result = await push(name, facts);
    if (result.ok) return;
    await stopForeignRunner(name, result);
    if (result.code === "secrets_changed") {
      logger.warn(
        "Runner secrets rotated; the sandbox keeps its running runner and takes them at its next fresh start",
        { scope, actor: name },
      );
      return;
    }
    throw new Error(
      `sandbox ${name} refused its attach push (${result.status} ${result.code}): ${result.error}`,
    );
  }

  /**
   * Suspends a runner this process started that another push attached,
   * which stops it before it can serve a turn, and throws (module header).
   */
  async function stopForeignRunner(
    name: string,
    result: PushResult,
  ): Promise<void> {
    if (
      result.ok ||
      !startedHere.has(name) ||
      !ATTACHED_ELSEWHERE.has(result.code)
    ) {
      return;
    }
    logger.error(
      "A Substrate sandbox this server started was attached by another push; suspending it",
      { actor: name, code: result.code },
    );
    await gateway.suspendActor(name);
    throw new Error(
      `sandbox ${name} was attached by another push before this one (${result.code}); it has been suspended, and its next wake starts it fresh`,
    );
  }

  async function deprovision(scope: SandboxScope, id: string): Promise<void> {
    const name = sandboxBaseName(scope, id);
    await deleteNamed(name, undefined);
    logger.info("Substrate sandbox deleted", { scope, id, actor: name });
  }

  /**
   * Deletes the actor `name`, with a guard only if it proceeds, and forgets
   * what this process knew of it. A delete the guard refused forgets
   * nothing; one that found the sandbox already gone skips and forgets.
   */
  async function deleteNamed(
    name: string,
    guard: SubstrateSleepGuard | undefined,
  ): Promise<"done" | "skipped"> {
    const answer = await serialize(name, async () => {
      const answer = await asked(name, guard);
      if (answer === "proceed") await gateway.deleteActor(name);
      return answer;
    });
    if (answer !== "refused") forget(name);
    return answer === "proceed" ? "done" : "skipped";
  }

  /** Forgets what this process knew of a deleted actor. */
  function forget(name: string): void {
    ensuredAt.delete(name);
    sessionByActor.delete(name);
    egressWritten.delete(name);
    startedHere.delete(name);
  }

  const provisioner: SandboxProvisioner = {
    runnerMode: options.runnerMode ?? "local",
    // A host list is enforced by the egress gateway whenever HTTPS egress
    // is on; under the operator's `none` an Environment may not open one.
    environmentSupport: {
      limitedNetworking: settings.httpsEgress === "all",
      packages: true,
    },
    ensureSessionSandbox: (sessionId, facts) =>
      ensure("session", sessionId, facts),
    deprovisionSessionSandbox: (sessionId) => deprovision("session", sessionId),
    async createConnectSandbox(connectRequestId, facts) {
      await ensure("connect", connectRequestId, facts);
      return connectRequestId;
    },
    deprovisionConnectSandbox: (sandboxId) => deprovision("connect", sandboxId),
    async probe(scope, id): Promise<SandboxProbeState> {
      const actor = await gateway.getActor(sandboxBaseName(scope, id));
      if (actor === undefined) return "absent";
      return actor.state === "running" || actor.state === "resuming"
        ? "running"
        : "stopped";
    },
  };

  /**
   * Asks a guard about the actor as it is now: no guard proceeds, and an
   * actor that is gone never does (it is never asked about).
   */
  async function asked(
    name: string,
    guard: SubstrateSleepGuard | undefined,
  ): Promise<"proceed" | "refused" | "gone"> {
    if (guard === undefined) return "proceed";
    const actor = await gateway.getActor(name);
    if (actor === undefined) return "gone";
    return (await guard.proceed(summaryOf(actor))) ? "proceed" : "refused";
  }

  const lifecycle: SubstrateSandboxLifecycle = {
    pause: (scope, id, guard) => {
      const name = sandboxBaseName(scope, id);
      return serialize(name, async (): Promise<SubstrateSleepOutcome> => {
        if ((await asked(name, guard)) !== "proceed") return "skipped";
        await gateway.pauseActor(name);
        if (guard !== undefined && !(await guard.stillIdle())) {
          // A fresh runner, which the turn's own ensure pushes to.
          startedHere.add(name);
          await gateway.resumeActor(name);
          return "thawed";
        }
        return "done";
      });
    },
    suspend: (scope, id, guard) => {
      const name = sandboxBaseName(scope, id);
      return serialize(name, async (): Promise<SubstrateSleepOutcome> => {
        if ((await asked(name, guard)) !== "proceed") return "skipped";
        await gateway.suspendActor(name);
        return "done";
      });
    },
    resume: (scope, id, facts) => ensure(scope, id, facts),
    delete: (scope, id) => deprovision(scope, id),
    async deleteByName(name, guard) {
      if (!isSandboxBaseName(name)) {
        throw new Error(
          `${name} is not a sandbox this driver names (sbx-<scope>-<12 hex>); refusing to delete it`,
        );
      }
      const outcome = await deleteNamed(name, guard);
      if (outcome === "done") {
        logger.info("Substrate sandbox deleted by name", { actor: name });
      }
      return outcome;
    },
    reattach: (scope, id, facts) => {
      assertQueue(scope, id, facts.taskQueue);
      const name = sandboxBaseName(scope, id);
      return serialize(name, async (): Promise<SubstrateReattachResult> => {
        const actor = await gateway.getActor(name);
        if (actor?.state !== "running") {
          return {
            pushed: false,
            state: actor === undefined ? "absent" : actor.state,
          };
        }
        const result = await push(name, facts);
        await stopForeignRunner(name, result);
        return { pushed: true, result };
      });
    },
    async list() {
      return (await gateway.listActors()).map(summaryOf);
    },
    async maintain(listed, options) {
      const stopping = options?.stopping ?? (() => false);
      let redeleted = 0;
      let moved = 0;
      for (const actor of listed) {
        // A shutdown waits for the sandbox in hand, never for the whole pass.
        if (stopping()) return { redeleted, moved, retired: 0 };
        try {
          switch (actor.state) {
            case "deleting":
              // A delete that failed part-way leaves the actor DELETING;
              // deleting again resumes it (Substrate's API guide). Re-read
              // in the queue: the listing may be older than the actor.
              if (
                await serialize(actor.name, async () => {
                  const fresh = await gateway.getActor(actor.name);
                  if (fresh?.state !== "deleting") return false;
                  await gateway.deleteActor(actor.name);
                  return true;
                })
              ) {
                forget(actor.name);
                redeleted += 1;
              }
              break;
            case "suspended":
              if (actor.template !== keeper.name) {
                const didMove = await serialize(actor.name, async () => {
                  const fresh = await gateway.getActor(actor.name);
                  return fresh?.state === "suspended"
                    ? moveToCurrent(fresh)
                    : false;
                });
                if (didMove) moved += 1;
              }
              break;
            default:
              break;
          }
        } catch (error) {
          logger.warn("Substrate sandbox upkeep skipped a sandbox", {
            actor: actor.name,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      if (stopping()) return { redeleted, moved, retired: 0 };
      const retired = await lifecycle.retireTemplates();
      return { redeleted, moved, retired };
    },
    async retireTemplates() {
      const [templates, actors] = await Promise.all([
        gateway.listTemplates(),
        gateway.listActors(),
      ]);
      const inUse = new Set(actors.map((actor) => actor.template));
      let retired = 0;
      for (const template of templates) {
        const old =
          template.createTime !== undefined &&
          now() - template.createTime.getTime() > TEMPLATE_RETIRE_GRACE_MS;
        if (
          template.name.startsWith(TEMPLATE_NAME_PREFIX) &&
          template.name !== keeper.name &&
          !inUse.has(template.name) &&
          old
        ) {
          await gateway.deleteTemplate(template);
          retired += 1;
          logger.info("Substrate template retired", {
            template: template.name,
          });
        }
      }
      return retired;
    },
    async prepare() {
      try {
        await keeper.ready();
      } catch (error) {
        logger.error(
          "Substrate template preparation failed; the next sandbox ensure retries it",
          {
            template: keeper.name,
            error: error instanceof Error ? error.message : String(error),
          },
        );
      }
    },
  };

  return {
    provisioner,
    lifecycle,
    internals: {
      gateway,
      keeper,
      settings,
      serialize,
      lastEnsuredAt: (name) => {
        const at = ensuredAt.get(name);
        return at === undefined ? undefined : new Date(at);
      },
      sessionByActor,
    },
  };
}

/** An actor as a composition sees it (the lifecycle's listing and its guards). */
function summaryOf(actor: SubstrateActorView): SubstrateActorSummary {
  return {
    name: actor.name,
    state: actor.state,
    template: actor.template,
    createTime: actor.createTime,
    updateTime: actor.updateTime,
  };
}
