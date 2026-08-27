/**
 * The Kubernetes sandbox driver — DD-002's third isolation tier, the
 * cloud edition's production provisioner GENERALIZED (stigmer-cloud
 * KubernetesSandboxProvisioner.java + SandboxManifestFactory.java, built
 * by O6 20260827.05; mechanism per the mid-session owner ruling:
 * @kubernetes/client-node, the official client — this driver is the one
 * the cloud composition will eventually run in production, C4).
 *
 * Each sandbox = a per-sandbox Secret (STIGMER_TOKEN) + a single-replica
 * Deployment (strategy Recreate) + a PVC-backed /workspace for the
 * persistent scopes (session, workflow — the Java persistent-scope
 * split; connect rides emptyDir). One shared namespace, never
 * per-sandbox namespaces. Naming and labels ride naming.ts (the Java
 * SandboxObjectNaming derivation).
 *
 * The ensure state machine (the Java arms, minus the cloud-only
 * archive/restore ladder and pool claim): Deployment absent → apply
 * Secret + PVC + Deployment (the repair arm — a surviving PVC is reused
 * by name); replicas 0 → scale to 1; replicas ≥ 1 → fast path. State is
 * the cluster's, never a store table (gate ruling Q4). NO readiness
 * probes and no post-apply wait, deliberately (gate ruling Q5): the boot
 * window is covered by Temporal's ScheduleToStartTimeout, and the ensure
 * step's error pre-stamp names provisioning failures.
 *
 * Stale-token posture (gate ruling Q6): OSS tokens are per-execution
 * re-mints — a running sandbox keeps the Secret it booted with (the
 * cloud's defer-restart discipline, cloud#485: never SIGTERM the
 * triggering turn); the repair and provision arms always write the
 * freshest token.
 *
 * Deliberate divergence from the cloud manifest, named: MODE=local, not
 * cloud — MODE selects the runner's proxy-transport posture (cloud-only
 * lanes), not isolation. OSS sandboxes talk to the backend directly.
 */
import {
  ApiException,
  AppsV1Api,
  CoreV1Api,
  KubeConfig,
} from "@kubernetes/client-node";
import type {
  V1Deployment,
  V1PersistentVolumeClaim,
  V1Secret,
} from "@kubernetes/client-node";

import type {
  SandboxDriverConfig,
  SandboxEnvironment,
  SandboxProbeState,
  SandboxProvisioner,
  SandboxProvisionerFactory,
  SandboxScope,
} from "./provisioner.js";
import {
  SANDBOX_ID_LABEL,
  SANDBOX_MANAGED_BY_LABEL,
  SANDBOX_MANAGED_BY_VALUE,
  SANDBOX_SCOPE_LABEL,
  sandboxBaseName,
} from "./naming.js";

// ---------------------------------------------------------------------------
// Manifest constants — the Java SandboxManifestFactory values, kept
// identical so a sandbox looks the same whichever edition provisioned it.
// ---------------------------------------------------------------------------

/** The runner container name (SandboxManifestFactory). */
const RUNNER_CONTAINER_NAME = "runner";
/** The image CMD is /bin/bash by design — the provisioner sets the command. */
const RUNNER_COMMAND = ["node", "/runner/dist/main.js"];
/** The in-pod workspace mount (SandboxManifestFactory WORKSPACE mount). */
const WORKSPACE_MOUNT_PATH = "/workspace";
/** Persistent-scope workspace claim size (the Java default). */
const WORKSPACE_PVC_SIZE = "10Gi";
/**
 * Drain window for a full runner turn (SandboxManifestFactory's
 * terminationGracePeriodSeconds — a SIGTERM'd runner finishes streaming
 * before the kill).
 */
const TERMINATION_GRACE_PERIOD_SECONDS = 600;
/** The Java resource shape: requests 500m/512Mi, limits 2 CPU / 2Gi. */
const RUNNER_RESOURCES = {
  requests: { cpu: "500m", memory: "512Mi" },
  limits: { cpu: "2", memory: "2Gi" },
} as const;

