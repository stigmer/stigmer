/**
 * Pins the agent-sandbox driver's ensure, deprovision and probe over the
 * in-memory cluster (__test-utils__/fake-gateway.ts), no cluster:
 *
 *   - absent: the Sandbox is created Suspended, then the Secret (owned by
 *     it) is written and one patch sets Running with the pod template;
 *   - Suspended: the wake writes a fresh token and the CURRENT pod
 *     template, so a sandbox woken after an upgrade runs the new image;
 *   - Running: only the Secret's token is rewritten, nothing restarts;
 *   - a Sandbox being deleted is waited out, then created again; one that
 *     never goes fails loudly;
 *   - a Sandbox another server created between the read and the create is
 *     woken, not refused; one reported to exist that cannot then be read
 *     fails the ensure;
 *   - deprovision deletes the Sandbox alone (its pod, claim and Secret go
 *     by ownership); probe maps the mode onto absent/stopped/running;
 *   - two ensures of one sandbox never interleave their writes.
 */
import { describe, expect, it } from "vitest";

import { sandboxBaseName } from "../../naming.js";
import type {
  SandboxDriverConfig,
  SandboxEnvironment,
} from "../../provisioner.js";
import { FakeAgentSandboxCluster } from "../__test-utils__/fake-gateway.js";
import { newAgentSandboxProvisionerOverGateway } from "../driver.js";
import { buildAgentSandbox } from "../manifest.js";

const config: SandboxDriverConfig = {
  backendEndpoint: "http://stigmer-server.stigmer.svc:7234",
  mcpPublicEndpoint: "",
  temporalAddress: "temporal.stigmer.svc:7233",
  temporalNamespace: "stigmer",
  temporalConnectionEnv: {},
  runnerImage: "ghcr.io/stigmer/runner:v3.42.0",
  runnerCommand: "stigmer-runner",
  kubernetesNamespace: "stigmer-sandboxes",
  runnerEnv: {},
  runnerSecretEnv: {},
  serverRelease: "",
};

const env: SandboxEnvironment = {
  taskQueue: "session:ses_1",
  stigmerToken: "tok-1",
  callerClass: "user",
};

const name = sandboxBaseName("session", "ses_1");

function driverOver(
  cluster: FakeAgentSandboxCluster,
  options: {
    config?: SandboxDriverConfig;
    logged?: Array<Record<string, unknown>>;
  } = {},
) {
  return newAgentSandboxProvisionerOverGateway({
    gateway: cluster,
    config: options.config ?? config,
    logger: { info: (_msg, fields) => options.logged?.push(fields ?? {}) },
    sleep: async () => {},
  });
}

function imageOf(cluster: FakeAgentSandboxCluster): string | undefined {
  return cluster.sandboxes.get(name)?.podTemplate.spec.containers[0]?.image;
}

