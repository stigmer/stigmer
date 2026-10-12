/**
 * The telemetry lane's forward builds its export delegate on first use
 * (`agent-proxy/otlp-forward.ts`); a delegate that could not be built is
 * built again on the next export instead of failing every export after it,
 * and its error is never echoed, since a header parser quotes the value it
 * refuses and that value is the collector's login.
 * OpenTelemetry's HTTP delegate factory is made to fail once at its module
 * seam; the second export goes through a real delegate to a test collector.
 */

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";

const failures = vi.hoisted(() => ({ left: 1 }));

vi.mock("@opentelemetry/otlp-exporter-base/node-http", async (importOriginal) => {
  const real = await importOriginal<typeof import("@opentelemetry/otlp-exporter-base/node-http")>();
  return {
    ...real,
    createOtlpHttpExportDelegate: (...args: Parameters<typeof real.createOtlpHttpExportDelegate>) => {
      if (failures.left > 0) {
        failures.left -= 1;
        throw new Error("the delegate could not be built");
      }
      return real.createOtlpHttpExportDelegate(...args);
    },
  };
});

import { OtlpForward } from "../otlp-forward.js";
import { resolveTelemetrySettings } from "../../otel-export.js";

const servers: Server[] = [];

afterEach(async () => {
  delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  for (const server of servers.splice(0)) await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("the forward's delegate", () => {
  it("is built again after a build failed, and the next export reaches the collector", async () => {
    const received: string[] = [];
    const server = createServer((req, res) => {
      received.push(req.url ?? "");
      req.resume();
      req.on("end", () => res.writeHead(200).end());
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const settings = resolveTelemetrySettings({ OTEL_EXPORTER_OTLP_ENDPOINT: process.env.OTEL_EXPORTER_OTLP_ENDPOINT });
    const forward = new OtlpForward(() => settings);

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const refused = await forward.forward("traces", new Uint8Array([1])).catch((err: unknown) => err);
    // The builder's error can quote a header value it refuses, which is the
    // collector's login: never echoed to the host or the log.
    expect(refused).toMatchObject({ status: 502, message: "this runner's traces exporter could not be built" });
    expect(JSON.stringify(warn.mock.calls)).not.toContain("the delegate could not be built");
    warn.mockRestore();
    expect(await forward.forward("traces", new Uint8Array([1]))).toEqual({ ok: true });
    expect(received).toEqual(["/v1/traces"]);
    await forward.close();
  });
});
