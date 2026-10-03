/**
 * The substrate sandbox driver: every sandbox is an Agent Substrate actor,
 * a gVisor sandbox that can be paused in place (memory kept, back in about
 * a second) or suspended to storage (memory released, its workspace
 * committed) and resumed with its files. A session's sandbox therefore
 * sleeps while the session is idle and wakes when the next turn arrives,
 * where the kubernetes driver keeps a pod running for the session's life.
 *
 * Shape: the kubernetes driver's. A gateway is the only surface touching
 * Substrate (gateway.ts), the provisioner is built over it, and
 * newSubstrateSandboxDriverOverGateway is the test seam. State is
 * Substrate's, never a store table: an actor is named by
 * sandboxBaseName(scope, id), the same name the runner's attach waiter
 * derives from its queue.
 *
 * The ensure state machine, from the actor's state:
 *
 *   - absent: wait for the template (template.ts), create the actor from
 *     it; a created actor is SUSPENDED.
 *   - SUSPENDED: move it to the current template when it is on an older
 *     one and the current one is ready (a running or paused actor is never
 *     disturbed; Substrate allows the move only here, and its first resume
 *     afterwards starts the new template's waiter fresh over the actor's
 *     files); write its egress policy, which is idempotent and repairs an
 *     actor whose creator died before writing it (an actor without one
 *     reaches nothing); resume; push.
 *   - PAUSED by this server process within MAX_IN_PLACE_PAUSE_SECONDS: resume
 *     in place and push. Paused for longer (limits.ts says why), or before
 *     this process started: suspend first and start fresh (below).
 *   - RUNNING: push; the waiter keeps its runner and takes the fresh token
 *     for a restart.
 *   - CRASHED: revert, then from the state that leaves.
 *   - RESUMING, PAUSING, SUSPENDING, REVERTING: wait for it to settle.
 *   - DELETING: refused.
 *
 * Any call answering ABORTED (another operation holds the actor, or it
 * crashed while resuming) sends the ensure back to reading the actor; no
 * free worker is thrown unretried, so the session step stamps it and the
 * workflow step refuses, as for any provisioning failure. The walk is
 * bounded, so an actor that never settles fails loudly.
 *
 * A rotated secret: the waiter keeps its first push's secrets for the
 * runner's life and refuses a push that changes them (`secrets_changed`),
 * because a process inside the sandbox can reach the waiter too. The
 * driver's secrets change only when this server restarts with new
 * settings, so a pause older than this process may hold a runner with old
 * secrets, and it is started fresh rather than thawed: a thawed runner
 * polls its queue at once and would take the very turn that woke it, which
 * a restart would then kill mid-flight (measured on kind, 2026-10-03: the
 * turn's activity went to the thawed runner and waited out its 30-second
 * StartToClose timeout before a retry). A RUNNING actor keeps its runner,
 * logs the refusal, and takes the new secrets at its next fresh start,
 * after its next idle suspend.
 *
 * Every ensure, delete and lifecycle operation on one actor runs through
 * one in-process queue, so a turn and the idle sweep (sweep.ts) never
 * interleave on an actor within one server.
 */
import {
  TEMPORAL_API_KEY_ENV,
  TEMPORAL_TLS_CLIENT_KEY_DATA_ENV,
} from "@stigmer/temporal-codecs/connection";

import type { Logger } from "../../boot/logger.js";
import { SANDBOX_QUEUE_PREFIXES, sandboxBaseName } from "../naming.js";
import type {
  SandboxDriverConfig,
  SandboxEnvironment,
  SandboxProbeState,
  SandboxProvisioner,
  SandboxScope,
} from "../provisioner.js";
import type { SubstrateDriverSettings } from "./config.js";
import { delay } from "./delay.js";
import { buildEgressRules } from "./egress.js";
import { ActorState, type EgressRule } from "./gen/ateapipb/ateapi_pb.js";
import {
  SubstrateAbortedError,
  SubstrateNoWorkerError,
  type SubstrateActorView,
  type SubstrateGateway,
} from "./gateway.js";
import { MAX_IN_PLACE_PAUSE_SECONDS } from "./limits.js";
import { pushAttach, type PushResult } from "./push.js";
import {
  buildRunnerTemplate,
  newTemplateKeeper,
  TEMPLATE_NAME_PREFIX,
  type TemplateKeeper,
} from "./template.js";

/** An actor's state, in the platform's words. */
export type SubstrateSandboxState =
  | "resuming"
  | "running"
  | "suspending"
  | "suspended"
  | "pausing"
  | "paused"
  | "crashed"
  | "deleting"
  | "reverting"
  | "unknown";

/** One sandbox as a composition sees it. */
export interface SubstrateActorSummary {
  readonly name: string;
  readonly state: SubstrateSandboxState;
  readonly template: string;
  readonly createTime: Date | undefined;
  readonly updateTime: Date | undefined;
}

/**
 * The lifecycle operations, once, for every composition of this driver:
 * the open-source idle sweep uses them, and a composition with its own
 * records and its own sweep calls the same ones.
 */
