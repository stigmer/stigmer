/**
 * Pins the agent-sandbox driver's manifests field by field:
 *
 *   - the Sandbox is `agents.x-k8s.io/v1beta1`, named sandboxBaseName,
 *     created Suspended, with the stigmer labels on it and on its pod, no
 *     Service, and for the persistent scopes one `workspace` claim template
 *     (ReadWriteOnce, 10Gi, the default class) whose volume the container
 *     mounts; a connect sandbox works on an emptyDir instead;
 *   - the runner container: the runner command in /workspace, root with
 *     root's HOME whatever the image says, every capability dropped, the
 *     default seccomp profile, FallbackToLogsOnError so a start-script
 *     refusal reaches the pod's last-state message, the 600-second grace
 *     period, the resource shape, no service-account token;
 *   - the environment contract: MODE=local, the queue, the endpoints, the
 *     runner's drain grace (the pod's grace less a minute for its exit,
 *     so a turn in flight finishes its step before the pod is killed), the
 *     public address and the server's release only when set, the
 *     operator's plain settings as values, and STIGMER_SANDBOX_ENVIRONMENT
 *     (the runner's half of the session's Environment, as JSON) only when
 *     the sandbox has one;
 *   - every credential (the token, the Temporal connection settings, the
 *     operator's runner secrets) lives in the Secret and is only named by
 *     the pod template, optionally, so a key the server stops setting never
 *     blocks a container's start; the Secret is owned by its Sandbox.
 */
import { describe, expect, it } from "vitest";

import { sandboxBaseName } from "../../naming.js";
import { runnerEnvironmentOf } from "../../environment.js";
import type {
  EnvironmentFacts,
  SandboxDriverConfig,
  SandboxFacts,
} from "../../provisioner.js";
import {
  RUNNER_HOME,
  RUNNER_UID,
  SANDBOX_ENVIRONMENT_ENV,
  SERVER_RELEASE_ENV,
  runnerCommand,
} from "../../runner-launch.js";
import {
  agentHomeOnClaim,
  buildAgentSandbox,
  buildAgentSandboxPodTemplate,
  buildAgentSandboxSecret,
} from "../manifest.js";

const config: SandboxDriverConfig = {
  backendEndpoint: "http://stigmer-server.stigmer.svc:7234",
  mcpPublicEndpoint: "https://api.example.com",
  temporalAddress: "temporal.stigmer.svc:7233",
  temporalNamespace: "stigmer",
  temporalConnectionEnv: {},
  runnerImage: "ghcr.io/stigmer/runner:latest",
  runnerCommand: "stigmer-runner",
  kubernetesNamespace: "stigmer-sandboxes",
  runnerEnv: {},
  runnerSecretEnv: {},
  serverRelease: "",
};

const env = {
  taskQueue: "session:ses_1",
  stigmerToken: "tok-1",
  callerClass: "user",
};
const base = sandboxBaseName("session", "ses_1");
const labels = {
  "stigmer.ai/managed-by": "stigmer-server",
  "stigmer.ai/scope": "session",
  "stigmer.ai/sandbox-id": "ses_1",
};

function containerOf(cfg: SandboxDriverConfig = config, sandboxEnv = env) {
  return buildAgentSandboxPodTemplate("session", "ses_1", sandboxEnv, cfg, true).spec
    .containers[0];
}