describe("the ensure", () => {
  it("absent: creates the Sandbox Suspended, writes its owned Secret, then wakes it with the template", async () => {
    const cluster = new FakeAgentSandboxCluster();
    const logged: Array<Record<string, unknown>> = [];
    await driverOver(cluster, { logged }).ensureSessionSandbox("ses_1", env);
    expect(cluster.calls).toEqual([
      `get:${name}`,
      `create:${name}:Suspended`,
      `secret:${name}-env`,
      `patch:${name}:Running+template`,
    ]);
    const sandbox = cluster.sandboxes.get(name);
    expect(sandbox?.operatingMode).toBe("Running");
    const secret = cluster.secrets.get(`${name}-env`);
    expect(secret?.stringData).toEqual({ STIGMER_TOKEN: "tok-1" });
    expect(secret?.metadata?.ownerReferences).toEqual([
      {
        apiVersion: "agents.x-k8s.io/v1beta1",
        kind: "Sandbox",
        name,
        uid: sandbox?.uid,
      },
    ]);
    expect(logged).toContainEqual(
      expect.objectContaining({ arm: "created", sandbox: name }),
    );
  });

  it("Suspended: the wake writes a fresh token and the current template, so a changed image is the one that runs", async () => {
    const cluster = new FakeAgentSandboxCluster();
    cluster.seed(
      buildAgentSandbox("session", "ses_1", env, {
        ...config,
        runnerImage: "ghcr.io/stigmer/runner:v3.41.0",
      }),
      "Suspended",
    );
    const logged: Array<Record<string, unknown>> = [];
    await driverOver(cluster, { logged }).ensureSessionSandbox("ses_1", {
      ...env,
      stigmerToken: "tok-2",
    });
    expect(cluster.calls).toEqual([
      `get:${name}`,
      `secret:${name}-env`,
      `patch:${name}:Running+template`,
    ]);
    expect(imageOf(cluster)).toBe("ghcr.io/stigmer/runner:v3.42.0");
    expect(cluster.secrets.get(`${name}-env`)?.stringData).toEqual({
      STIGMER_TOKEN: "tok-2",
    });
    expect(logged).toContainEqual(
      expect.objectContaining({ arm: "suspended" }),
    );
  });

  it("Running: rewrites the Secret's token and nothing else", async () => {
    const cluster = new FakeAgentSandboxCluster();
    cluster.seed(
      buildAgentSandbox("session", "ses_1", env, {
        ...config,
        runnerImage: "ghcr.io/stigmer/runner:v3.41.0",
      }),
      "Running",
    );
    const logged: Array<Record<string, unknown>> = [];
    await driverOver(cluster, { logged }).ensureSessionSandbox("ses_1", {
      ...env,
      stigmerToken: "tok-3",
    });
    expect(cluster.calls).toEqual([`get:${name}`, `secret:${name}-env`]);
    expect(
      imageOf(cluster),
      "a running sandbox is never moved to a new template",
    ).toBe("ghcr.io/stigmer/runner:v3.41.0");
    expect(cluster.secrets.get(`${name}-env`)?.stringData).toEqual({
      STIGMER_TOKEN: "tok-3",
    });
    expect(logged).toContainEqual(expect.objectContaining({ arm: "running" }));
  });

  it("a Sandbox being deleted is waited out, then created again", async () => {
    const cluster = new FakeAgentSandboxCluster();
    cluster.seed(
      buildAgentSandbox("session", "ses_1", env, config),
      "Running",
    ).deletingReads = 2;
    await driverOver(cluster).ensureSessionSandbox("ses_1", env);
    expect(cluster.calls).toEqual([
      `get:${name}`,
      `get:${name}`,
      `get:${name}`,
      `create:${name}:Suspended`,
      `secret:${name}-env`,
      `patch:${name}:Running+template`,
    ]);
  });

  it("a Sandbox that is never deleted fails the ensure loudly", async () => {
    const cluster = new FakeAgentSandboxCluster();
    cluster.seed(
      buildAgentSandbox("session", "ses_1", env, config),
      "Running",
    ).deletingReads = Number.MAX_SAFE_INTEGER;
    await expect(
      driverOver(cluster).ensureSessionSandbox("ses_1", env),
    ).rejects.toThrow(
      `agent-sandbox Sandbox '${name}' is still being deleted after 60s`,
    );
  });

  it("a Sandbox another server created between the read and the create is woken", async () => {
    const cluster = new FakeAgentSandboxCluster();
    cluster.createdElsewhere = buildAgentSandbox(
      "session",
      "ses_1",
      env,
      config,
    );
    await driverOver(cluster).ensureSessionSandbox("ses_1", env);
    expect(cluster.calls).toEqual([
      `get:${name}`,
      `create:${name}:Suspended`,
      `get:${name}`,
      `secret:${name}-env`,
      `patch:${name}:Running+template`,
    ]);
    expect(
      cluster.secrets.get(`${name}-env`)?.metadata?.ownerReferences?.[0]?.uid,
    ).toBe(cluster.sandboxes.get(name)?.uid);
  });

  it("a Sandbox reported to exist that then cannot be read fails the ensure", async () => {
    const cluster = new FakeAgentSandboxCluster();
    cluster.createSandbox = async () => undefined;
    await expect(
      driverOver(cluster).ensureSessionSandbox("ses_1", env),
    ).rejects.toThrow(
      `agent-sandbox Sandbox '${name}' was reported to exist and then could not be read`,
    );
  });

  it("waits out a deletion on the real clock when no sleep is given", async () => {
    const cluster = new FakeAgentSandboxCluster();
    cluster.seed(
      buildAgentSandbox("session", "ses_1", env, config),
      "Running",
    ).deletingReads = 1;
    const started = Date.now();
    await newAgentSandboxProvisionerOverGateway({
      gateway: cluster,
      config,
      logger: { info: () => {} },
    }).ensureSessionSandbox("ses_1", env);
    expect(Date.now() - started).toBeGreaterThanOrEqual(450);
    expect(cluster.sandboxes.get(name)?.operatingMode).toBe("Running");
  });

  it("a token-less sandbox still gets its Secret", async () => {
    const cluster = new FakeAgentSandboxCluster();
    await driverOver(cluster).ensureSessionSandbox("ses_1", {
      ...env,
      stigmerToken: "",
    });
    expect(cluster.secrets.get(`${name}-env`)?.stringData).toEqual({});
  });

  it("the runner's secrets are written into the Secret the ensure applies", async () => {
    const cluster = new FakeAgentSandboxCluster();
    await driverOver(cluster, {
      config: { ...config, runnerSecretEnv: { ANTHROPIC_API_KEY: "sk-test" } },
    }).ensureSessionSandbox("ses_1", env);
    expect(cluster.secrets.get(`${name}-env`)?.stringData).toEqual({
      ANTHROPIC_API_KEY: "sk-test",
      STIGMER_TOKEN: "tok-1",
    });
  });

  it("a workflow and a connect sandbox take the same path under their own names", async () => {
    const cluster = new FakeAgentSandboxCluster();
    const driver = driverOver(cluster);
    await driver.ensureWorkflowSandbox("wfx_1", {
      ...env,
      taskQueue: "wfexec:wfx_1",
    });
    expect(
      await driver.createConnectSandbox("mcp_1", {
        ...env,
        taskQueue: "mcpconnect:mcp_1",
      }),
    ).toBe("mcp_1");
    expect(
      cluster.sandboxes.get(sandboxBaseName("workflow", "wfx_1"))
        ?.operatingMode,
    ).toBe("Running");
    expect(
      cluster.sandboxes.get(sandboxBaseName("connect", "mcp_1"))?.operatingMode,
    ).toBe("Running");
  });

  it("two ensures of one sandbox never interleave their writes", async () => {
    const cluster = new FakeAgentSandboxCluster();
    const driver = driverOver(cluster);
    await Promise.all([
      driver.ensureSessionSandbox("ses_1", env),
      driver.ensureSessionSandbox("ses_1", env),
    ]);
    expect(cluster.calls).toEqual([
      `get:${name}`,
      `create:${name}:Suspended`,
      `secret:${name}-env`,
      `patch:${name}:Running+template`,
      `get:${name}`,
      `secret:${name}-env`,
    ]);
  });
});

