/**
 * Pins the composed extension surface end to end (sub-project
 * 20260826.09/O1, DD-006 §2a): a fake extension unit registering a
 * cloud-family service the OSS server never serves
 * (BillingQueryController) is visible through BOTH routers — the bound
 * port and the in-process transport — with the full interceptor chain
 * running on each lane (the SP-B parity doctrine extended to extension
 * services), and the registry-declared edition answers on getServerInfo.
 *
 * The empty-set arm — no extensions composed, wire behavior byte-identical
 * to before the parameter existed — is pinned where it belongs: the
 * platform domain suite (edition oss) and the four conformance rosters.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import { createClient } from "@connectrpc/connect";
import type { Transport } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { BillingQueryController } from "@stigmer/protos/ai/stigmer/billing/v1/query_pb";
import { BillingAccountSchema } from "@stigmer/protos/ai/stigmer/billing/v1/billing_account_pb";
import {
  PlatformQueryController,
  ServerEdition,
} from "@stigmer/protos/ai/stigmer/platform/v1/server_info_pb";

import type { ArtifactStorage } from "../../artifactstorage/artifact-storage.js";
import { loadConfig } from "../../boot/config.js";
import { composeServer } from "../../boot/compose.js";
import type { ComposedServer } from "../../boot/compose.js";
import { createLogger } from "../../boot/logger.js";
import type { ServerExtension } from "../registry.js";

const BILLING_PROCEDURE =
  "/ai.stigmer.billing.v1.BillingQueryController/getBillingAccount";

describe("extension composition (composed server)", () => {
  let server: ComposedServer;
  let dir: string;
  let portTransport: Transport;
  // Captured NDJSON log lines — the interceptor-chain proof reads them.
  const logLines: string[] = [];

  const fakeBillingExtension: ServerExtension = {
    name: "fake-billing",
    edition: ServerEdition.cloud,
    services: [
      (router): void => {
        // Partial implementation is deliberate: the fake pins service
        // VISIBILITY and chain traversal, not the billing contract
        // (that is C5's job, years of entries away).
        router.service(BillingQueryController, {
          getBillingAccount: (input) =>
            create(BillingAccountSchema, { orgId: input.orgId }),
        });
      },
    ],
  };

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "extension-composition-test-"));
    server = await composeServer({
      config: loadConfig({
        STIGMER_MODEL_REGISTRY_REFRESH: "off",
        DB_PATH: path.join(dir, "stigmer.db"),
        ARTIFACT_LOCAL_BASE_PATH: path.join(dir, "artifacts"),
      }),
      logger: createLogger({
        level: "info",
        pretty: false,
        write: (line) => logLines.push(line),
      }),
      extensions: [fakeBillingExtension],
      portOverride: 0,
      host: "127.0.0.1",
    });
    const port = await server.start();
    portTransport = createGrpcTransport({ baseUrl: `http://127.0.0.1:${port}` });
  });

  afterAll(async () => {
    await server.shutdown();
    rmSync(dir, { recursive: true, force: true });
  });

  it("serves the extension service on the bound port, through the interceptor chain", async () => {
    const before = logLines.length;
    const client = createClient(BillingQueryController, portTransport);
    const account = await client.getBillingAccount({ orgId: "org-serving" });
    expect(account.orgId).toBe("org-serving");

    // The logging interceptor (chain position 2) records every completed
    // RPC — its line for the billing procedure proves the extension
    // service traversed the SAME chain OSS services do.
    const completed = logLines
      .slice(before)
      .filter(
        (line) =>
          line.includes("rpc completed") && line.includes(BILLING_PROCEDURE),
      );
    expect(completed.length).toBe(1);
  });

  it("serves the extension service on the in-process transport, through the same chain", async () => {
    const before = logLines.length;
    const client = createClient(
      BillingQueryController,
      server.inProcessTransport,
    );
    const account = await client.getBillingAccount({ orgId: "org-inprocess" });
    expect(account.orgId).toBe("org-inprocess");

    const completed = logLines
      .slice(before)
      .filter(
        (line) =>
          line.includes("rpc completed") && line.includes(BILLING_PROCEDURE),
      );
    expect(completed.length).toBe(1);
  });

  it("answers the registry-declared edition on getServerInfo", async () => {
    const client = createClient(PlatformQueryController, portTransport);
    const info = await client.getServerInfo({});
    expect(info.edition).toBe(ServerEdition.cloud);
  });

  it("logs the composed unit names at boot", () => {
    const bootLine = logLines.find((line) =>
      line.includes("extension units composed"),
    );
    expect(bootLine).toBeDefined();
    expect(bootLine).toContain("fake-billing");
  });
});

/**
 * The O5 driver-substitution arm: every consumption site routes through
 * the composed drivers — the registry lane serves the substituted
 * catalog's document, the platform exchange mints through the substituted
 * credential provider, and the artifact factory selects the registered
 * blob driver by its configured name.
 */
