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
 *   - every Secret reference in the template is optional, so a running
 *     sandbox whose server stopped setting a key still starts its runner;
 *   - two ensures of one sandbox never interleave their writes, and a
 *     failed one leaves the queue usable;
 *   - the sweep's suspend patches a Running Sandbox only when its guard,
 *     asked inside the queue, agrees, and skips one that is gone, being
 *     deleted or already Suspended without asking; a suspend and an ensure
 *     of one Sandbox take turns in its queue, neither starting before the
 *     other ends; the driver remembers its last ensure of each Sandbox
 *     until it deprovisions it.
 */
import { describe, expect, it } from "vitest";

import { sandboxBaseName } from "../../naming.js";
import type {
  SandboxDriverConfig,
  SandboxEnvironment,
} from "../../provisioner.js";
import { FakeAgentSandboxCluster } from "../__test-utils__/fake-gateway.js";
import {
  newAgentSandboxDriverOverGateway,
  newAgentSandboxProvisionerOverGateway,
} from "../driver.js";
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
      `agent-sandbox Sandbox '${name}' is still being deleted after 300s`,
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

  it("a running sandbox whose server stopped setting a secret keeps a template every rewritten Secret satisfies", async () => {
    const cluster = new FakeAgentSandboxCluster();
    const before: SandboxDriverConfig = {
      ...config,
      runnerSecretEnv: { ANTHROPIC_API_KEY: "sk-test" },
    };
    await driverOver(cluster, { config: before }).ensureSessionSandbox(
      "ses_1",
      env,
    );
    // The server restarts without the secret, and the token goes empty.
    await driverOver(cluster).ensureSessionSandbox("ses_1", {
      ...env,
      stigmerToken: "",
    });
    const secret = cluster.secrets.get(`${name}-env`);
    expect(secret?.stringData).toEqual({});
    const refs = (
      cluster.sandboxes.get(name)?.podTemplate.spec.containers[0]?.env ?? []
    ).flatMap((entry) =>
      entry.valueFrom?.secretKeyRef ? [entry.valueFrom.secretKeyRef] : [],
    );
    expect(refs.map((ref) => ref.key).sort()).toEqual([
      "ANTHROPIC_API_KEY",
      "STIGMER_TOKEN",
    ]);
    // A key the Secret no longer holds leaves its variable unset rather
    // than refusing the container's start.
    for (const ref of refs) {
      const present = Object.keys(secret?.stringData ?? {}).includes(ref.key);
      expect(present || ref.optional === true, ref.key).toBe(true);
    }
  });

  it("a failed ensure leaves the sandbox's queue usable", async () => {
    const cluster = new FakeAgentSandboxCluster();
    const driver = driverOver(cluster);
    const applySecret = cluster.applySecret.bind(cluster);
    cluster.applySecret = async () => {
      throw new Error("the API server refused");
    };
    await expect(driver.ensureSessionSandbox("ses_1", env)).rejects.toThrow(
      "the API server refused",
    );
    cluster.applySecret = applySecret;
    await driver.ensureSessionSandbox("ses_1", env);
    expect(cluster.sandboxes.get(name)?.operatingMode).toBe("Running");
    await driver.deprovisionSessionSandbox("ses_1");
    expect(cluster.sandboxes.size).toBe(0);
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

  it("a connect sandbox takes the same path under its own name", async () => {
    const cluster = new FakeAgentSandboxCluster();
    const driver = driverOver(cluster);
    expect(
      await driver.createConnectSandbox("mcp_1", {
        ...env,
        taskQueue: "mcpconnect:mcp_1",
      }),
    ).toBe("mcp_1");
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
    await driver.deprovisionConnectSandbox("mcp_1");
    expect(
      cluster.calls.filter(
        (call) => !call.startsWith("get") && !call.startsWith("create"),
      ),
    ).toEqual([
      `secret:${name}-env`,
      `patch:${name}:Running+template`,
      `delete:${name}`,
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

describe("the sweep's suspend and the ensure record", () => {
  function driverWithInternals(cluster: FakeAgentSandboxCluster) {
    let t = 1_000;
    const driver = newAgentSandboxDriverOverGateway({
      gateway: cluster,
      config,
      logger: { info: () => {} },
      sleep: async () => {},
      now: () => t,
    });
    return { ...driver, tick: (ms: number) => (t += ms) };
  }

  it("suspends a Running Sandbox once the guard agrees, and skips it when it does not", async () => {
    const cluster = new FakeAgentSandboxCluster();
    const { internals } = driverWithInternals(cluster);
    cluster.seed(buildAgentSandbox("session", "ses_1", env, config), "Running");
    expect(await internals.suspend(name, async () => false)).toBe("skipped");
    expect(cluster.sandboxes.get(name)?.operatingMode).toBe("Running");
    expect(await internals.suspend(name, async () => true)).toBe("done");
    expect(cluster.sandboxes.get(name)?.operatingMode).toBe("Suspended");
    expect(cluster.calls.at(-1)).toBe(`patch:${name}:Suspended`);
  });

  it("skips, without asking the guard, a Sandbox that is gone, being deleted or already Suspended", async () => {
    const cluster = new FakeAgentSandboxCluster();
    const { internals } = driverWithInternals(cluster);
    let asked = 0;
    const guard = async () => {
      asked += 1;
      return true;
    };
    expect(await internals.suspend(name, guard)).toBe("skipped");
    const sandbox = cluster.seed(
      buildAgentSandbox("session", "ses_1", env, config),
      "Suspended",
    );
    expect(await internals.suspend(name, guard)).toBe("skipped");
    sandbox.operatingMode = "Running";
    sandbox.deletingReads = 5;
    expect(await internals.suspend(name, guard)).toBe("skipped");
    expect(asked).toBe(0);
    expect(cluster.calls.filter((call) => call.startsWith("patch"))).toEqual(
      [],
    );
  });

  it("a suspend waits behind an ensure of the same Sandbox, and an ensure behind a suspend", async () => {
    const cluster = new FakeAgentSandboxCluster();
    const { provisioner, internals } = driverWithInternals(cluster);
    cluster.seed(buildAgentSandbox("session", "ses_1", env, config), "Running");
    let release: () => void = () => {};
    const applySecret = cluster.applySecret.bind(cluster);
    cluster.applySecret = async (secret) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return applySecret(secret);
    };
    const ensured = provisioner.ensureSessionSandbox("ses_1", env);
    const suspended = internals.suspend(name, async () => true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    // The ensure holds the queue (blocked writing its Secret): the suspend
    // has not read the Sandbox yet.
    expect(cluster.calls).toEqual([`get:${name}`]);
    release();
    await Promise.all([ensured, suspended]);
    expect(cluster.calls).toEqual([
      `get:${name}`,
      `secret:${name}-env`,
      `get:${name}`,
      `patch:${name}:Suspended`,
    ]);

    cluster.calls.length = 0;
    cluster.applySecret = applySecret;
    let proceed: (answer: boolean) => void = () => {};
    const suspending = internals.suspend(
      name,
      () => new Promise<boolean>((resolve) => (proceed = resolve)),
    );
    cluster.sandboxes.get(name)!.operatingMode = "Running";
    const waking = provisioner.ensureSessionSandbox("ses_1", env);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(cluster.calls).toEqual([`get:${name}`]);
    proceed(false);
    await Promise.all([suspending, waking]);
    expect(cluster.calls).toEqual([
      `get:${name}`,
      `get:${name}`,
      `secret:${name}-env`,
    ]);
  });

  it("remembers when it last ensured a Sandbox, and forgets it on deprovision", async () => {
    const cluster = new FakeAgentSandboxCluster();
    const { provisioner, internals, tick } = driverWithInternals(cluster);
    expect(internals.lastEnsuredAt(name)).toBeUndefined();
    await provisioner.ensureSessionSandbox("ses_1", env);
    expect(internals.lastEnsuredAt(name)).toEqual(new Date(1_000));
    tick(5_000);
    await provisioner.ensureSessionSandbox("ses_1", env);
    expect(internals.lastEnsuredAt(name)).toEqual(new Date(6_000));
    await provisioner.deprovisionSessionSandbox("ses_1");
    expect(internals.lastEnsuredAt(name)).toBeUndefined();
  });
});
