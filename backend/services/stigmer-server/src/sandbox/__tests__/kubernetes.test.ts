/**
 * Pins the Kubernetes driver's ensure state machine and manifest shapes
 * against the Java provisioner it generalizes (§6d, O6) — over a fake
 * gateway, no cluster:
 *
 *   - absent → Secret first, PVC for persistent scopes, then Deployment;
 *     no readiness wait (gate ruling Q5);
 *   - replicas 0 → scale to 1, nothing re-applied;
 *   - running → the fast path applies nothing (defer-restart, Q6);
 *   - deprovision deletes Deployment + Secret (+ PVC when persistent);
 *   - the manifests carry the Java shapes: Recreate, the runner command,
 *     MODE=local, the secretKeyRef token env only when a token exists,
 *     the empty Secret for token-less sandboxes.
 */
import { describe, expect, it } from "vitest";

import type {
  V1Deployment,
  V1PersistentVolumeClaim,
  V1Secret,
} from "@kubernetes/client-node";

import { sandboxBaseName } from "../naming.js";
import type { SandboxDriverConfig } from "../provisioner.js";
import type { KubernetesSandboxGateway } from "../kubernetes.js";
import {
  buildSandboxDeployment,
  buildSandboxSecret,
  newKubernetesSandboxProvisionerOverGateway,
} from "../kubernetes.js";

const silentLogger = { info: () => {} };

const config: SandboxDriverConfig = {
  backendEndpoint: "http://stigmer-server.stigmer.svc:7234",
  temporalAddress: "temporal.stigmer.svc:7233",
  runnerImage: "ghcr.io/stigmer/runner:latest",
  runnerCommand: "stigmer-runner",
  kubernetesNamespace: "stigmer-sandboxes",
};

function fakeGateway(
  replicasByName: Map<string, number>,
): KubernetesSandboxGateway & {
  calls: string[];
  applied: {
    secrets: V1Secret[];
    pvcs: V1PersistentVolumeClaim[];
    deployments: V1Deployment[];
  };
} {
  const calls: string[] = [];
  const applied = {
    secrets: [] as V1Secret[],
    pvcs: [] as V1PersistentVolumeClaim[],
    deployments: [] as V1Deployment[],
  };
  return {
    calls,
    applied,
    async deploymentReplicas(name) {
      calls.push(`replicas:${name}`);
      return replicasByName.get(name);
    },
    async applySecret(secret) {
      calls.push(`applySecret:${secret.metadata?.name ?? ""}`);
      applied.secrets.push(secret);
    },
    async applyPvc(pvc) {
      calls.push(`applyPvc:${pvc.metadata?.name ?? ""}`);
      applied.pvcs.push(pvc);
    },
    async applyDeployment(deployment) {
      calls.push(`applyDeployment:${deployment.metadata?.name ?? ""}`);
      applied.deployments.push(deployment);
    },
    async scaleDeployment(name, replicas) {
      calls.push(`scale:${name}:${replicas}`);
    },
    async deleteDeployment(name) {
      calls.push(`deleteDeployment:${name}`);
    },
    async deleteSecret(name) {
      calls.push(`deleteSecret:${name}`);
    },
    async deletePvc(name) {
      calls.push(`deletePvc:${name}`);
    },
  };
}

const env = { taskQueue: "session:ses_1", stigmerToken: "tok-1" };

