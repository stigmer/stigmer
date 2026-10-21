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
 * Session sandboxes keep two claims, each a volume claim template of the
 * Sandbox, which the controller mounts as a volume of the template's name
 * (ReadWriteOnce, the cluster's default class): `workspace` (10Gi) at
 * `/workspace`, and `agent-home` (5Gi) at the agent's home, where the
 * Session's agent state lives (the native harness's checkpoints, the
 * platform directory, the approval gates), so a sleep or a replaced pod
 * keeps the agent's memory as well as its files (stigmer#2484). The home is
 * its own claim, not a folder of the workspace's: a Session that clones its
 * repository in place works at `/workspace` itself, where any other folder
 * would show in the person's tree, and where the turn's `.stigmer` link goes.
 * Claim templates are fixed when a Sandbox is made, so one made before the
 * home claim is woken without its mount and keeps its home on the pod until
 * it is made again. Durability is decided by scope alone: this driver reads
 * neither the environment's caller class nor any per-session policy. A
 * connect sandbox works on an emptyDir.
 *
 * The Secret is owned by the Sandbox (an owner reference without
 * blockOwnerDeletion, so the server needs no rights on the Sandbox's
 * finalizers), so deleting the Sandbox removes it with the pod and the
 * claim. Values that carry credentials (the token, the server's Temporal
 * connection settings, the operator's runner secrets) live only there; the
 * pod template names them by secretKeyRef.
 *
 * Every such reference is optional. A running sandbox keeps the pod (and
 * the template) it was woken with while each ensure rewrites its Secret
 * with this server's keys, so a key the server no longer sets (a secret
 * taken off the operator's list, a token no longer minted) would otherwise
 * stop the runner container at its next restart in that pod, or its pod's
 * next re-creation, until the sandbox slept. Optional, the variable is
 * simply unset, as it would be in a sandbox started now.
 */
import type { V1EnvVar, V1PodSpec, V1Secret } from "@kubernetes/client-node";

import type {
  SandboxDriverConfig,
  SandboxFacts,
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
  AGENT_HOME,
  RUNNER_HOME,
  RUNNER_CAPABILITIES,
  RUNNER_UID,
  SANDBOX_ENVIRONMENT_ENV,
  SERVER_RELEASE_ENV,
  runnerCommand,
} from "../runner-launch.js";
import { runnerEnvironmentValue } from "../environment.js";
import {
  AGENT_SANDBOX_API_VERSION,
  AGENT_SANDBOX_KIND,
  type AgentSandboxPodTemplate,
  type AgentSandboxResource,
  type AgentSandboxVolumeClaimTemplate,
} from "./resource.js";

const RUNNER_CONTAINER_NAME = "runner";
/** The volume (and claim template) name, and where the runner sees it. */
const WORKSPACE_VOLUME = "workspace";
const WORKSPACE_MOUNT_PATH = "/workspace";
const WORKSPACE_CLAIM_SIZE = "10Gi";
/** The agent's home's volume (and claim template) name. */
const AGENT_HOME_VOLUME = "agent-home";
const AGENT_HOME_CLAIM_SIZE = "5Gi";
const TERMINATION_GRACE_PERIOD_SECONDS = 600;
/**
 * What the runner keeps of the pod's grace for its own exit after its
 * worker drains (the harnesses' release, the connection's close, the
 * telemetry flush), so the drain never runs into the kill.
 */
const DRAIN_EXIT_MARGIN_SECONDS = 60;
/**
 * The runner's drain grace (the runner's `STIGMER_DRAIN_GRACE_MS`): how long
 * a turn in flight when the pod is told to stop may run to its next step
 * boundary before it is cut. Either way it continues on the next pod; this
 * is what keeps a running build from being cut and run again.
 */
const RUNNER_DRAIN_GRACE_MS = (TERMINATION_GRACE_PERIOD_SECONDS - DRAIN_EXIT_MARGIN_SECONDS) * 1000;
const RUNNER_RESOURCES = {
  requests: { cpu: "500m", memory: "512Mi" },
  limits: { cpu: "2", memory: "2Gi" },
} as const;

/** The scopes whose workspace outlives the pod. */
const PERSISTENT_SCOPES: ReadonlySet<SandboxScope> = new Set(["session"]);

/** Whether a Sandbox has the agent's home claim, by its claim templates' names: the pod template mounts the home only then. */
export function agentHomeOnClaim(claims: readonly string[]): boolean {
  return claims.includes(AGENT_HOME_VOLUME);
}

/** One ReadWriteOnce claim template on the cluster's default class. */
function claimTemplate(name: string, size: string): AgentSandboxVolumeClaimTemplate {
  return {
    metadata: { name },
    spec: {
      accessModes: ["ReadWriteOnce"],
      // No storageClassName: the cluster's default. Self-hosted
      // clusters vary too much to pin a class here.
      resources: { requests: { storage: size } },
    },
  };
}

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
  facts: SandboxFacts,
  config: SandboxDriverConfig,
): V1EnvVar[] {
  const secretName = agentSandboxSecretName(scope, id);
  const fromSecret = (name: string): V1EnvVar => ({
    name,
    valueFrom: {
      secretKeyRef: { name: secretName, key: name, optional: true },
    },
  });
  const entries: V1EnvVar[] = [
    { name: "MODE", value: "local" },
    { name: "STIGMER_TASK_QUEUE", value: facts.taskQueue },
    { name: "STIGMER_BACKEND_ENDPOINT", value: config.backendEndpoint },
    { name: "TEMPORAL_SERVICE_ADDRESS", value: config.temporalAddress },
    { name: "TEMPORAL_NAMESPACE", value: config.temporalNamespace },
    { name: "WORKSPACE_ROOT_DIR", value: WORKSPACE_MOUNT_PATH },
    { name: "HOME", value: RUNNER_HOME },
    { name: "STIGMER_DRAIN_GRACE_MS", value: String(RUNNER_DRAIN_GRACE_MS) },
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
  // The Environment's runner half: re-rendered at every wake, so an edit
  // reaches the sandbox at its next start.
  const environment = runnerEnvironmentValue(facts.environment);
  if (environment !== undefined) {
    entries.push({ name: SANDBOX_ENVIRONMENT_ENV, value: environment });
  }
  for (const [name, value] of Object.entries(config.runnerEnv)) {
    entries.push({ name, value });
  }
  for (const name of Object.keys(config.runnerSecretEnv)) {
    entries.push(fromSecret(name));
  }
  if (facts.stigmerToken !== "") {
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
 * `homeOnClaim` mounts the agent's home from its claim, which only a
 * Sandbox created with that claim has ({@link agentHomeOnClaim}).
 */
export function buildAgentSandboxPodTemplate(
  scope: SandboxScope,
  id: string,
  facts: SandboxFacts,
  config: SandboxDriverConfig,
  homeOnClaim: boolean,
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
        env: runnerEnv(scope, id, facts, config),
        resources: {
          requests: { ...RUNNER_RESOURCES.requests },
          limits: { ...RUNNER_RESOURCES.limits },
        },
        terminationMessagePolicy: "FallbackToLogsOnError",
        securityContext: {
          runAsUser: RUNNER_UID,
          runAsGroup: RUNNER_UID,
          allowPrivilegeEscalation: false,
          capabilities: { drop: ["ALL"], add: [...RUNNER_CAPABILITIES] },
        },
        volumeMounts: [
          { name: WORKSPACE_VOLUME, mountPath: WORKSPACE_MOUNT_PATH },
          ...(homeOnClaim ? [{ name: AGENT_HOME_VOLUME, mountPath: AGENT_HOME }] : []),
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
  facts: SandboxFacts,
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
      podTemplate: buildAgentSandboxPodTemplate(scope, id, facts, config, PERSISTENT_SCOPES.has(scope)),
      ...(PERSISTENT_SCOPES.has(scope)
        ? {
            volumeClaimTemplates: [
              claimTemplate(WORKSPACE_VOLUME, WORKSPACE_CLAIM_SIZE),
              claimTemplate(AGENT_HOME_VOLUME, AGENT_HOME_CLAIM_SIZE),
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
