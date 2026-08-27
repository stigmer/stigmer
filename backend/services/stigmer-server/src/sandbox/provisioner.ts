/**
 * The sandbox-provisioner driver seam — convergence program 20260826.02,
 * blueprint/03 §6d and DD-002, built by sub-project 20260827.05 (O6). The
 * contract generalizes the cloud edition's production-proven Java
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
 *     deprovision in a finally block. Carried in the contract for the
 *     cloud implementation (its MCP connect lane) — OSS does not invoke
 *     it today because OSS connect runs on the shared runner queue (a
 *     named non-goal, T01 gate ruling Q7).
 *
 * The probe is ensure-time LIVE-STATE inspection, never a boot-readiness
 * wait (gate ruling Q5): the verified cloud design has NO readiness
 * probes — a sandbox that never polls its queue surfaces as the
 * activity's ScheduleToStartTimeout, with the ensure step's error
 * pre-stamp naming the root cause.
 *
 * Selection follows the artifact-storage precedent (§6b): built-in
 * drivers by name behind the SANDBOX_PROVISIONER_TYPE config knob,
 * extension-registered names beyond them (extensions/drivers.ts), an
 * unknown name a loud boot throw. The DEFAULT ("") is the external-runner
 * posture — no provisioner constructed, ensure never invoked — which IS
 * today's OSS behavior, named (gate ruling Q1): an operator-managed
 * runner process polls the queues.
 */
import type { Logger } from "../boot/logger.js";

/**
 * The runtime handed to a provisioner for one sandbox: which queue the
 * sandboxed runner must poll and the credential it authenticates with.
 * Deliberately minimal (the Java SandboxEnvironment carries the same two
 * load-bearing fields plus cloud-only accounting) — endpoints, images,
 * and resource shapes are DRIVER configuration, not per-sandbox state.
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
}

/** One sandbox's observed live state (the Q5 probe result). */
export type SandboxProbeState = "absent" | "stopped" | "running";

/** The scope discriminant, shared by probe and the drivers' naming. */
export type SandboxScope = "session" | "workflow" | "connect";

/**
 * The driver contract. Implementations must be safe for concurrent use —
 * ensure calls for the same id may race (the cloud accepts check-then-act
 * overshoot, DD-002) and every arm must be idempotent except connect
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
   * sandbox id. NOT idempotent — the caller owns deprovision in a
   * finally block. Unused by OSS wiring today (module header).
   */
  createConnectSandbox(
    connectRequestId: string,
    env: SandboxEnvironment,
  ): Promise<string>;
  /** Tears down a connect sandbox by provider id; missing is success. */
  deprovisionConnectSandbox(sandboxId: string): Promise<void>;
  /** Live-state inspection (Q5) — consumed by ensure arms and diagnostics. */
  probe(scope: SandboxScope, id: string): Promise<SandboxProbeState>;
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
  /** Temporal address as reachable from inside a sandbox (TEMPORAL_SERVICE_ADDRESS). */
  readonly temporalAddress: string;
  /** The runner image for container-based drivers (docker/kubernetes). */
  readonly runnerImage: string;
  /** The runner executable for the local-process driver. */
  readonly runnerCommand: string;
  /** The namespace the kubernetes driver provisions into. */
  readonly kubernetesNamespace: string;
}

/** Constructs a driver. Factories, not instances — an unselected driver constructs nothing (§6b). */
export type SandboxProvisionerFactory = (options: {
  readonly config: SandboxDriverConfig;
  readonly logger: Logger;
}) => SandboxProvisioner;

/**
 * The built-in driver names — reserved: an extension registering one of
 * these is a boot throw (the registry's shadow rule, extensions/
 * registry.ts). DD-002's isolation ladder: process → Docker → Kubernetes.
 */
export const BUILT_IN_SANDBOX_PROVISIONER_TYPES = [
  "local-process",
  "docker",
  "kubernetes",
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
