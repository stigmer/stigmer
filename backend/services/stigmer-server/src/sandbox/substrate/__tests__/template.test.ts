/**
 * Pins the shared template and its keeper (template.ts):
 *
 *   - the template runs the attach waiter behind its /readyz probe, holds
 *     only plain per-target settings (no runner secret, no token), mounts
 *     the workspace and the actor's own name, and
 *     snapshots FULL on pause, DATA on commit, golden on resume;
 *   - HTTPS egress adds the gateway's trust bundle and points every tool's
 *     trust variable at it; off, neither is there;
 *   - its name is its content: the same input the same name, a new image a
 *     new name;
 *   - the keeper prepares once however many callers wait, waits for the
 *     golden snapshot, recreates a failed template once and then fails, and
 *     gives up after its cap.
 */
import { describe, expect, it } from "vitest";

import { createLogger } from "../../../boot/logger.js";
import type { SandboxDriverConfig } from "../../provisioner.js";
import { FakeSubstrate } from "../__test-utils__/fake-gateway.js";
import type { SubstrateDriverSettings } from "../config.js";
import {
  ActorMetadataField,
  ResumeSource,
  SandboxClass,
  SnapshotContentScope,
} from "../gen/ateapipb/ateapi_pb.js";
import { buildRunnerTemplate, newTemplateKeeper } from "../template.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

const config: SandboxDriverConfig = {
  backendEndpoint: "http://stigmer.stigmer.svc:7234",
  mcpPublicEndpoint: "http://stigmer-mcp.stigmer.svc:8080",
  temporalAddress: "temporal.stigmer.svc:7233",
  temporalNamespace: "default",
  temporalConnectionEnv: {},
  runnerImage: `localhost:5001/runner@sha256:${"a".repeat(64)}`,
  runnerCommand: "unused",
  kubernetesNamespace: "unused",
  runnerEnv: { ANTHROPIC_BASE_URL: "http://fake-model.example:18555" },
  runnerSecretEnv: { ANTHROPIC_API_KEY: "sk-test" },
};

const settings: SubstrateDriverSettings = {
  apiEndpoint: "https://api.ate-system.svc:443",
  apiServerName: "",
  apiCaFile: "",
  apiTokenFile: "/unused",
  routerUrl: "http://router.example:18200",
  atespace: "stigmer",
  storageLocation: "gs://ate-snapshots/stigmer",
  workerSelector: { workload: "stigmer" },
  sandboxConfigName: "gvisor-default",
  httpsEgress: "all",
  extraHttpEgress: [],
  pauseAfterSeconds: 300,
  suspendAfterSeconds: 1800,
  sweepIntervalSeconds: 60,
};

function envOf(
  template: ReturnType<typeof buildRunnerTemplate>,
): Record<string, string> {
  return Object.fromEntries(
    (template.containers[0]?.env ?? []).map((e) => [e.name, e.value]),
  );
}