export interface SubstrateSandboxLifecycle {
  pause(scope: SandboxScope, id: string): Promise<void>;
  suspend(scope: SandboxScope, id: string): Promise<void>;
  /** The ensure: wakes (or creates) the sandbox and pushes its attachment. */
  resume(
    scope: SandboxScope,
    id: string,
    env: SandboxEnvironment,
  ): Promise<void>;
  delete(scope: SandboxScope, id: string): Promise<void>;
  /**
   * A push with no lifecycle call: hands a running sandbox a fresh token
   * for its next restart, for a composition that renews tokens.
   */
  reattach(
    scope: SandboxScope,
    id: string,
    env: SandboxEnvironment,
  ): Promise<PushResult>;
  list(): Promise<SubstrateActorSummary[]>;
  /** Deletes this server's templates no actor uses any more; returns how many. */
  retireTemplates(): Promise<number>;
}

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
  /** Moves a SUSPENDED actor to the current template when it is ready; logs a refusal once. */
  moveToCurrent(actor: SubstrateActorView): Promise<void>;
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
/** The Temporal connection items that are secret; the rest go in the template. */
const TEMPORAL_SECRET_NAMES: readonly string[] = [
  TEMPORAL_API_KEY_ENV,
  TEMPORAL_TLS_CLIENT_KEY_DATA_ENV,
];

