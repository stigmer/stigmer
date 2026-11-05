/**
 * Pins how the runner reaches Temporal (temporal-lane.ts): directly with the
 * STIGMER_TEMPORAL_* settings unless its Temporal address is the backend
 * endpoint's own host and port, and then through the Stigmer server with
 * its token as the API key and TLS from the endpoint's scheme; a server
 * lane with no token, or with direct settings beside it, stops the boot
 * with its sentence.
 */
import { describe, expect, it, vi } from "vitest";

import { newTemporalApiKeySink, resolveTemporalLane } from "../temporal-lane.js";

describe("resolveTemporalLane", () => {
  it("dials Temporal directly when the address is not the server's", () => {
    const directConnection = { apiKey: "temporal-key", tls: {} };
    expect(
      resolveTemporalLane({
        temporalAddress: "temporal.internal:7233",
        backendEndpoint: "http://stigmer.internal:7234",
        token: "tok",
        directConnection,
      }),
    ).toEqual({ kind: "direct", connection: directConnection });
  });

  it("goes through the server with its token, TLS from the endpoint's scheme", () => {
    expect(
      resolveTemporalLane({
        temporalAddress: "Stigmer.Internal:7234",
        backendEndpoint: "http://stigmer.internal:7234",
        token: " tok ",
        directConnection: {},
      }),
    ).toEqual({ kind: "through-server", connection: { apiKey: "tok", tls: false } });
    expect(
      resolveTemporalLane({
        temporalAddress: "api.stigmer.ai:443",
        backendEndpoint: "https://api.stigmer.ai",
        token: "tok",
        directConnection: {},
      }),
    ).toEqual({ kind: "through-server", connection: { apiKey: "tok", tls: true } });
    expect(
      resolveTemporalLane({
        temporalAddress: "stigmer:80",
        backendEndpoint: "http://stigmer",
        token: "tok",
        directConnection: {},
      }).kind,
    ).toBe("through-server");
  });

  it("refuses the server lane without a token, or with direct settings beside it", () => {
    const base = {
      temporalAddress: "stigmer.internal:7234",
      backendEndpoint: "http://stigmer.internal:7234",
    };
    expect(() => resolveTemporalLane({ ...base, token: null, directConnection: {} })).toThrow(
      /admits a runner by its token, and the runner has no STIGMER_TOKEN/,
    );
    expect(() => resolveTemporalLane({ ...base, token: "tok", directConnection: { apiKey: "k" } })).toThrow(
      /STIGMER_TEMPORAL_\* settings are set for a direct Temporal connection/,
    );
    expect(() => resolveTemporalLane({ ...base, token: "tok", directConnection: { tls: {} } })).toThrow(
      /STIGMER_TEMPORAL_\*/,
    );
  });

  it("dials directly when the backend endpoint is not an http(s) URL", () => {
    for (const backendEndpoint of ["not a url", "grpc://stigmer:7234"]) {
      expect(
        resolveTemporalLane({
          temporalAddress: "stigmer:7234",
          backendEndpoint,
          token: "tok",
          directConnection: {},
        }).kind,
      ).toBe("direct");
    }
  });
});

describe("bootTemporalLane", () => {
  it("turns worker heartbeats off behind the server only, and keeps an embedder's runtime", async () => {
    const install = vi.fn();
    vi.doMock("@temporalio/worker", () => ({ Runtime: { install } }));
    vi.resetModules();
    const { bootTemporalLane } = await import("../temporal-lane.js");
    const through = { temporalAddress: "s:7234", backendEndpoint: "http://s:7234", token: "t", directConnection: {} };
    await bootTemporalLane({ ...through, temporalAddress: "temporal:7233" });
    expect(install).not.toHaveBeenCalled();
    expect((await bootTemporalLane(through)).kind).toBe("through-server");
    expect(install).toHaveBeenCalledWith({ workerHeartbeatInterval: 0 });
    install.mockImplementation(() => {
      throw new Error("Runtime singleton has already been instantiated");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await bootTemporalLane(through);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("worker heartbeats stay on"));
    warn.mockRestore();
    vi.doUnmock("@temporalio/worker");
    vi.resetModules();
  });
});

describe("newTemporalApiKeySink", () => {
  const through = { kind: "through-server" as const, connection: {} };
  it("holds a token renewed before the connection exists, then hands each one over", async () => {
    const sink = newTemporalApiKeySink();
    const connection = { setApiKey: vi.fn(async () => {}) };
    sink.apply("first");
    sink.attach(through, connection);
    sink.apply("second");
    expect(connection.setApiKey.mock.calls).toEqual([["first"], ["second"]]);
  });

  it("attaches nothing on a direct lane, and warns when the connection refuses a key", async () => {
    const sink = newTemporalApiKeySink();
    const direct = { setApiKey: vi.fn(async () => {}) };
    sink.attach({ kind: "direct", connection: {} }, direct);
    sink.apply("ignored");
    expect(direct.setApiKey).not.toHaveBeenCalled();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const failing = newTemporalApiKeySink();
    failing.attach(through, { setApiKey: () => Promise.reject(new Error("closed")) });
    failing.apply("t");
    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith(expect.stringContaining("closed")));
    warn.mockRestore();
  });
});
