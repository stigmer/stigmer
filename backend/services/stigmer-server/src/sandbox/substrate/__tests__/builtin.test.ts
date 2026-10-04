/**
 * Pins the substrate driver as the server composes it (builtin.ts): the
 * built-in factory reads its own settings, refuses an unusable
 * configuration, and exposes the idle sweep as the provisioner's
 * background work, which starts and stops; newSubstrateSandboxDriver gives
 * a composition the provisioner and the lifecycle without starting it,
 * hands the driver the router's own transport (a push reaches a router
 * under the configured CA, which the global fetch does not trust), warns
 * once when the router is reached over http:// and once when an https://
 * public MCP endpoint has no HTTPS egress, and refuses a router CA it
 * cannot read.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import * as https from "node:https";
import type { AddressInfo } from "node:net";
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
import { newSubstrateSandboxDriverOverGateway } from "../driver.js";
import { mintCa, mintServerCertificate } from "../__test-utils__/test-ca.js";

// The real driver, watched: what newSubstrateSandboxDriver hands it.
vi.mock("../driver.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../driver.js")>();
  return {
    ...actual,
    newSubstrateSandboxDriverOverGateway: vi.fn(
      actual.newSubstrateSandboxDriverOverGateway,
    ),
  };
});

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
  serverRelease: "",
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

  it("warns once that an http:// router carries the push's secrets in cleartext, and is silent for an https:// one", () => {
    const warnings: string[] = [];
    const logger = createLogger({
      level: "warn",
      pretty: false,
      write: () => {},
      sink: (entry) => warnings.push(entry.message),
    });
    newSubstrateSandboxDriver({
      config,
      settings: newSubstrateSettingsFromEnv(env),
      logger,
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/http:\/\/.*cleartext/);
    expect(warnings[0]).toContain("STIGMER_SANDBOX_SUBSTRATE_ROUTER_CA_FILE");
    expect(warnings[0]).toContain(
      "STIGMER_SANDBOX_SUBSTRATE_ROUTER_SERVER_NAME",
    );

    warnings.length = 0;
    newSubstrateSandboxDriver({
      config,
      settings: newSubstrateSettingsFromEnv({
        ...env,
        STIGMER_SANDBOX_SUBSTRATE_ROUTER_URL: "https://router.example",
      }),
      logger,
    });
    expect(warnings).toEqual([]);
  });

  it("hands the driver the router's transport, which reaches a router under the configured CA", async () => {
    const ca = await mintCa("builtin router ca");
    const certificate = await mintServerCertificate(ca, {
      dns: ["atenet-router.ate-system.svc"],
    });
    const router = https.createServer(
      { cert: certificate.cert, key: certificate.key },
      (_req, res) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ started: true }));
      },
    );
    await new Promise<void>((resolve) =>
      router.listen(0, "127.0.0.1", () => resolve()),
    );
    try {
      const { port } = router.address() as AddressInfo;
      const routerUrl = `https://127.0.0.1:${port}`;
      const caFile = path.join(dir, "router-ca.pem");
      writeFileSync(caFile, ca.pem);
      newSubstrateSandboxDriver({
        config,
        settings: newSubstrateSettingsFromEnv({
          ...env,
          STIGMER_SANDBOX_SUBSTRATE_ROUTER_URL: routerUrl,
          STIGMER_SANDBOX_SUBSTRATE_ROUTER_CA_FILE: caFile,
          STIGMER_SANDBOX_SUBSTRATE_ROUTER_SERVER_NAME:
            "atenet-router.ate-system.svc",
        }),
        logger: silentLogger,
      });
      const handed = vi.mocked(newSubstrateSandboxDriverOverGateway).mock
        .lastCall?.[0].fetch;
      expect(handed).toBeDefined();
      const reply = await handed!(`${routerUrl}/attach`, { method: "POST" });
      expect(await reply.json()).toEqual({ started: true });
      // The global fetch does not trust that CA, so the push must not be it.
      await expect(fetch(`${routerUrl}/attach`)).rejects.toThrow();
    } finally {
      router.closeAllConnections();
      await new Promise<void>((resolve) => router.close(() => resolve()));
    }
  });

  it("warns once that an https:// public MCP endpoint is unreachable with HTTPS egress off", () => {
    const warnings: string[] = [];
    const logger = createLogger({
      level: "warn",
      pretty: false,
      write: () => {},
      sink: (entry) => warnings.push(entry.message),
    });
    const routerOverTls = {
      ...env,
      STIGMER_SANDBOX_SUBSTRATE_ROUTER_URL: "https://router.example",
    };
    const mcpOverTls = {
      ...config,
      mcpPublicEndpoint: "https://api.example",
    };
    newSubstrateSandboxDriver({
      config: mcpOverTls,
      settings: newSubstrateSettingsFromEnv({
        ...routerOverTls,
        STIGMER_SANDBOX_SUBSTRATE_EGRESS_HTTPS: "none",
      }),
      logger,
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(
      /STIGMER_SANDBOX_MCP_PUBLIC_ENDPOINT is https:\/\/ while STIGMER_SANDBOX_SUBSTRATE_EGRESS_HTTPS is none/,
    );

    warnings.length = 0;
    newSubstrateSandboxDriver({
      config: mcpOverTls,
      settings: newSubstrateSettingsFromEnv(routerOverTls),
      logger,
    });
    expect(warnings).toEqual([]);
  });

  it("refuses a router CA file it cannot read before it dials anything", () => {
    expect(() =>
      newSubstrateSandboxDriver({
        config,
        settings: newSubstrateSettingsFromEnv({
          ...env,
          STIGMER_SANDBOX_SUBSTRATE_ROUTER_URL: "https://router.example",
          STIGMER_SANDBOX_SUBSTRATE_ROUTER_CA_FILE: path.join(dir, "absent"),
        }),
        logger: silentLogger,
      }),
    ).toThrow(/STIGMER_SANDBOX_SUBSTRATE_ROUTER_CA_FILE/);
  });
});
