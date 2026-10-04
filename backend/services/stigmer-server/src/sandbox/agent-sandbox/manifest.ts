/**
 * The agent-sandbox driver's pure manifest builders: the `Sandbox` it
 * creates, the pod template every wake writes into it, and the per-sandbox
 * Secret that carries the runner's token and secrets.
 *
 * What runs is the runner container the cloud edition's manifest
 * established and the previous open-source driver ran in a Deployment,
 * kept field for field so a sandbox looks the same whichever driver
 * started it: the runner command from runner-launch.ts in `/workspace`,
 * root with root's HOME (the image may be a base Stigmer did not build,
 * with its own USER and ENV), every capability dropped, the runtime's
 * default seccomp profile, FallbackToLogsOnError (a start-script refusal
 * lands in the pod's last-state message, where `kubectl describe pod`
 * shows it), no probes (the boot window is Temporal's
 * ScheduleToStartTimeout), a 600-second grace period so a SIGTERM'd runner
 * finishes streaming its turn, and 500m/512Mi requests with 2 CPU / 2Gi
 * limits. MODE is `local`: it selects the runner's proxy-transport posture,
 * not isolation, and open-source sandboxes talk to the server directly.
 *
 * Session and workflow sandboxes keep their workspace on one claim
 * (`workspace`, ReadWriteOnce, 10Gi, the cluster's default class), declared
 * as the Sandbox's one volume claim template, which the controller mounts
 * as the volume `workspace`. Durability is decided by scope alone: this
 * driver reads neither the environment's caller class nor any per-session
 * policy. A connect sandbox works on an emptyDir.
 *
 * The Secret is owned by the Sandbox (an owner reference without
 * blockOwnerDeletion, so the server needs no rights on the Sandbox's
 * finalizers), so deleting the Sandbox removes it with the pod and the
 * claim. Values that carry credentials (the token, the server's Temporal
 * connection settings, the operator's runner secrets) live only there; the
 * pod template names them by secretKeyRef.
 */
import type { V1EnvVar, V1PodSpec, V1Secret } from "@kubernetes/client-node";

import type {
  SandboxDriverConfig,
  SandboxEnvironment,
  SandboxScope,
} from "../provisioner.js";
import {
  SANDBOX_ID_LABEL,
  SANDBOX_MANAGED_BY_LABEL,
  SANDBOX_MANAGED_BY_VALUE,
  SANDBOX_SCOPE_LABEL,
  sandboxBaseName,
} from "../naming.js";
import {
  RUNNER_HOME,
  RUNNER_UID,
  SERVER_RELEASE_ENV,
  runnerCommand,
} from "../runner-launch.js";
import {
  AGENT_SANDBOX_API_VERSION,
  AGENT_SANDBOX_KIND,
  type AgentSandboxPodTemplate,
  type AgentSandboxResource,
} from "./resource.js";

const RUNNER_CONTAINER_NAME = "runner";
/** The volume (and claim template) name, and where the runner sees it. */
const WORKSPACE_VOLUME = "workspace";
const WORKSPACE_MOUNT_PATH = "/workspace";
const WORKSPACE_CLAIM_SIZE = "10Gi";
const TERMINATION_GRACE_PERIOD_SECONDS = 600;
const RUNNER_RESOURCES = {
  requests: { cpu: "500m", memory: "512Mi" },
  limits: { cpu: "2", memory: "2Gi" },
} as const;

/** The scopes whose workspace outlives the pod. */
const PERSISTENT_SCOPES: ReadonlySet<SandboxScope> = new Set([
  "session",
  "workflow",
]);

/** The stigmer labels on the Sandbox and on its pod. */
export function agentSandboxLabels(
  scope: SandboxScope,
  id: string,
): Record<string, string> {
  return {
    [SANDBOX_MANAGED_BY_LABEL]: SANDBOX_MANAGED_BY_VALUE,
    [SANDBOX_SCOPE_LABEL]: scope,
    [SANDBOX_ID_LABEL]: id,
  };
}

/** The per-sandbox Secret's name: the Sandbox's name plus `-env`. */
export function agentSandboxSecretName(
  scope: SandboxScope,
  id: string,
): string {
  return `${sandboxBaseName(scope, id)}-env`;
}