describe("deprovision and probe", () => {
  it("deprovision deletes the Sandbox alone, for every scope, and a missing one is success", async () => {
    const cluster = new FakeAgentSandboxCluster();
    const driver = driverOver(cluster);
    await driver.ensureSessionSandbox("ses_1", env);
    await driver.deprovisionSessionSandbox("ses_1");
    await driver.deprovisionWorkflowSandbox("wfx_1");
    await driver.deprovisionConnectSandbox("mcp_1");
    expect(
      cluster.calls.filter(
        (call) => !call.startsWith("get") && !call.startsWith("create"),
      ),
    ).toEqual([
      `secret:${name}-env`,
      `patch:${name}:Running+template`,
      `delete:${name}`,
      `delete:${sandboxBaseName("workflow", "wfx_1")}`,
      `delete:${sandboxBaseName("connect", "mcp_1")}`,
    ]);
    expect(cluster.sandboxes.size).toBe(0);
  });

  it("probe maps the Sandbox onto absent, stopped and running", async () => {
    const cluster = new FakeAgentSandboxCluster();
    const driver = driverOver(cluster);
    expect(await driver.probe("session", "ses_1")).toBe("absent");
    const sandbox = cluster.seed(
      buildAgentSandbox("session", "ses_1", env, config),
      "Suspended",
    );
    expect(await driver.probe("session", "ses_1")).toBe("stopped");
    sandbox.operatingMode = "Running";
    expect(await driver.probe("session", "ses_1")).toBe("running");
    sandbox.deletingReads = 5;
    expect(await driver.probe("session", "ses_1")).toBe("absent");
  });
});