describe("the template", () => {
  it("runs the waiter behind its probe with plain per-target settings only", () => {
    const template = buildRunnerTemplate({
      config,
      settings,
    });
    const container = template.containers[0];
    expect(container?.command).toEqual(["node", "/runner/dist/attach/main.js"]);
    expect(container?.image).toBe(config.runnerImage);
    expect(container?.wakeupProbe?.httpGet).toMatchObject({
      path: "/readyz",
      port: 80,
    });
    const env = envOf(template);
    expect(env).toMatchObject({
      MODE: "local",
      STIGMER_BACKEND_ENDPOINT: "http://stigmer.stigmer.svc:7234",
      TEMPORAL_SERVICE_ADDRESS: "temporal.stigmer.svc:7233",
      TEMPORAL_NAMESPACE: "default",
      WORKSPACE_ROOT_DIR: "/workspace",
      STIGMER_MCP_PUBLIC_ENDPOINT: "http://stigmer-mcp.stigmer.svc:8080",
      ANTHROPIC_BASE_URL: "http://fake-model.example:18555",
      STIGMER_SANDBOX_NAME_FILE: "/run/ate/actor-name",
    });
    for (const secret of [
      "ANTHROPIC_API_KEY",
      "STIGMER_TOKEN",
      "STIGMER_TEMPORAL_API_KEY",
      "STIGMER_TASK_QUEUE",
    ]) {
      expect(env).not.toHaveProperty(secret);
    }
    expect(Object.keys(env)).toEqual([...Object.keys(env)].sort());
  });

  it("mounts the workspace and the actor's name, and snapshots for the ladder", () => {
    const template = buildRunnerTemplate({
      config,
      settings: { ...settings, httpsEgress: "none" },
    });
    expect(template.volumes.map((v) => v.name)).toEqual([
      "workspace",
      "system-info",
    ]);
    expect(template.volumes[1]?.systemInfo?.dataSources).toEqual([
      expect.objectContaining({
        actorMetadata: expect.objectContaining({
          items: [
            expect.objectContaining({
              field: ActorMetadataField.NAME,
              path: "actor-name",
            }),
          ],
        }),
      }),
    ]);
    expect(template.sandboxConfig).toMatchObject({
      sandboxClass: SandboxClass.GVISOR,
      configName: "gvisor-default",
    });
    expect(template.snapshotConfig).toMatchObject({
      onPause: SnapshotContentScope.FULL,
      onCommit: SnapshotContentScope.DATA,
      onResume: { fromData: ResumeSource.GOLDEN },
      storageLocation: "gs://ate-snapshots/stigmer",
    });
    expect(template.workerSelector?.matchLabels).toEqual({
      workload: "stigmer",
    });
    expect(template.resources?.limits.map((l) => [l.name, l.quantity])).toEqual(
      [
        ["cpu", "2"],
        ["memory", "2Gi"],
      ],
    );
  });

  it("with HTTPS egress: projects the gateway's trust bundle and points every tool at it", () => {
    const template = buildRunnerTemplate({
      config,
      settings,
    });
    expect(
      template.volumes[1]?.systemInfo?.dataSources[0]?.trustBundle,
    ).toMatchObject({
      name: "egress-mitm.ate.dev",
      path: "trust-bundle.pem",
    });
    const env = envOf(template);
    for (const name of [
      "NODE_EXTRA_CA_CERTS",
      "SSL_CERT_FILE",
      "GIT_SSL_CAINFO",
      "CURL_CA_BUNDLE",
      "REQUESTS_CA_BUNDLE",
    ]) {
      expect(env[name]).toBe("/run/ate/trust-bundle.pem");
    }
    const off = envOf(
      buildRunnerTemplate({
        config,
        settings: { ...settings, httpsEgress: "none" },
      }),
    );
    expect(off).not.toHaveProperty("NODE_EXTRA_CA_CERTS");
  });

  it("is named by its content", () => {
    const a = buildRunnerTemplate({ config, settings }).metadata?.name;
    const b = buildRunnerTemplate({ config, settings }).metadata?.name;
    const c = buildRunnerTemplate({
      config: {
        ...config,
        runnerImage: `localhost:5001/runner@sha256:${"b".repeat(64)}`,
      },
      settings,
    }).metadata?.name;
    expect(a).toMatch(/^stigmer-runner-[0-9a-f]{12}$/);
    expect(b).toBe(a);
    expect(c).not.toBe(a);
  });
});

describe("the keeper", () => {
  function keeper(substrate: FakeSubstrate) {
    let t = 0;
    return newTemplateKeeper({
      gateway: substrate,
      template: buildRunnerTemplate({ config, settings }),
      logger: silentLogger,
      now: () => t,
      sleep: async (ms) => {
        t += ms;
      },
    });
  }

  it("prepares once however many callers wait, and reports ready only after", async () => {
    const substrate = new FakeSubstrate();
    substrate.goldenPolls = 3;
    const k = keeper(substrate);
    expect(k.readyNow()).toBe(false);
    const [a, b] = await Promise.all([k.ready(), k.ready()]);
    expect(a).toBe(k.name);
    expect(b).toBe(k.name);
    expect(
      substrate.calls.filter((c) => c.startsWith("createTemplate")),
    ).toHaveLength(1);
    expect(k.readyNow()).toBe(true);
  });

  it("recreates a template whose golden snapshot failed, once", async () => {
    const substrate = new FakeSubstrate();
    const k = keeper(substrate);
    substrate.goldenErrors.set(k.name, "the runner exited");
    await expect(k.ready()).resolves.toBe(k.name);
    expect(
      substrate.calls.filter((c) => c.startsWith("deleteTemplate")),
    ).toHaveLength(1);
  });

  it("fails after the one recreation fails too, and a later call tries again", async () => {
    const substrate = new FakeSubstrate();
    const k = keeper(substrate);
    substrate.goldenErrors.set(k.name, "the runner exited");
    const deleteTemplate = substrate.deleteTemplate.bind(substrate);
    substrate.deleteTemplate = async (t) => {
      await deleteTemplate(t);
      substrate.goldenErrors.set(k.name, "still broken");
    };
    await expect(k.ready()).rejects.toThrow(
      /failed to publish its golden snapshot: still broken/,
    );
    expect(k.readyNow()).toBe(false);
  });

  it("gives up when the golden snapshot never publishes", async () => {
    const substrate = new FakeSubstrate();
    substrate.goldenPolls = 1_000;
    await expect(keeper(substrate).ready()).rejects.toThrow(
      /did not publish its golden snapshot within 180 s/,
    );
  });
});
