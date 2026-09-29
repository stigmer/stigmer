import { describe, it, expect, vi } from "vitest";
import { mapOptionsToConfig, releaseAfterDrain } from "../runner.js";
import type { StigmerRunnerOptions, StigmerRunner } from "../runner.js";
import type { TokenRef } from "../config.js";

/**
 * Unit tests for the createStigmerRunner factory.
 *
 * These test the options validation and type contracts without starting
 * a real Temporal worker (that requires integration test infrastructure).
 * The factory is imported lazily to avoid triggering Temporal native
 * module loading in the test environment.
 */

const VALID_OPTIONS: StigmerRunnerOptions = {
  taskQueue: "session:test-123",
  temporalAddress: "localhost:7233",
  stigmerEndpoint: "http://localhost:7234",
};

describe("StigmerRunnerOptions validation", () => {
  async function importFactory() {
    return (await import("../runner.js")).createStigmerRunner;
  }

  it("rejects missing taskQueue", async () => {
    const createStigmerRunner = await importFactory();
    const options = { ...VALID_OPTIONS, taskQueue: "" };

    await expect(createStigmerRunner(options)).rejects.toThrow(
      "taskQueue is required",
    );
  });

  it("rejects missing stigmerEndpoint", async () => {
    const createStigmerRunner = await importFactory();
    const options = { ...VALID_OPTIONS, stigmerEndpoint: "" };

    await expect(createStigmerRunner(options)).rejects.toThrow(
      "stigmerEndpoint is required",
    );
  });
});

describe("StigmerRunnerOptions type contract", () => {
  it("accepts minimal required options", () => {
    const options: StigmerRunnerOptions = {
      taskQueue: "session:abc",
      temporalAddress: "temporal:7233",
      stigmerEndpoint: "https://api.stigmer.ai",
    };

    expect(options.taskQueue).toBe("session:abc");
    expect(options.temporalAddress).toBe("temporal:7233");
    expect(options.stigmerEndpoint).toBe("https://api.stigmer.ai");
  });

  it("accepts all optional fields", () => {
    const options: StigmerRunnerOptions = {
      taskQueue: "session:abc",
      temporalAddress: "temporal:7233",
      stigmerEndpoint: "https://api.stigmer.ai",
      temporalNamespace: "prod",
      stigmerToken: "tok_123",
      cursorApiKey: "key_abc",
      workspaceRootDir: "/workspace",
      maxConcurrentActivities: 10,
      proxyEndpoint: "https://proxy.stigmer.ai",
      primaryModel: "claude-4",
      checkpointerType: "http",
      checkpointerProxyEndpoint: "https://cp.stigmer.ai",
      cloudModeEnabled: true,
      executionMode: "local",
    };

    expect(options.temporalNamespace).toBe("prod");
    expect(options.maxConcurrentActivities).toBe(10);
    expect(options.proxyEndpoint).toBe("https://proxy.stigmer.ai");
    expect(options.checkpointerType).toBe("http");
    expect(options.cloudModeEnabled).toBe(true);
    expect(options.executionMode).toBe("local");
  });

  it("optional fields are truly optional at the type level", () => {
    const options: StigmerRunnerOptions = {
      taskQueue: "q",
      temporalAddress: "t:7233",
      stigmerEndpoint: "http://s:7234",
    };

    expect(options.temporalNamespace).toBeUndefined();
    expect(options.stigmerToken).toBeUndefined();
    expect(options.cursorApiKey).toBeUndefined();
    expect(options.workspaceRootDir).toBeUndefined();
    expect(options.maxConcurrentActivities).toBeUndefined();
    expect(options.proxyEndpoint).toBeUndefined();
    expect(options.primaryModel).toBeUndefined();
    expect(options.checkpointerType).toBeUndefined();
    expect(options.checkpointerProxyEndpoint).toBeUndefined();
    expect(options.cloudModeEnabled).toBeUndefined();
    expect(options.executionMode).toBeUndefined();
  });
});

/**
 * The static factory maps its options into a runner {@link Config}. These tests
 * lock the invariant that execution location (`mode`) is decoupled from
 * credential transport (`proxyEndpoint`): an explicit `executionMode` always
 * wins, and only when it is unset does `mode` fall back to the proxy-derived
 * default for backward compatibility. This mirrors `mapManagerOptionsToConfig`.
 * The static root binds ONE ref as both the control-plane and the proxy
 * credential (it mints no separate proxy token), and the config carries no
 * credential by value (config.ts header).
 */
describe("mapOptionsToConfig — Temporal connection security", () => {
  const base: StigmerRunnerOptions = {
    taskQueue: "session:test-123",
    temporalAddress: "localhost:7233",
    stigmerEndpoint: "http://localhost:7234",
  };
  const refs = (): [TokenRef, TokenRef] => [{ current: null }, { current: null }];

  it("carries an embedder's explicit settings", () => {
    const temporalConnection = { tls: { serverNameOverride: "temporal.internal" }, apiKey: "k" };
    expect(mapOptionsToConfig({ ...base, temporalConnection }, ...refs()).temporalConnection).toEqual(
      temporalConnection,
    );
  });

  it("falls back to the environment's STIGMER_TEMPORAL_* settings, plaintext when none is set", () => {
    expect(mapOptionsToConfig(base, ...refs()).temporalConnection).toEqual({});
  });
});