describe("the ensure state machine", () => {
  it("absent → Secret, PVC, Deployment — in that order, no readiness wait", async () => {
    const gateway = fakeGateway(new Map());
    const driver = newKubernetesSandboxProvisionerOverGateway(
      gateway,
      config,
      silentLogger,
    );
    await driver.ensureSessionSandbox("ses_1", env);
    const base = sandboxBaseName("session", "ses_1");
    expect(gateway.calls).toEqual([
      `replicas:${base}`,
      `applySecret:${base}-env`,
      `applyPvc:${base}-workspace`,
      `applyDeployment:${base}`,
    ]);
  });

  it("connect scope rides emptyDir — no PVC applied", async () => {
    const gateway = fakeGateway(new Map());
    const driver = newKubernetesSandboxProvisionerOverGateway(
      gateway,
      config,
      silentLogger,
    );
    await driver.createConnectSandbox("mcp_1", env);
    expect(gateway.calls.some((c) => c.startsWith("applyPvc"))).toBe(false);
    const deployment = gateway.applied.deployments[0];
    expect(
      deployment?.spec?.template.spec?.volumes?.[0]?.emptyDir,
    ).toBeDefined();
  });

  it("stopped (replicas 0) → scale to 1, nothing re-applied", async () => {
    const base = sandboxBaseName("session", "ses_1");
    const gateway = fakeGateway(new Map([[base, 0]]));
    const driver = newKubernetesSandboxProvisionerOverGateway(
      gateway,
      config,
      silentLogger,
    );
    await driver.ensureSessionSandbox("ses_1", env);
    expect(gateway.calls).toEqual([`replicas:${base}`, `scale:${base}:1`]);
  });

  it("running → the fast path applies nothing (defer-restart)", async () => {
    const base = sandboxBaseName("session", "ses_1");
    const gateway = fakeGateway(new Map([[base, 1]]));
    const driver = newKubernetesSandboxProvisionerOverGateway(
      gateway,
      config,
      silentLogger,
    );
    await driver.ensureSessionSandbox("ses_1", env);
    expect(gateway.calls).toEqual([`replicas:${base}`]);
  });

  it("deprovision deletes Deployment + Secret + PVC for persistent scopes", async () => {
    const gateway = fakeGateway(new Map());
    const driver = newKubernetesSandboxProvisionerOverGateway(
      gateway,
      config,
      silentLogger,
    );
    await driver.deprovisionWorkflowSandbox("wfx_1");
    const base = sandboxBaseName("workflow", "wfx_1");
    expect(gateway.calls).toEqual([
      `deleteDeployment:${base}`,
      `deleteSecret:${base}-env`,
      `deletePvc:${base}-workspace`,
    ]);
  });

  it("probe maps replicas onto absent/stopped/running", async () => {
    const base = sandboxBaseName("session", "ses_1");
    for (const [replicas, expected] of [
      [undefined, "absent"],
      [0, "stopped"],
      [1, "running"],
    ] as const) {
      const gateway = fakeGateway(
        replicas === undefined ? new Map() : new Map([[base, replicas]]),
      );
      const driver = newKubernetesSandboxProvisionerOverGateway(
        gateway,
        config,
        silentLogger,
      );
      expect(await driver.probe("session", "ses_1")).toBe(expected);
    }
  });
});

describe("the manifest shapes (the Java SandboxManifestFactory pins)", () => {
  it("the Deployment carries Recreate, the runner command, and the env contract", () => {
    const deployment = buildSandboxDeployment("session", "ses_1", env, config);
    expect(deployment.spec?.strategy?.type).toBe("Recreate");
    const container = deployment.spec?.template.spec?.containers[0];
    expect(container?.command).toEqual(["node", "/runner/dist/main.js"]);
    const envByName = new Map(
      (container?.env ?? []).map((entry) => [entry.name, entry]),
    );
    expect(envByName.get("MODE")?.value).toBe("local");
    expect(envByName.get("STIGMER_TASK_QUEUE")?.value).toBe("session:ses_1");
    expect(envByName.get("STIGMER_BACKEND_ENDPOINT")?.value).toBe(
      config.backendEndpoint,
    );
    expect(envByName.get("TEMPORAL_SERVICE_ADDRESS")?.value).toBe(
      config.temporalAddress,
    );
    expect(envByName.get("WORKSPACE_ROOT_DIR")?.value).toBe("/workspace");
    expect(envByName.get("STIGMER_TOKEN")?.valueFrom?.secretKeyRef?.name).toBe(
      `${sandboxBaseName("session", "ses_1")}-env`,
    );
    expect(deployment.spec?.template.spec?.automountServiceAccountToken).toBe(
      false,
    );
  });

  it("a token-less sandbox omits the token env but keeps the (empty) Secret", () => {
    const tokenless = { taskQueue: "session:ses_1", stigmerToken: "" };
    const deployment = buildSandboxDeployment(
      "session",
      "ses_1",
      tokenless,
      config,
    );
    const names = (
      deployment.spec?.template.spec?.containers[0]?.env ?? []
    ).map((entry) => entry.name);
    expect(names).not.toContain("STIGMER_TOKEN");
    const secret = buildSandboxSecret("session", "ses_1", "");
    expect(secret.stringData).toEqual({});
  });
});
