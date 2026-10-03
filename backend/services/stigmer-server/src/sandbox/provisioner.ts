/**
 * The sandbox-provisioner driver seam. The contract generalizes the
 * cloud edition's production-proven Java
 * strategy interface (stigmer-cloud
 * domain/agentic/sandbox/SandboxProvisioner.java) so execution isolation
 * is an OSS capability: a provisioner creates, repairs, and tears down
 * the isolated runner that polls one execution-scoped Temporal task
 * queue.
 *
 * Scope vocabulary (the Java interface's three variants, kept exactly):
 *
 *   - SESSION: long-lived, one sandbox per session, ensure is IDEMPOTENT
 *     ensure-as-state-machine (absent → provision; stopped → start;
 *     running → fast path). Invoked non-critically after the execution's
 *     workflow starts (see steps.ts).
 *   - WORKFLOW: ephemeral, one sandbox per workflow execution (shared by
 *     the workflow AND its nested child agent executions via the wfexec:
 *     queue-override lane — dispatch.ts). Ensured critically BEFORE the
 *     execution persists; deprovisioned on the terminal phase transition.
 *   - CONNECT: request-scoped, NOT idempotent; the caller must
 *     deprovision when the connect settles. Every MCP connect provisions
 *     one when a provisioner is composed, and its workflow runs on the
 *     queue that sandbox serves (domain/mcpserver/connect-sandbox.ts,
 *     stigmer/stigmer#1474): with a provisioner the shared runner queue
 *     has no poller, since boot requires a per-queue routing mode beside
 *     one. Without a provisioner, connect keeps the shared queue.
 *
 * The probe is ensure-time LIVE-STATE inspection, never a boot-readiness
 * wait: the verified cloud design has NO readiness
 * probes — a sandbox that never polls its queue surfaces as the
 * activity's ScheduleToStartTimeout, with the ensure step's error
 * pre-stamp naming the root cause.
 *
 * Selection follows the artifact-storage precedent: built-in
 * drivers by name behind the SANDBOX_PROVISIONER_TYPE config knob,
 * extension-registered names beyond them (extensions/drivers.ts), an
 * unknown name a loud boot throw. The DEFAULT ("") is the external-runner
 * posture — no provisioner constructed, ensure never invoked — which IS
 * today's OSS behavior, named: an operator-managed
 * runner process polls the queues.
 */
import type { Logger } from "../boot/logger.js";
import type { CallerClass } from "../extensions/identity.js";

/**
 * What is TRUE about one provisioning request, handed to a driver: which
 * queue the sandboxed runner must poll, the credential it authenticates
 * with, and the class of the caller whose request is being served. Facts
 * only — what a driver DOES with them (the workspace's durability, the
 * pod's shape, whether a warm pool is consulted) is driver policy and
 * never travels here. Endpoints, images and resource shapes are driver
 * configuration, not per-sandbox state.
 */
export interface SandboxEnvironment {
  /** The Temporal task queue the sandboxed runner polls (session:{id} / wfexec:{id}). */
  readonly taskQueue: string;
  /**
   * The runner credential injected as STIGMER_TOKEN. "" means none was
   * minted (the provider's lane is disabled) — the sandbox still launches
   * and EC decrypt falls back to redaction, the oss#535 posture.
   */
  readonly stigmerToken: string;
  /**
   * The class of the caller whose request provisioned this sandbox — the
   * identity interceptor's word for it (`user`, `internal`, a composed
   * verifier's own lane such as a guest or a scheduled fire). A driver
   * that gives some session classes a workspace that does not outlive the
   * conversation reads it here; the built-in drivers (`local-process`,
   * `docker`, `kubernetes`) ignore it and keep every session persistent.
   * Required rather than optional so a construction site that forgets it
   * fails to compile instead of silently reading as a persistent user
   * session to every driver.
   */
  readonly callerClass: CallerClass;
}

/** One sandbox's observed live state (the live-state probe's result). */
export type SandboxProbeState = "absent" | "stopped" | "running";

/** The scope discriminant, shared by probe and the drivers' naming. */
export type SandboxScope = "session" | "workflow" | "connect";

/**
 * The driver contract. Implementations must be safe for concurrent use —
 * ensure calls for the same id may race (the cloud accepts check-then-act
 * overshoot) and every arm must be idempotent except connect
 * creation, which is documented one-shot.
 */