describe("the Sandbox", () => {
  it("is a v1beta1 Sandbox, created Suspended, labelled, with no Service, a workspace claim and the agent's home claim", () => {
    const sandbox = buildAgentSandbox("session", "ses_1", env, config);
    expect(sandbox.apiVersion).toBe("agents.x-k8s.io/v1beta1");
    expect(sandbox.kind).toBe("Sandbox");
    expect(sandbox.metadata).toEqual({ name: base, labels });
    expect(sandbox.spec.operatingMode).toBe("Suspended");
    expect(sandbox.spec.podTemplate.metadata.labels).toEqual(labels);
    expect(Object.keys(sandbox.spec)).not.toContain("service");
    expect(sandbox.spec.volumeClaimTemplates).toEqual([
      {
        metadata: { name: "workspace" },
        spec: {
          accessModes: ["ReadWriteOnce"],
          resources: { requests: { storage: "10Gi" } },
        },
      },
      {
        metadata: { name: "agent-home" },
        spec: {
          accessModes: ["ReadWriteOnce"],
          resources: { requests: { storage: "5Gi" } },
        },
      },
    ]);
    // The controller mounts a claim template as a volume of its name; the
    // template declares no volume of its own for it. The agent's home is
    // where the runner puts it when the deployment names none.
    expect(sandbox.spec.podTemplate.spec.volumes).toBeUndefined();
    expect(sandbox.spec.podTemplate.spec.containers[0]?.volumeMounts).toEqual([
      { name: "workspace", mountPath: "/workspace" },
      { name: "agent-home", mountPath: "/home/stigmer-agent" },
    ]);
    expect(agentHomeOnClaim(sandbox.spec.volumeClaimTemplates!.map((t) => t.metadata.name))).toBe(true);
  });

  it("a template for a Sandbox without the home claim mounts the workspace alone", () => {
    const template = buildAgentSandboxPodTemplate("session", "ses_1", env, config, false);
    expect(template.spec.containers[0]?.volumeMounts).toEqual([
      { name: "workspace", mountPath: "/workspace" },
    ]);
    expect(agentHomeOnClaim(["workspace"])).toBe(false);
  });

  it("a connect sandbox works on an emptyDir", () => {
    const connect = buildAgentSandbox("connect", "mcp_1", env, config);
    expect(connect.spec.volumeClaimTemplates).toBeUndefined();
    expect(connect.spec.podTemplate.spec.volumes).toEqual([
      { name: "workspace", emptyDir: {} },
    ]);
    expect(connect.spec.podTemplate.spec.containers[0]?.volumeMounts).toEqual([
      { name: "workspace", mountPath: "/workspace" },
    ]);
  });
});

describe("the runner container", () => {
  it("runs the runner command as root with root's HOME in /workspace, and keeps a refusal's line", () => {
    const template = buildAgentSandboxPodTemplate(
      "session",
      "ses_1",
      env,
      config,
      true,
    );
    const container = template.spec.containers[0];
    expect(container?.name).toBe("runner");
    expect(container?.image).toBe(config.runnerImage);
    expect(container?.command).toEqual(runnerCommand());
    expect(container?.workingDir).toBe("/workspace");
    expect(container?.securityContext).toEqual({
      runAsUser: RUNNER_UID,
      runAsGroup: RUNNER_UID,
      allowPrivilegeEscalation: false,
      capabilities: { drop: ["ALL"], add: ["SETUID", "SETGID", "CHOWN", "KILL", "DAC_OVERRIDE"] },
    });
    expect(container?.env).toContainEqual({ name: "HOME", value: RUNNER_HOME });
    expect(container?.terminationMessagePolicy).toBe("FallbackToLogsOnError");
    expect(container?.resources).toEqual({
      requests: { cpu: "500m", memory: "512Mi" },
      limits: { cpu: "2", memory: "2Gi" },
    });
    expect(container?.readinessProbe).toBeUndefined();
    expect(container?.livenessProbe).toBeUndefined();
    expect(template.spec.terminationGracePeriodSeconds).toBe(600);
    expect(template.spec.automountServiceAccountToken).toBe(false);
    expect(template.spec.securityContext).toEqual({
      seccompProfile: { type: "RuntimeDefault" },
    });
  });

  it("carries the environment contract", () => {
    const byName = new Map(
      (containerOf()?.env ?? []).map((entry) => [entry.name, entry]),
    );
    expect(byName.get("MODE")?.value).toBe("local");
    expect(byName.get("STIGMER_TASK_QUEUE")?.value).toBe("session:ses_1");
    expect(byName.get("STIGMER_BACKEND_ENDPOINT")?.value).toBe(
      config.backendEndpoint,
    );
    expect(byName.get("TEMPORAL_SERVICE_ADDRESS")?.value).toBe(
      config.temporalAddress,
    );
    expect(byName.get("TEMPORAL_NAMESPACE")?.value).toBe("stigmer");
    expect(byName.get("WORKSPACE_ROOT_DIR")?.value).toBe("/workspace");
    expect(byName.get("STIGMER_DRAIN_GRACE_MS")?.value).toBe("540000");
    expect(byName.get("STIGMER_MCP_PUBLIC_ENDPOINT")?.value).toBe(
      config.mcpPublicEndpoint,
    );
    expect(byName.get("STIGMER_TOKEN")?.valueFrom?.secretKeyRef).toEqual({
      name: `${base}-env`,
      key: "STIGMER_TOKEN",
      optional: true,
    });
  });

  it("a server with no public address hands the runner none", () => {
    const names = (
      containerOf({ ...config, mcpPublicEndpoint: "" })?.env ?? []
    ).map((entry) => entry.name);
    expect(names).not.toContain("STIGMER_MCP_PUBLIC_ENDPOINT");
  });

  it("a release server hands the start script its release; a development server hands none", () => {
    expect(
      containerOf({ ...config, serverRelease: "3.42.0" })?.env,
    ).toContainEqual({
      name: SERVER_RELEASE_ENV,
      value: "3.42.0",
    });
    expect((containerOf()?.env ?? []).map((entry) => entry.name)).not.toContain(
      SERVER_RELEASE_ENV,
    );
  });

  it("a sandbox with an Environment hands the runner its half as JSON; one without hands none", () => {
    const environment: EnvironmentFacts = {
      id: "env_1",
      network: { mode: "unrestricted" },
      packages: { apt: [], cargo: [], gem: [], go: [], npm: [], pip: ["requests"] },
    };
    const facts: SandboxFacts = { ...env, environment };
    const entry = (
      buildAgentSandboxPodTemplate("session", "ses_1", facts, config, true).spec
        .containers[0]?.env ?? []
    ).find((e) => e.name === SANDBOX_ENVIRONMENT_ENV);
    expect(entry?.valueFrom).toBeUndefined();
    expect(JSON.parse(entry?.value ?? "")).toEqual(
      runnerEnvironmentOf(environment),
    );
    expect((containerOf()?.env ?? []).map((e) => e.name)).not.toContain(
      SANDBOX_ENVIRONMENT_ENV,
    );
  });

  it("a token-less sandbox names no token", () => {
    const names = (
      containerOf(config, { ...env, stigmerToken: "" })?.env ?? []
    ).map((entry) => entry.name);
    expect(names).not.toContain("STIGMER_TOKEN");
  });
});