describe("mapOptionsToConfig — execution mode", () => {
  const base: StigmerRunnerOptions = {
    taskQueue: "session:test-123",
    temporalAddress: "localhost:7233",
    stigmerEndpoint: "http://localhost:7234",
  };
  const refs = (): [TokenRef, TokenRef] => [{ current: null }, { current: null }];

  it("defaults mode to local with no proxy and no executionMode", () => {
    const config = mapOptionsToConfig(base, ...refs());
    expect(config.mode).toBe("local");
  });

  it("derives cloud from a proxy when executionMode is unset (backward compatible)", () => {
    const config = mapOptionsToConfig({
      ...base,
      proxyEndpoint: "https://proxy.example.com",
      stigmerToken: "tok",
    }, ...refs());
    expect(config.mode).toBe("cloud");
    // Proxy transport still engages independently of execution location.
    expect(config.proxyEndpoint).toBe("https://proxy.example.com");
    expect(config.cursorApiKey).toBe("proxy-managed");
    expect(config.checkpointerType).toBe("http");
  });

  it("honors explicit local executionMode even with a proxy (the desktop case)", () => {
    const config = mapOptionsToConfig({
      ...base,
      executionMode: "local",
      proxyEndpoint: "https://proxy.example.com",
      stigmerToken: "tok",
    }, ...refs());
    expect(config.mode).toBe("local");
    // Transport still routes through the proxy despite local execution.
    expect(config.proxyEndpoint).toBe("https://proxy.example.com");
    expect(config.cursorApiKey).toBe("proxy-managed");
  });

  it("honors explicit cloud executionMode without a proxy", () => {
    const config = mapOptionsToConfig({ ...base, executionMode: "cloud" }, ...refs());
    expect(config.mode).toBe("cloud");
  });

  it("binds the one ref as both the control-plane and the proxy credential, and carries no credential by value", () => {
    const tokenRef: TokenRef = { current: "boot-credential" };
    const runnerTokenRef: TokenRef = { current: null };
    const config = mapOptionsToConfig(
      { ...base, proxyEndpoint: "https://proxy.example.com", stigmerToken: "boot-credential" },
      tokenRef,
      runnerTokenRef,
    );
    expect(config.stigmerTokenRef).toBe(tokenRef);
    expect(config.proxyTokenRef).toBe(tokenRef);
    expect(config.stigmerRunnerTokenRef).toBe(runnerTokenRef);
    expect(config.cursorApiKey).toBe("proxy-managed");

    tokenRef.current = "renewed-credential";
    expect(config.stigmerTokenRef.current).toBe("renewed-credential");
    expect(config.proxyTokenRef?.current).toBe("renewed-credential");
    expect(JSON.stringify(config)).not.toContain("boot-credential");
  });
});

describe("StigmerRunner type contract", () => {
  it("defines start and shutdown methods", () => {
    const runner: StigmerRunner = {
      start: async () => {},
      shutdown: () => {},
    };

    expect(typeof runner.start).toBe("function");
    expect(typeof runner.shutdown).toBe("function");
  });

  it("start returns a Promise", () => {
    const runner: StigmerRunner = {
      start: async () => {},
      shutdown: () => {},
    };

    const result = runner.start();
    expect(result).toBeInstanceOf(Promise);
  });
});

describe("public API exports", () => {
  it("exports createStigmerRunner from index", async () => {
    const mod = await import("../index.js");
    expect(typeof mod.createStigmerRunner).toBe("function");
  });
});

describe("releaseAfterDrain", () => {
  function resources(opts: { harnessFails?: boolean; closeFails?: boolean } = {}) {
    const order: string[] = [];
    return {
      order,
      value: {
        shutdownHarnesses: vi.fn(async () => {
          order.push("harnesses");
          if (opts.harnessFails) {
            throw new Error("harness boom");
          }
        }),
        connection: {
          close: vi.fn(async () => {
            order.push("connection");
            if (opts.closeFails) {
              throw new Error("close boom");
            }
          }),
        },
      },
    };
  }

  it("releases the harnesses, then closes the Temporal connection", async () => {
    const r = resources();
    const logError = vi.fn<(line: string) => void>();

    await releaseAfterDrain(r.value, logError);

    expect(r.order).toEqual(["harnesses", "connection"]);
    expect(logError).not.toHaveBeenCalled();
  });

  it("still closes the connection when a harness teardown fails, and logs it", async () => {
    const r = resources({ harnessFails: true });
    const logError = vi.fn<(line: string) => void>();

    await releaseAfterDrain(r.value, logError);

    expect(r.order).toEqual(["harnesses", "connection"]);
    expect(logError).toHaveBeenCalledTimes(1);
    expect(logError.mock.calls[0]?.[0]).toContain("Harness shutdown failed after the worker drained");
    expect(logError.mock.calls[0]?.[0]).toContain("harness boom");
  });

  it("logs a failed close instead of throwing, so a clean stop stays clean", async () => {
    const r = resources({ closeFails: true });
    const logError = vi.fn<(line: string) => void>();

    await expect(releaseAfterDrain(r.value, logError)).resolves.toBeUndefined();

    expect(logError).toHaveBeenCalledTimes(1);
    expect(logError.mock.calls[0]?.[0]).toContain("Temporal connection close failed after the worker drained");
    expect(logError.mock.calls[0]?.[0]).toContain("close boom");
  });
});