export interface SandboxProvisioner {
  /**
   * Ensure-as-state-machine for a session sandbox: absent → provision;
   * stopped → start; running → fast path. Idempotent; safe to invoke on
   * every execution create/recover for the session.
   */
  ensureSessionSandbox(
    sessionId: string,
    env: SandboxEnvironment,
  ): Promise<void>;
  /** Tears down the session sandbox; missing is success (idempotent). */
  deprovisionSessionSandbox(sessionId: string): Promise<void>;
  /**
   * Ensures the per-execution workflow sandbox. Same state-machine
   * semantics; the sandbox lives exactly as long as the execution runs.
   */
  ensureWorkflowSandbox(
    executionId: string,
    env: SandboxEnvironment,
  ): Promise<void>;
  /** Tears down the workflow sandbox; missing is success (idempotent). */
  deprovisionWorkflowSandbox(executionId: string): Promise<void>;
  /**
   * Creates a request-scoped connect sandbox and returns the provider's
   * sandbox id. NOT idempotent — the caller owns deprovision when the
   * connect settles (domain/mcpserver/connect-sandbox.ts).
   */
  createConnectSandbox(
    connectRequestId: string,
    env: SandboxEnvironment,
  ): Promise<string>;
  /** Tears down a connect sandbox by provider id; missing is success. */
  deprovisionConnectSandbox(sandboxId: string): Promise<void>;
  /** Live-state inspection — consumed by ensure arms and diagnostics. */
  probe(scope: SandboxScope, id: string): Promise<SandboxProbeState>;
  /**
   * Optional: work a driver runs in the background for as long as the
   * server serves, such as putting idle sandboxes to sleep. The
   * composition root starts it once the server has started its own
   * loops and stops it, awaited, before Temporal and the store close.
   * A driver without background work leaves it out; a composition that
   * wraps a driver and owns that work itself (a sweep over its own
   * records) simply does not expose it.
   */
  startBackground?(context: SandboxBackgroundContext): SandboxBackgroundHandle;
}

/**
 * What one session's executions say about it, for a driver deciding
 * whether its sandbox is idle: busy while any execution is pending, in
 * progress, waiting for approval or paused (isActiveExecutionPhase), and
 * the last moment the server itself stamped on one of them (an
 * execution's creation or completion), undefined when it has none.
 */
export interface SessionActivity {
  readonly busy: boolean;
  readonly lastActiveAt: Date | undefined;
}

/**
 * The server's read of its sessions for background work, over the store
 * alone (sandbox/session-activity.ts). `sessionIds` pages every session
 * id; a driver whose sandboxes carry no record of their session uses it
 * to map its sandbox names back.
 */
export interface SessionActivityReader {
  activity(sessionId: string): Promise<SessionActivity>;
  sessionIds(): AsyncIterable<string>;
}

/** What the composition root hands a driver's background work. */
export interface SandboxBackgroundContext {
  readonly sessions: SessionActivityReader;
  readonly logger: Logger;
}

/** A started driver's background work; `stop` resolves once it is idle. */
export interface SandboxBackgroundHandle {
  stop(): Promise<void>;
}

/**
 * Driver configuration resolved from ServerConfig — what every built-in
 * needs to launch a runner that can reach this server. Extension drivers
 * receive the same bag and may read their own env beyond it.
 */