describe("credentials live in the Secret", () => {
  const owner = { name: base, uid: "uid-1" };

  it("an authenticated Temporal's settings live in the Secret and are only named by the pod template", () => {
    const connectionEnv = {
      STIGMER_TEMPORAL_TLS: "true",
      STIGMER_TEMPORAL_API_KEY: "api-key-1",
      STIGMER_TEMPORAL_TLS_SERVER_CA_CERT_DATA:
        "-----BEGIN CERTIFICATE-----\nca\n-----END CERTIFICATE-----\n",
    };
    const authenticated = { ...config, temporalConnectionEnv: connectionEnv };
    const secret = buildAgentSandboxSecret(
      "session",
      "ses_1",
      "tok",
      authenticated,
      owner,
    );
    expect(secret.stringData).toEqual({
      ...connectionEnv,
      STIGMER_TOKEN: "tok",
    });
    const container = containerOf(authenticated);
    for (const name of Object.keys(connectionEnv)) {
      const entry = (container?.env ?? []).find(
        (candidate) => candidate.name === name,
      );
      expect(
        entry?.value,
        `${name} must not be a plain manifest value`,
      ).toBeUndefined();
      expect(entry?.valueFrom?.secretKeyRef).toEqual({
        name: `${base}-env`,
        key: name,
        optional: true,
      });
    }
  });

  it("the operator's plain settings ride as values and its secrets ride the Secret, never the Sandbox", () => {
    const withLists: SandboxDriverConfig = {
      ...config,
      runnerEnv: { ANTHROPIC_BASE_URL: "http://gateway.example:8080" },
      runnerSecretEnv: { ANTHROPIC_API_KEY: "sk-test" },
    };
    const sandbox = buildAgentSandbox("session", "ses_1", env, withLists);
    const containerEnv = sandbox.spec.podTemplate.spec.containers[0]?.env ?? [];
    expect(containerEnv).toContainEqual({
      name: "ANTHROPIC_BASE_URL",
      value: "http://gateway.example:8080",
    });
    expect(containerEnv).toContainEqual({
      name: "ANTHROPIC_API_KEY",
      valueFrom: {
        secretKeyRef: {
          name: `${base}-env`,
          key: "ANTHROPIC_API_KEY",
          optional: true,
        },
      },
    });
    expect(JSON.stringify(sandbox)).not.toContain("sk-test");
    expect(JSON.stringify(sandbox)).not.toContain("tok-1");
    expect(
      buildAgentSandboxSecret("session", "ses_1", "tok", withLists, owner)
        .stringData,
    ).toEqual({
      ANTHROPIC_API_KEY: "sk-test",
      STIGMER_TOKEN: "tok",
    });
  });

  it("the Secret is labelled and owned by its Sandbox, without blocking its deletion", () => {
    const secret = buildAgentSandboxSecret(
      "session",
      "ses_1",
      "tok",
      config,
      owner,
    );
    expect(secret.metadata).toEqual({
      name: `${base}-env`,
      labels,
      ownerReferences: [
        {
          apiVersion: "agents.x-k8s.io/v1beta1",
          kind: "Sandbox",
          name: base,
          uid: "uid-1",
        },
      ],
    });
    expect(secret.type).toBe("Opaque");
  });
});