const TRANSITIONAL: ReadonlySet<ActorState> = new Set([
  ActorState.RESUMING,
  ActorState.PAUSING,
  ActorState.SUSPENDING,
  ActorState.REVERTING,
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
  /** Pauses from before this instant may hold another configuration's secrets (module header). */
  const processStartedAt = now();

  const temporalSecretEnv: Record<string, string> = {};
  const temporalPlainEnv: Record<string, string> = {};
  for (const [name, value] of Object.entries(config.temporalConnectionEnv)) {
    (TEMPORAL_SECRET_NAMES.includes(name)
      ? temporalSecretEnv
      : temporalPlainEnv)[name] = value;
  }
  const egressRules: readonly EgressRule[] = buildEgressRules(config, settings);
  const keeper = newTemplateKeeper({
    gateway,
    template: buildRunnerTemplate({ config, settings, temporalPlainEnv }),
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

  function assertQueue(
    scope: SandboxScope,
    id: string,
    taskQueue: string,
  ): void {
    const expected = `${SANDBOX_QUEUE_PREFIXES[scope]}${id}`;
    if (taskQueue !== expected) {
      throw new Error(
        `the ${scope} sandbox for ${id} serves ${expected}, not ${taskQueue}`,
      );
    }
  }

  function secretsFor(env: SandboxEnvironment): Record<string, string> {
    return {
      ...config.runnerSecretEnv,
      ...temporalSecretEnv,
      ...(env.stigmerToken !== "" ? { STIGMER_TOKEN: env.stigmerToken } : {}),
    };
  }

  async function push(
    name: string,
    env: SandboxEnvironment,
  ): Promise<PushResult> {
    return pushAttach(
      {
        routerUrl: settings.routerUrl,
        atespace: settings.atespace,
        actor: name,
        taskQueue: env.taskQueue,
        secrets: secretsFor(env),
      },
      { ...(options.fetch ? { fetch: options.fetch } : {}), sleep: wait, now },
    );
  }

  async function moveToCurrent(actor: SubstrateActorView): Promise<void> {
    if (actor.template === keeper.name || !keeper.readyNow()) return;
    const moved = await gateway.moveActor(actor, keeper.name);
    if (moved === "moved") {
      logger.info("Substrate sandbox moved to the current template", {
        actor: actor.name,
        from: actor.template,
        to: keeper.name,
      });
      return;
    }
    if (!refusedMoves.has(actor.name)) {
      refusedMoves.add(actor.name);
      logger.warn(
        "Substrate refused to move a sandbox to the current template (its volumes or sandbox configuration differ); it stays on its own template",
        { actor: actor.name, template: actor.template, current: keeper.name },
      );
    }
  }

  async function settle(name: string): Promise<SubstrateActorView | undefined> {
    const deadline = now() + SETTLE_WAIT_MS;
    for (;;) {
      const actor = await gateway.getActor(name);
      if (actor === undefined || !TRANSITIONAL.has(actor.state)) return actor;
      if (now() >= deadline) {
        throw new Error(
          `sandbox ${name} stayed ${ActorState[actor.state]} for ${SETTLE_WAIT_MS / 1000} s`,
        );
      }
      await wait(SETTLE_POLL_MS);
    }
  }

  async function ensure(
    scope: SandboxScope,
    id: string,
    env: SandboxEnvironment,
  ): Promise<void> {
    assertQueue(scope, id, env.taskQueue);
    const name = sandboxBaseName(scope, id);
    ensuredAt.set(name, now());
    if (scope === "session") sessionByActor.set(name, id);
    const started = now();
    await serialize(name, async () => {
      let recreatedTemplate = false;
      for (let transition = 0; transition < MAX_TRANSITIONS; transition += 1) {
        try {
          const actor = await gateway.getActor(name);
          if (actor === undefined) {
            const template = await keeper.ready();
            try {
              await gateway.createActor(name, template);
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
            case ActorState.SUSPENDED: {
              // A wake from storage starts a fresh waiter, so its first
              // push starts the runner and cannot meet rotated secrets.
              await moveToCurrent(actor);
              await gateway.ensureEgressPolicy(name, egressRules);
              await gateway.resumeActor(name);
              await attach(scope, name, env);
              logger.info("Substrate sandbox ensured", {
                scope,
                id,
                actor: name,
                arm: "suspended",
                ms: now() - started,
              });
              return;
            }
            case ActorState.PAUSED: {
              // A PAUSED actor's update time is the moment it paused.
              const pausedAt = actor.updateTime?.getTime() ?? 0;
              if (
                pausedAt < processStartedAt ||
                now() - pausedAt > MAX_IN_PLACE_PAUSE_SECONDS * 1000
              ) {
                await gateway.suspendActor(name);
                continue;
              }
              await gateway.resumeActor(name);
              await attach(scope, name, env);
              logger.info("Substrate sandbox ensured", {
                scope,
                id,
                actor: name,
                arm: "paused",
                ms: now() - started,
              });
              return;
            }
            case ActorState.RUNNING: {
              await attach(scope, name, env);
              logger.info("Substrate sandbox ensured", {
                scope,
                id,
                actor: name,
                arm: "running",
                ms: now() - started,
              });
              return;
            }
            case ActorState.CRASHED:
              logger.warn("Substrate sandbox crashed; reverting it", {
                scope,
                id,
                actor: name,
              });
              await gateway.revertActor(name);
              continue;
            case ActorState.DELETING:
              throw new Error(`sandbox ${name} is being deleted`);
            default:
              await settle(name);
              continue;
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

  /** Pushes the attachment; a rotated secret on a running runner is logged (module header). */
  async function attach(
    scope: SandboxScope,
    name: string,
    env: SandboxEnvironment,
  ): Promise<void> {
    const result = await push(name, env);
    if (result.ok) return;
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

  async function deprovision(scope: SandboxScope, id: string): Promise<void> {
    const name = sandboxBaseName(scope, id);
    await serialize(name, () => gateway.deleteActor(name));
    ensuredAt.delete(name);
    sessionByActor.delete(name);
    logger.info("Substrate sandbox deleted", { scope, id, actor: name });
  }

  const provisioner: SandboxProvisioner = {
    ensureSessionSandbox: (sessionId, env) => ensure("session", sessionId, env),
    deprovisionSessionSandbox: (sessionId) => deprovision("session", sessionId),
    ensureWorkflowSandbox: (executionId, env) =>
      ensure("workflow", executionId, env),
    deprovisionWorkflowSandbox: (executionId) =>
      deprovision("workflow", executionId),
    async createConnectSandbox(connectRequestId, env) {
      await ensure("connect", connectRequestId, env);
      return connectRequestId;
    },
    deprovisionConnectSandbox: (sandboxId) => deprovision("connect", sandboxId),
    async probe(scope, id): Promise<SandboxProbeState> {
      const actor = await gateway.getActor(sandboxBaseName(scope, id));
      if (actor === undefined) return "absent";
      return actor.state === ActorState.RUNNING ||
        actor.state === ActorState.RESUMING
        ? "running"
        : "stopped";
    },
  };

  const lifecycle: SubstrateSandboxLifecycle = {
    pause: (scope, id) => {
      const name = sandboxBaseName(scope, id);
      return serialize(name, () => gateway.pauseActor(name));
    },
    suspend: (scope, id) => {
      const name = sandboxBaseName(scope, id);
      return serialize(name, () => gateway.suspendActor(name));
    },
    resume: (scope, id, env) => ensure(scope, id, env),
    delete: (scope, id) => deprovision(scope, id),
    reattach: (scope, id, env) => {
      assertQueue(scope, id, env.taskQueue);
      const name = sandboxBaseName(scope, id);
      return serialize(name, () => push(name, env));
    },
    async list() {
      return (await gateway.listActors()).map(summaryOf);
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
      moveToCurrent,
    },
  };
}

const STATE_WORDS: Record<ActorState, SubstrateSandboxState> = {
  [ActorState.UNSPECIFIED]: "unknown",
  [ActorState.RESUMING]: "resuming",
  [ActorState.RUNNING]: "running",
  [ActorState.SUSPENDING]: "suspending",
  [ActorState.SUSPENDED]: "suspended",
  [ActorState.PAUSING]: "pausing",
  [ActorState.PAUSED]: "paused",
  [ActorState.CRASHED]: "crashed",
  [ActorState.DELETING]: "deleting",
  [ActorState.REVERTING]: "reverting",
};

function summaryOf(actor: SubstrateActorView): SubstrateActorSummary {
  return {
    name: actor.name,
    state: STATE_WORDS[actor.state] ?? "unknown",
    template: actor.template,
    createTime: actor.createTime,
    updateTime: actor.updateTime,
  };
}
