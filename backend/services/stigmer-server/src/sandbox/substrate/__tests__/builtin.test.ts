/**
 * Pins the substrate driver as the server composes it (builtin.ts): the
 * built-in factory reads its own settings, refuses an unusable
 * configuration, and exposes the idle sweep as the provisioner's
 * background work, which starts and stops; newSubstrateSandboxDriver gives
 * a composition the provisioner and the lifecycle without starting it.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createLogger } from "../../../boot/logger.js";
import type { SandboxDriverConfig } from "../../provisioner.js";
import {
  newSubstrateSandboxDriver,
  newSubstrateSandboxProvisioner,
} from "../builtin.js";
import { newSubstrateSettingsFromEnv } from "../config.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

const config: SandboxDriverConfig = {
  backendEndpoint: "http://stigmer.example:7234",
  mcpPublicEndpoint: "",
  temporalAddress: "temporal.example:7233",
  temporalNamespace: "default",
  temporalConnectionEnv: {},
  runnerImage: `r@sha256:${"a".repeat(64)}`,
  runnerCommand: "",
  kubernetesNamespace: "",
  runnerEnv: {},
  runnerSecretEnv: {},
};

let dir: string;
let env: Record<string, string>;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "substrate-builtin-test-"));
  writeFileSync(path.join(dir, "token"), "t");
  env = {
    STIGMER_SANDBOX_SUBSTRATE_API_ENDPOINT: "https://127.0.0.1:1",
    STIGMER_SANDBOX_SUBSTRATE_API_TOKEN_FILE: path.join(dir, "token"),
    STIGMER_SANDBOX_SUBSTRATE_ROUTER_URL: "http://router.example",
    STIGMER_SANDBOX_SUBSTRATE_ATESPACE: "stigmer",
    STIGMER_SANDBOX_SUBSTRATE_STORAGE_LOCATION: "gs://b/p",
    STIGMER_SANDBOX_SUBSTRATE_WORKER_SELECTOR: "workload=stigmer",
  };
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

describe("the built-in factory", () => {
  it("reads its settings and offers its sweep as background work that starts and stops", async () => {
    const provisioner = newSubstrateSandboxProvisioner({
      config,
      logger: silentLogger,
    });
    expect(typeof provisioner.ensureSessionSandbox).toBe("function");
    const handle = provisioner.startBackground?.({
      sessions: {
        activity: async () => ({ busy: false, lastActiveAt: undefined }),
        async *sessionIds() {},
      },
      logger: silentLogger,
    });
    expect(handle).toBeDefined();
    await handle?.stop();
  });

  it("refuses a runner image not pinned by digest before it dials anything", () => {
    expect(() =>
      newSubstrateSandboxProvisioner({
        config: { ...config, runnerImage: "ghcr.io/stigmer/runner:latest" },
        logger: silentLogger,
      }),
    ).toThrow(/pinned by digest/);
  });
});

describe("newSubstrateSandboxDriver", () => {
  it("gives a composition the provisioner and the lifecycle, and starts nothing", () => {
    const driver = newSubstrateSandboxDriver({
      config,
      settings: newSubstrateSettingsFromEnv(env),
      logger: silentLogger,
    });
    expect(Object.keys(driver).sort()).toEqual([
      "lifecycle",
      "provisioner",
      "startIdleSweep",
    ]);
    expect(driver.provisioner.startBackground).toBeUndefined();
  });
});