function runnerEnv(
  scope: SandboxScope,
  id: string,
  env: SandboxEnvironment,
  config: SandboxDriverConfig,
): V1EnvVar[] {
  const secretName = agentSandboxSecretName(scope, id);
  const fromSecret = (name: string): V1EnvVar => ({
    name,
    valueFrom: { secretKeyRef: { name: secretName, key: name } },
  });
  const entries: V1EnvVar[] = [
    { name: "MODE", value: "local" },
    { name: "STIGMER_TASK_QUEUE", value: env.taskQueue },
    { name: "STIGMER_BACKEND_ENDPOINT", value: config.backendEndpoint },
    { name: "TEMPORAL_SERVICE_ADDRESS", value: config.temporalAddress },
    { name: "TEMPORAL_NAMESPACE", value: config.temporalNamespace },
    { name: "WORKSPACE_ROOT_DIR", value: WORKSPACE_MOUNT_PATH },
    { name: "HOME", value: RUNNER_HOME },
  ];
  if (config.mcpPublicEndpoint !== "") {
    entries.push({
      name: "STIGMER_MCP_PUBLIC_ENDPOINT",
      value: config.mcpPublicEndpoint,
    });
  }
  if (config.serverRelease !== "") {
    entries.push({ name: SERVER_RELEASE_ENV, value: config.serverRelease });
  }
  for (const [name, value] of Object.entries(config.runnerEnv)) {
    entries.push({ name, value });
  }
  for (const name of Object.keys(config.runnerSecretEnv)) {
    entries.push(fromSecret(name));
  }
  if (env.stigmerToken !== "") {
    entries.push(fromSecret("STIGMER_TOKEN"));
  }
  for (const name of Object.keys(config.temporalConnectionEnv)) {
    entries.push(fromSecret(name));
  }
  return entries;
}

/**
 * The pod template: written at creation and again at every wake, so a
 * woken sandbox runs this server's runner image and environment.
 */
export function buildAgentSandboxPodTemplate(
  scope: SandboxScope,
  id: string,
  env: SandboxEnvironment,
  config: SandboxDriverConfig,
): AgentSandboxPodTemplate {
  const spec: V1PodSpec = {
    terminationGracePeriodSeconds: TERMINATION_GRACE_PERIOD_SECONDS,
    automountServiceAccountToken: false,
    securityContext: { seccompProfile: { type: "RuntimeDefault" } },
    containers: [
      {
        name: RUNNER_CONTAINER_NAME,
        image: config.runnerImage,
        // The image's CMD is /bin/bash by design; the driver sets the command.
        command: runnerCommand(),
        workingDir: WORKSPACE_MOUNT_PATH,
        env: runnerEnv(scope, id, env, config),
        resources: {
          requests: { ...RUNNER_RESOURCES.requests },
          limits: { ...RUNNER_RESOURCES.limits },
        },
        terminationMessagePolicy: "FallbackToLogsOnError",
        securityContext: {
          runAsUser: RUNNER_UID,
          runAsGroup: RUNNER_UID,
          allowPrivilegeEscalation: false,
          capabilities: { drop: ["ALL"] },
        },
        volumeMounts: [
          { name: WORKSPACE_VOLUME, mountPath: WORKSPACE_MOUNT_PATH },
        ],
      },
    ],
    // A persistent scope's volume comes from its claim template, which the
    // controller mounts under the template's name.
    ...(PERSISTENT_SCOPES.has(scope)
      ? {}
      : { volumes: [{ name: WORKSPACE_VOLUME, emptyDir: {} }] }),
  };
  return { metadata: { labels: agentSandboxLabels(scope, id) }, spec };
}

/** The Sandbox as created: Suspended, so its claim is made and no pod starts. */
export function buildAgentSandbox(
  scope: SandboxScope,
  id: string,
  env: SandboxEnvironment,
  config: SandboxDriverConfig,
): AgentSandboxResource {
  return {
    apiVersion: AGENT_SANDBOX_API_VERSION,
    kind: AGENT_SANDBOX_KIND,
    metadata: {
      name: sandboxBaseName(scope, id),
      labels: agentSandboxLabels(scope, id),
    },
    spec: {
      podTemplate: buildAgentSandboxPodTemplate(scope, id, env, config),
      ...(PERSISTENT_SCOPES.has(scope)
        ? {
            volumeClaimTemplates: [
              {
                metadata: { name: WORKSPACE_VOLUME },
                spec: {
                  accessModes: ["ReadWriteOnce"],
                  // No storageClassName: the cluster's default. Self-hosted
                  // clusters vary too much to pin a class here.
                  resources: { requests: { storage: WORKSPACE_CLAIM_SIZE } },
                },
              },
            ],
          }
        : {}),
      operatingMode: "Suspended",
    },
  };
}

/**
 * The per-sandbox Secret, owned by its Sandbox. A token-less sandbox still
 * gets its (possibly empty) Secret, so every sandbox has the same objects.
 */
export function buildAgentSandboxSecret(
  scope: SandboxScope,
  id: string,
  stigmerToken: string,
  config: Pick<
    SandboxDriverConfig,
    "temporalConnectionEnv" | "runnerSecretEnv"
  >,
  owner: { readonly name: string; readonly uid: string },
): V1Secret {
  return {
    metadata: {
      name: agentSandboxSecretName(scope, id),
      labels: agentSandboxLabels(scope, id),
      ownerReferences: [
        {
          apiVersion: AGENT_SANDBOX_API_VERSION,
          kind: AGENT_SANDBOX_KIND,
          name: owner.name,
          uid: owner.uid,
        },
      ],
    },
    type: "Opaque",
    stringData: {
      ...config.runnerSecretEnv,
      ...config.temporalConnectionEnv,
      ...(stigmerToken !== "" ? { STIGMER_TOKEN: stigmerToken } : {}),
    },
  };
}