describe("extension composition (O5 driver substitution)", () => {
  const FAKE_DOCUMENT = `{"models":[{"id":"fake/model","harness":"native"}]}`;
  let server: ComposedServer;
  let dir: string;
  let port: number;
  let blobDriverConstructed = 0;

  const driverExtension: ServerExtension = {
    name: "fake-drivers",
    drivers: {
      modelCatalogProvider: {
        document: () => FAKE_DOCUMENT,
        isValidModel: () => true,
        hasHarness: () => true,
        hasAnyModels: () => true,
        isValidModelOnAnyHarness: () => true,
        canonicalModelsAcrossHarnesses: () => ["fake/model"],
        canonicalModels: () => ["fake/model"],
        hasPricingVariant: () => true,
        hasPricingVariantForHarness: () => true,
        canonicalModelsWithVariant: () => ["fake/model"],
        canonicalModelsWithVariantForHarness: () => ["fake/model"],
        hasCapabilityForHarness: () => true,
        canonicalModelsWithCapabilityForHarness: () => ["fake/model"],
      },
      runnerCredentialProvider: {
        isEnabled: () => true,
        mint: (lane, binding) => ({
          token: `fake-${lane}-${binding}`,
          ttlSeconds: 42,
        }),
        verify: (lane, token) => `${lane}:${token}`,
      },
      artifactStorageDrivers: new Map([
        [
          "fake-blob",
          (): ArtifactStorage => {
            blobDriverConstructed += 1;
            const blobs = new Map<string, Uint8Array>();
            return {
              upload: (key, data) => {
                blobs.set(key, data);
                return Promise.resolve();
              },
              download: (key) =>
                Promise.resolve(blobs.get(key) ?? new Uint8Array()),
              size: (key) => Promise.resolve(blobs.get(key)?.length ?? 0),
              presignPut: () =>
                Promise.reject(new Error("not exercised here")),
              getSignedUrl: () => Promise.resolve("https://blob.invalid"),
              delete: () => Promise.resolve(),
              exists: (key) => Promise.resolve(blobs.has(key)),
              health: () => Promise.resolve(),
            };
          },
        ],
      ]),
    },
  };

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "driver-substitution-test-"));
    server = await composeServer({
      config: loadConfig({
        STIGMER_MODEL_REGISTRY_REFRESH: "off",
        DB_PATH: path.join(dir, "stigmer.db"),
        STORAGE_PATH: path.join(dir, "storage"),
        // The registered driver serves the GENERIC artifact store; the
        // skill store stays on its default local arm (Q2b: per-domain).
        ARTIFACT_STORAGE_TYPE: "fake-blob",
        ARTIFACT_LOCAL_BASE_PATH: path.join(dir, "artifacts"),
      }),
      logger: createLogger({ level: "error", pretty: false, write: () => {} }),
      extensions: [driverExtension],
      portOverride: 0,
      host: "127.0.0.1",
    });
    port = await server.start();
  });

  afterAll(async () => {
    await server.shutdown();
    rmSync(dir, { recursive: true, force: true });
  });

  it("the registry lane serves the substituted catalog's document verbatim", async () => {
    const response = await fetch(
      `http://127.0.0.1:${port}/v1/proxy/model-registry`,
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(FAKE_DOCUMENT);
  });

  it("the platform exchange mints through the substituted credential provider", async () => {
    const client = createClient(PlatformQueryController, server.inProcessTransport);
    const out = await client.getRunnerScopedToken({
      scope: { case: "agentExecutionId", value: "aex_substituted" },
    });
    expect(out.runnerScopedToken).toBe("fake-execution_scoped-aex_substituted");
    expect(out.expiresInSeconds).toBe(42);
  });

  it("the artifact factory constructed the registered blob driver exactly once", () => {
    expect(blobDriverConstructed).toBe(1);
  });
});