/** The persistent-workspace scopes (SandboxScope.persistentWorkspace). */
const PERSISTENT_SCOPES: ReadonlySet<SandboxScope> = new Set([
  "session",
  "workflow",
]);

// ---------------------------------------------------------------------------
// The gateway seam — the ONLY surface touching the client (the Java
// SandboxKubernetesGateway shape): manifest logic stays pure above it,
// and a client swap (or a test fake) never touches ensure semantics.
// ---------------------------------------------------------------------------

export interface KubernetesSandboxGateway {
  /** Replicas of the named Deployment; undefined when it does not exist. */
  deploymentReplicas(name: string): Promise<number | undefined>;
  applySecret(secret: V1Secret): Promise<void>;
  applyPvc(pvc: V1PersistentVolumeClaim): Promise<void>;
  applyDeployment(deployment: V1Deployment): Promise<void>;
  scaleDeployment(name: string, replicas: number): Promise<void>;
  /** Deletes are idempotent — missing objects are success. */
  deleteDeployment(name: string): Promise<void>;
  deleteSecret(name: string): Promise<void>;
  deletePvc(name: string): Promise<void>;
}

function newClientGateway(namespace: string): KubernetesSandboxGateway {
  const kubeConfig = new KubeConfig();
  // In-cluster service account or the operator's kubeconfig — the client's
  // standard resolution order, exactly what kubectl would use.
  kubeConfig.loadFromDefault();
  const apps = kubeConfig.makeApiClient(AppsV1Api);
  const core = kubeConfig.makeApiClient(CoreV1Api);

  function isNotFound(error: unknown): boolean {
    return error instanceof ApiException && error.code === 404;
  }
  function isConflict(error: unknown): boolean {
    return error instanceof ApiException && error.code === 409;
  }

  return {
    async deploymentReplicas(name) {
      try {
        const deployment = await apps.readNamespacedDeployment({
          name,
          namespace,
        });
        return deployment.spec?.replicas ?? 0;
      } catch (error) {
        if (isNotFound(error)) {
          return undefined;
        }
        throw error;
      }
    },
    async applySecret(secret) {
      try {
        await core.createNamespacedSecret({ namespace, body: secret });
      } catch (error) {
        if (!isConflict(error)) {
          throw error;
        }
        await core.replaceNamespacedSecret({
          name: secret.metadata?.name ?? "",
          namespace,
          body: secret,
        });
      }
    },
    async applyPvc(pvc) {
      try {
        await core.createNamespacedPersistentVolumeClaim({
          namespace,
          body: pvc,
        });
      } catch (error) {
        // An existing claim is REUSED, never replaced — PVC specs are
        // mostly immutable and the surviving workspace is the point of
        // the repair arm.
        if (!isConflict(error)) {
          throw error;
        }
      }
    },
    async applyDeployment(deployment) {
      try {
        await apps.createNamespacedDeployment({ namespace, body: deployment });
      } catch (error) {
        if (!isConflict(error)) {
          throw error;
        }
        await apps.replaceNamespacedDeployment({
          name: deployment.metadata?.name ?? "",
          namespace,
          body: deployment,
        });
      }
    },
    async scaleDeployment(name, replicas) {
      // Read-then-replace of the Scale subresource: the client's patch
      // call defaults to JSON-Patch encoding, which rejects a plain
      // merge body (proven live on kind, 2026-08-27) — replace is
      // explicit and stable across client versions.
      const scale = await apps.readNamespacedDeploymentScale({
        name,
        namespace,
      });
      scale.spec = { ...(scale.spec ?? {}), replicas };
      await apps.replaceNamespacedDeploymentScale({
        name,
        namespace,
        body: scale,
      });
    },
    async deleteDeployment(name) {
      try {
        await apps.deleteNamespacedDeployment({ name, namespace });
      } catch (error) {
        if (!isNotFound(error)) {
          throw error;
        }
      }
    },
    async deleteSecret(name) {
      try {
        await core.deleteNamespacedSecret({ name, namespace });
      } catch (error) {
        if (!isNotFound(error)) {
          throw error;
        }
      }
    },
    async deletePvc(name) {
      try {
        await core.deleteNamespacedPersistentVolumeClaim({ name, namespace });
      } catch (error) {
        if (!isNotFound(error)) {
          throw error;
        }
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Pure manifest builders (the SandboxManifestFactory half).
// ---------------------------------------------------------------------------

function sandboxLabels(
  scope: SandboxScope,
  id: string,
): Record<string, string> {
  return {
    [SANDBOX_MANAGED_BY_LABEL]: SANDBOX_MANAGED_BY_VALUE,
    [SANDBOX_SCOPE_LABEL]: scope,
    [SANDBOX_ID_LABEL]: id,
  };
}

export function buildSandboxSecret(
  scope: SandboxScope,
  id: string,
  stigmerToken: string,
): V1Secret {
  return {
    metadata: {
      name: `${sandboxBaseName(scope, id)}-env`,
      labels: sandboxLabels(scope, id),
    },
    type: "Opaque",
    // A token-less sandbox still gets its (empty) Secret — the object
    // must exist for uniform cleanup (the Java posture).
    stringData: stigmerToken !== "" ? { STIGMER_TOKEN: stigmerToken } : {},
  };
}

export function buildWorkspacePvc(
  scope: SandboxScope,
  id: string,
): V1PersistentVolumeClaim {
  return {
    metadata: {
      name: `${sandboxBaseName(scope, id)}-workspace`,
      labels: sandboxLabels(scope, id),
    },
    spec: {
      accessModes: ["ReadWriteOnce"],
      // No storageClassName: the cluster default. Self-host clusters vary
      // too much to pin the cloud's class here; an operator overrides at
      // the cluster level.
      resources: { requests: { storage: WORKSPACE_PVC_SIZE } },
    },
  };
}

export function buildSandboxDeployment(
  scope: SandboxScope,
  id: string,
  env: SandboxEnvironment,
  config: SandboxDriverConfig,
): V1Deployment {
  const baseName = sandboxBaseName(scope, id);
  const labels = sandboxLabels(scope, id);
  const persistent = PERSISTENT_SCOPES.has(scope);

  const containerEnv: Array<{
    name: string;
    value?: string;
    valueFrom?: {
      secretKeyRef: { name: string; key: string; optional?: boolean };
    };
  }> = [
    { name: "MODE", value: "local" },
    { name: "STIGMER_TASK_QUEUE", value: env.taskQueue },
    { name: "STIGMER_BACKEND_ENDPOINT", value: config.backendEndpoint },
    { name: "TEMPORAL_SERVICE_ADDRESS", value: config.temporalAddress },
    { name: "WORKSPACE_ROOT_DIR", value: WORKSPACE_MOUNT_PATH },
  ];
  if (env.stigmerToken !== "") {
    containerEnv.push({
      name: "STIGMER_TOKEN",
      valueFrom: {
        secretKeyRef: { name: `${baseName}-env`, key: "STIGMER_TOKEN" },
      },
    });
  }

  return {
    metadata: { name: baseName, labels },
    spec: {
      replicas: 1,
      // Recreate, never RollingUpdate: two runners polling one sandbox
      // queue mid-rollout would race the workspace (the Java strategy).
      strategy: { type: "Recreate" },
      selector: {
        matchLabels: {
          [SANDBOX_MANAGED_BY_LABEL]: SANDBOX_MANAGED_BY_VALUE,
          [SANDBOX_ID_LABEL]: id,
        },
      },
      template: {
        metadata: { labels },
        spec: {
          terminationGracePeriodSeconds: TERMINATION_GRACE_PERIOD_SECONDS,
          automountServiceAccountToken: false,
          securityContext: { seccompProfile: { type: "RuntimeDefault" } },
          containers: [
            {
              name: RUNNER_CONTAINER_NAME,
              image: config.runnerImage,
              command: [...RUNNER_COMMAND],
              env: containerEnv,
              resources: {
                requests: { ...RUNNER_RESOURCES.requests },
                limits: { ...RUNNER_RESOURCES.limits },
              },
              securityContext: {
                allowPrivilegeEscalation: false,
                capabilities: { drop: ["ALL"] },
              },
              volumeMounts: [
                { name: "workspace", mountPath: WORKSPACE_MOUNT_PATH },
              ],
            },
          ],
          volumes: [
            persistent
              ? {
                  name: "workspace",
                  persistentVolumeClaim: { claimName: `${baseName}-workspace` },
                }
              : { name: "workspace", emptyDir: {} },
          ],
        },
      },
    },
  };
}

// ---------------------------------------------------------------------------
// The driver.
// ---------------------------------------------------------------------------

export const newKubernetesSandboxProvisioner: SandboxProvisionerFactory = ({
  config,
  logger,
}) => {
  if (config.backendEndpoint === "") {
    throw new Error(
      "sandbox provisioner 'kubernetes' requires STIGMER_SANDBOX_BACKEND_ENDPOINT — a pod cannot reach the server on this process's localhost",
    );
  }
  if (config.temporalAddress === "") {
    throw new Error(
      "sandbox provisioner 'kubernetes' requires STIGMER_SANDBOX_TEMPORAL_ADDRESS (or TEMPORAL_HOST_PORT) reachable from inside the cluster",
    );
  }
  const gateway = newClientGateway(config.kubernetesNamespace);
  return newKubernetesSandboxProvisionerOverGateway(gateway, config, logger);
};

/**
 * The driver over an injected gateway — the unit-test seam (the live
 * factory above builds the client gateway; tests inject a fake and pin
 * the ensure arms without a cluster).
 */
export function newKubernetesSandboxProvisionerOverGateway(
  gateway: KubernetesSandboxGateway,
  config: SandboxDriverConfig,
  logger: {
    info: (msg: string, fields?: Record<string, unknown>) => void;
  },
): SandboxProvisioner {
  async function ensure(
    scope: SandboxScope,
    id: string,
    env: SandboxEnvironment,
  ): Promise<void> {
    const baseName = sandboxBaseName(scope, id);
    const replicas = await gateway.deploymentReplicas(baseName);
    if (replicas === undefined) {
      // Absent → provision/repair: Secret first (the Deployment's env
      // references it), claim (reused when it survived a repair), then
      // the Deployment. No readiness wait (module header).
      await gateway.applySecret(
        buildSandboxSecret(scope, id, env.stigmerToken),
      );
      if (PERSISTENT_SCOPES.has(scope)) {
        await gateway.applyPvc(buildWorkspacePvc(scope, id));
      }
      await gateway.applyDeployment(
        buildSandboxDeployment(scope, id, env, config),
      );
      logger.info("Kubernetes sandbox provisioned", {
        scope,
        id,
        deployment: baseName,
        taskQueue: env.taskQueue,
      });
      return;
    }
    if (replicas === 0) {
      await gateway.scaleDeployment(baseName, 1);
      logger.info("Kubernetes sandbox scaled up", {
        scope,
        id,
        deployment: baseName,
      });
      return;
    }
    // Running → fast path (the Java ~1-2s arm): the pod keeps the token
    // it booted with (defer-restart, module header).
  }

  async function deprovision(scope: SandboxScope, id: string): Promise<void> {
    const baseName = sandboxBaseName(scope, id);
    await gateway.deleteDeployment(baseName);
    await gateway.deleteSecret(`${baseName}-env`);
    if (PERSISTENT_SCOPES.has(scope)) {
      await gateway.deletePvc(`${baseName}-workspace`);
    }
    logger.info("Kubernetes sandbox deprovisioned", {
      scope,
      id,
      deployment: baseName,
    });
  }

  return {
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
      const replicas = await gateway.deploymentReplicas(
        sandboxBaseName(scope, id),
      );
      if (replicas === undefined) {
        return "absent";
      }
      return replicas === 0 ? "stopped" : "running";
    },
  };
}