export interface SandboxDriverConfig {
  /**
   * The server endpoint AS REACHABLE FROM INSIDE a sandbox (a container
   * cannot use this process's localhost). Injected as
   * STIGMER_BACKEND_ENDPOINT.
   */
  readonly backendEndpoint: string;
  /**
   * The server's PUBLIC address, the one a remote MCP server can dial back
   * (STIGMER_SANDBOX_MCP_PUBLIC_ENDPOINT). Injected as
   * STIGMER_MCP_PUBLIC_ENDPOINT, from which the runner fills a declared,
   * missing STIGMER_SERVER_ADDRESS (the runner's platform-server-address
   * module, stigmer/stigmer#1447). Empty injects nothing: the runner then
   * fills only its stdio children, and a remote server's templated address
   * stays unresolved rather than guessed.
   */
  readonly mcpPublicEndpoint: string;
  /** Temporal address as reachable from inside a sandbox (TEMPORAL_SERVICE_ADDRESS). */
  readonly temporalAddress: string;
  /** The Temporal namespace the sandbox's runner polls in (TEMPORAL_NAMESPACE). */
  readonly temporalNamespace: string;
  /**
   * How the sandbox's runner authenticates to that Temporal: the server's
   * own `STIGMER_TEMPORAL_*` settings rendered by `temporalConnectionEnv`
   * (`@stigmer/temporal-codecs`), every PEM item in its `_DATA` form so no
   * file has to exist inside the sandbox. Empty for a plaintext Temporal.
   * The values include credentials, so each driver passes them through the
   * channel it uses for the token, never through argv or a plain manifest
   * value.
   */
  readonly temporalConnectionEnv: Readonly<Record<string, string>>;
  /** The runner image for container-based drivers (docker/kubernetes). */
  readonly runnerImage: string;
  /** The runner executable for the local-process driver. */
  readonly runnerCommand: string;
  /** The namespace the kubernetes driver provisions into. */
  readonly kubernetesNamespace: string;
  /**
   * The operator's runner settings for every sandbox (ServerConfig
   * sandboxRunnerEnv): plain values, delivered the way a driver delivers
   * its endpoints. Required, like `callerClass`, so a construction site
   * that forgets them fails to compile.
   */
  readonly runnerEnv: Readonly<Record<string, string>>;
  /**
   * The operator's runner secrets for every sandbox (ServerConfig
   * sandboxRunnerSecretEnv), such as an open-source runner's model and
   * Cursor keys: delivered through the channel the driver uses for the
   * token, never argv or a plain manifest value.
   */
  readonly runnerSecretEnv: Readonly<Record<string, string>>;
}

/**
 * The runner variables a driver sets itself, per sandbox or from its own
 * configuration: never taken from the operator's runner lists
 * (SandboxDriverConfig.runnerEnv / runnerSecretEnv), so a listed name can
 * never replace a sandbox's queue, token or endpoints. The Temporal
 * connection names (`TEMPORAL_CONNECTION_ENV_NAMES`) are refused beside
 * these, and the attach waiter's own two settings, which configure the
 * sandbox's entry rather than its runner.
 */
export const SANDBOX_DRIVER_OWNED_RUNNER_ENV: readonly string[] = [
  "MODE",
  "STIGMER_TASK_QUEUE",
  "STIGMER_TOKEN",
  "STIGMER_BACKEND_ENDPOINT",
  "STIGMER_MCP_PUBLIC_ENDPOINT",
  "TEMPORAL_SERVICE_ADDRESS",
  "TEMPORAL_NAMESPACE",
  "WORKSPACE_ROOT_DIR",
  "STIGMER_ATTACH_PORT",
  "STIGMER_SANDBOX_NAME_FILE",
];

/** Constructs a driver. Factories, not instances — an unselected driver constructs nothing. */
export type SandboxProvisionerFactory = (options: {
  readonly config: SandboxDriverConfig;
  readonly logger: Logger;
}) => SandboxProvisioner;

/**
 * The built-in driver names — reserved: an extension registering one of
 * these is a boot throw (the registry's shadow rule, extensions/
 * registry.ts). The isolation ladder: process → Docker → Kubernetes,
 * then Agent Substrate (gVisor actors that sleep and wake with their
 * files, sandbox/substrate/).
 */
export const BUILT_IN_SANDBOX_PROVISIONER_TYPES = [
  "local-process",
  "docker",
  "kubernetes",
  "substrate",
] as const;

/**
 * Selects and constructs the configured provisioner, or undefined for
 * the default external-runner posture (type ""). Unknown names are a
 * loud boot throw — a typo'd knob must never silently run unisolated
 * (the validateR2Config precedent).
 */
export function newSandboxProvisioner(
  type: string,
  options: { readonly config: SandboxDriverConfig; readonly logger: Logger },
  builtInFactories: ReadonlyMap<string, SandboxProvisionerFactory>,
  registeredFactories: ReadonlyMap<string, SandboxProvisionerFactory>,
): SandboxProvisioner | undefined {
  if (type === "") {
    return undefined;
  }
  const factory = builtInFactories.get(type) ?? registeredFactories.get(type);
  if (factory === undefined) {
    const known = [
      ...builtInFactories.keys(),
      ...registeredFactories.keys(),
    ].sort();
    throw new Error(
      `unknown sandbox provisioner type '${type}' — known types: '${known.join("', '")}'`,
    );
  }
  return factory(options);
}
