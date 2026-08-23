// Registry proxy conformance — the OSS server's plain-HTTP registry lanes
// (Class A; the suite's first non-gRPC tests).
// Domain: conformance suites.
//
// The unified port serves two unauthenticated, cacheable JSON proxies that
// route AROUND the gRPC stack: /v1/proxy/task-kind-registry (the workflow
// task palette) and /v1/proxy/model-registry (canonical model ids for
// tokenless local runners and the web console). They are what lets the OSS
// console work without an authenticated fetch from the hosted API, and the
// future TS server must serve them byte-compatibly — this suite is the gate
// the transport scaffold's proxy lanes are built against.
//
// The asserted contract, sourced from the Go server's routing block and
// registryCORS wrapper (oss#571):
//   - GET answers 200, Content-Type application/json, Cache-Control
//     public/max-age, and a parseable document of the expected shape.
//   - Every response carries Access-Control-Allow-Origin: * (the proxies
//     bypass the gRPC-Web wrapper's CORS, so they own their own headers —
//     without them the console's task palette and model pickers never load).
//   - OPTIONS preflight answers 204 with the GET/OPTIONS allow-list — even
//     for unregistered endpoints the browser probes.
//   - Non-GET methods answer 405.
//   - Unknown paths fall through the proxy lanes to the router's 404.
//   - EMBEDDED FALLBACK: the model registry serves its bundled build-time
//     snapshot without any network — the harness pins the background
//     upstream refresh off (STIGMER_MODEL_REGISTRY_REFRESH=off, see
//     server-process.ts), so the served document IS the embedded one and the
//     assertion is deterministic offline and online alike.
//
// Gated on the target exposing an httpBaseUrl (the local OSS targets): the
// cloud edition serves registries through its own authenticated routes — a
// different contract — so this file reports SKIPPED there rather than a
// false green (the DD-012 posture).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTarget, type TargetProfile } from "../targets";

// Collection-time gate: whether the SELECTED target class exposes the HTTP
// lane. The URL itself is only known after setup() in beforeAll.
const hasHttpLane = createTarget().httpBaseUrl !== undefined;

let target: TargetProfile;
let baseUrl: string;

describe.skipIf(!hasHttpLane)("Registry proxy conformance — HTTP lanes", () => {
  beforeAll(async () => {
    target = createTarget();
    await target.setup();
    baseUrl = target.httpBaseUrl!();
  });

  afterAll(async () => {
    await target?.teardown();
  });

  const routes = [
    { path: "/v1/proxy/task-kind-registry", topLevelKey: "descriptors" },
    { path: "/v1/proxy/model-registry", topLevelKey: "models" },
  ] as const;

  for (const { path, topLevelKey } of routes) {
    describe(`GET ${path}`, () => {
      it("answers cacheable JSON with allow-all CORS", async () => {
        const response = await fetch(baseUrl + path);

        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toBe("application/json");
        expect(
          response.headers.get("cache-control"),
          "the registries are static and cacheable",
        ).toContain("max-age");
        expect(
          response.headers.get("access-control-allow-origin"),
          "cross-origin console fetches need allow-all CORS (oss#571)",
        ).toBe("*");

        const document = (await response.json()) as Record<string, unknown>;
        expect(
          document[topLevelKey],
          `the served document carries its ${topLevelKey} catalog`,
        ).toBeDefined();
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
        expect(response.headers.get("access-control-allow-methods")).toBe("GET, OPTIONS");
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
    // The harness pins the upstream refresh off, so this is the bundled
    // build-time document — the offline-install contract: a server with no
    // outbound network still answers a complete, valid registry.
    const first = await fetch(baseUrl + "/v1/proxy/model-registry");
    const second = await fetch(baseUrl + "/v1/proxy/model-registry");

    const firstBody = await first.text();
    const secondBody = await second.text();
    expect(secondBody, "the embedded document is stable across reads").toBe(firstBody);

    const document = JSON.parse(firstBody) as { models?: unknown[] };
    expect(Array.isArray(document.models), "the bundled catalog is a models array").toBe(true);
    expect(
      (document.models as unknown[]).length,
      "the bundled catalog is non-empty — an empty fallback would blank every model picker",
    ).toBeGreaterThan(0);
  });

  it("unknown /v1/proxy paths fall through to the router's 404", async () => {
    const response = await fetch(baseUrl + "/v1/proxy/does-not-exist");
    expect(response.status).toBe(404);
  });
});
