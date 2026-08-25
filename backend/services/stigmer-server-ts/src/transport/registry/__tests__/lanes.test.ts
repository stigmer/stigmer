/**
 * Registry-lane tests, mirroring the CW-10 conformance suite's assertions
 * (test/conformance/src/suites/registry-proxy.conformance.test.ts — the
 * self-declared gate for these lanes) against the FULLY composed server,
 * demux and lane router included. When #4 lands the `local-ts` target, the
 * real suite runs these same assertions over the wire; until then this
 * file keeps the contract enforced in this package's own gate.
 *
 * The byte-pin of the bundled data files against Go's embeds lives with
 * the data now — src/domain/workflow/registry/__tests__/bundled.test.ts
 * (the registry moved home to the domain, workflow-family DD-A).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadConfig } from "../../../boot/config.js";
import { composeServer, type ComposedServer } from "../../../boot/compose.js";
import { createLogger } from "../../../boot/logger.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

let server: ComposedServer;
let baseUrl: string;

let testDir: string;

beforeAll(async () => {
  // Refresh pinned off, as the conformance harness pins it — the served
  // model registry IS the embedded snapshot, deterministic offline.
  // Every filesystem-touching stage is pinned into a throwaway dir: this
  // test previously composed against the DEFAULT paths, which meant
  // opening the developer's real ~/.stigmer/stigmer.db — and with the
  // skill domain's boot-time staging wipe (#8) it would now also clear
  // ~/.stigmer/storage/skills-staging. Tests never touch the home dir.
  testDir = mkdtempSync(path.join(tmpdir(), "registry-lanes-test-"));
  const config = loadConfig({
    STIGMER_MODEL_REGISTRY_REFRESH: "off",
    // No engine behind composed tests: 127.0.0.1:1 is deterministically
    // closed, so boots fail the non-fatal connect fast and can never touch
    // a live local Temporal (the conformance CRUD harness does the same).
    TEMPORAL_HOST_PORT: "127.0.0.1:1",
    DB_PATH: path.join(testDir, "stigmer.db"),
    ARTIFACT_LOCAL_BASE_PATH: path.join(testDir, "artifacts"),
    STORAGE_PATH: path.join(testDir, "storage"),
  });
  server = composeServer({
    config,
    logger: silentLogger,
    portOverride: 0,
    host: "127.0.0.1",
  });
  const port = await server.start();
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await server.shutdown();
  rmSync(testDir, { recursive: true, force: true });
});

const routes = [
  { path: "/v1/proxy/task-kind-registry", topLevelKey: "descriptors" },
  { path: "/v1/proxy/model-registry", topLevelKey: "models" },
] as const;

describe("registry proxy lanes (CW-10 contract)", () => {
  for (const { path, topLevelKey } of routes) {
    describe(`GET ${path}`, () => {
      it("answers cacheable JSON with allow-all CORS", async () => {
        const response = await fetch(baseUrl + path);

        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toBe("application/json");
        expect(response.headers.get("cache-control")).toContain("max-age");
        expect(response.headers.get("access-control-allow-origin")).toBe("*");

        const document = (await response.json()) as Record<string, unknown>;
        expect(document[topLevelKey]).toBeDefined();
      });

      it("answers the OPTIONS preflight with 204 and the GET allow-list", async () => {
        const response = await fetch(baseUrl + path, {
          method: "OPTIONS",
          headers: {
            Origin: "http://localhost:3000",
            "Access-Control-Request-Method": "GET",
          },
        });

        expect(response.status).toBe(204);
        expect(response.headers.get("access-control-allow-origin")).toBe("*");
        expect(response.headers.get("access-control-allow-methods")).toBe(
          "GET, OPTIONS",
        );
        expect(response.headers.get("access-control-allow-headers")).toBe(
          "Authorization, Content-Type",
        );
      });

      it("refuses non-GET methods with 405", async () => {
        const response = await fetch(baseUrl + path, { method: "POST" });
        expect(response.status).toBe(405);
      });
    });
  }

  it("model registry serves the embedded snapshot deterministically (no network behind it)", async () => {
    const first = await fetch(baseUrl + "/v1/proxy/model-registry");
    const second = await fetch(baseUrl + "/v1/proxy/model-registry");

    const firstBody = await first.text();
    const secondBody = await second.text();
    expect(secondBody).toBe(firstBody);

    const document = JSON.parse(firstBody) as { models?: unknown[] };
    expect(Array.isArray(document.models)).toBe(true);
    expect((document.models as unknown[]).length).toBeGreaterThan(0);
  });

  it("unknown /v1/proxy paths fall through to the router's 404", async () => {
    const response = await fetch(baseUrl + "/v1/proxy/does-not-exist");
    expect(response.status).toBe(404);
  });
});
