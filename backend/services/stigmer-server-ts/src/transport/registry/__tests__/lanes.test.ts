/**
 * Registry-lane tests, mirroring the CW-10 conformance suite's assertions
 * (test/conformance/src/suites/registry-proxy.conformance.test.ts — the
 * self-declared gate for these lanes) against the FULLY composed server,
 * demux and lane router included. When #4 lands the `local-ts` target, the
 * real suite runs these same assertions over the wire; until then this
 * file keeps the contract enforced in this package's own gate.
 *
 * Also pinned here: the bundled data files are byte-identical to the Go
 * server's go:embed sources — the "same artifact" promise (D2 §1). If Go's
 * registry JSON changes without this copy, this test fails and names the
 * fix.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
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

beforeAll(async () => {
  // Refresh pinned off, as the conformance harness pins it — the served
  // model registry IS the embedded snapshot, deterministic offline.
  const config = loadConfig({ STIGMER_MODEL_REGISTRY_REFRESH: "off" });
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

describe("bundled artifacts are the Go server's embeds, byte for byte", () => {
  const goDataDir = join(
    import.meta.dirname,
    "../../../../../stigmer-server/pkg/domain/workflow/registry/data",
  );
  const tsDataDir = join(import.meta.dirname, "../data");

  it.each(["task-kind-registry.json", "model-registry.json"])(
    "%s matches the Go embed source",
    (file) => {
      const goBytes = readFileSync(join(goDataDir, file));
      const tsBytes = readFileSync(join(tsDataDir, file));
      expect(
        tsBytes.equals(goBytes),
        `${file} drifted from the Go embed — re-copy it from ${goDataDir}`,
      ).toBe(true);
    },
  );
});
