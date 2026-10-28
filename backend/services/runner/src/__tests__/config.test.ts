import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { loadConfig } from "../config.js";

describe("loadConfig", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      HOME: originalEnv.HOME,
      PATH: originalEnv.PATH,
      WORKSPACE_ROOT_DIR: "/tmp/test-workspace",
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("loads defaults in local mode", () => {
    const config = loadConfig();

    expect(config.mode).toBe("local");
    expect(config.taskQueue).toBe("stigmer_runner");
    // temporalAddress is left empty by loadConfig now — it is resolved later by
    // the factory (resolveRunnerBootstrap), which falls back to localhost
    // for a tokenless local runner. loadConfig no longer hardcodes the default.
    expect(config.temporalAddress).toBe("");
    expect(config.temporalNamespace).toBe("default");
    expect(config.stigmerBackendEndpoint).toBe("http://localhost:7234");
    expect(config.stigmerTokenRef.current).toBeNull();
    expect(config.proxyEndpoint).toBeNull();
    expect(config.maxConcurrentActivities).toBe(5);
    expect(config.cursorStreamStallTimeoutMs).toBe(180000);
    expect(config.openOperationMaxMs).toBe(3600000);
    expect(config.livenessIntervalMs).toBe(30000);
    expect(config.shellTimeoutMaxSeconds).toBe(3300);
    expect(config.shellBackgroundEnabled).toBe(true);
    expect(config.workspaceLockTimeoutMs).toBe(900000);
  });

  it("respects CURSOR_STREAM_STALL_TIMEOUT_MS", () => {
    process.env.CURSOR_STREAM_STALL_TIMEOUT_MS = "90000";
    const config = loadConfig();
    expect(config.cursorStreamStallTimeoutMs).toBe(90000);
  });

  it("respects STIGMER_OPEN_OPERATION_MAX_MS", () => {
    process.env.STIGMER_OPEN_OPERATION_MAX_MS = "600000";
    const config = loadConfig();
    expect(config.openOperationMaxMs).toBe(600000);
  });

  it("respects STIGMER_LIVENESS_INTERVAL_MS", () => {
    process.env.STIGMER_LIVENESS_INTERVAL_MS = "5000";
    const config = loadConfig();
    expect(config.livenessIntervalMs).toBe(5000);
  });

  it("falls back to the default liveness interval, warning, for a value that is not a number or outside its bounds", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      for (const raw of ["soon", "1500.5", "999", "60000", "-1"]) {
        process.env.STIGMER_LIVENESS_INTERVAL_MS = raw;
        expect(loadConfig().livenessIntervalMs, raw).toBe(30000);
      }
      expect(warn.mock.calls.filter(([line]) => String(line).startsWith("STIGMER_LIVENESS_INTERVAL_MS="))).toHaveLength(5);
      process.env.STIGMER_LIVENESS_INTERVAL_MS = "1000";
      expect(loadConfig().livenessIntervalMs).toBe(1000);
      process.env.STIGMER_LIVENESS_INTERVAL_MS = "59999";
      expect(loadConfig().livenessIntervalMs).toBe(59999);
    } finally {
      warn.mockRestore();
    }
  });

  it("drains for 25 s by default and respects STIGMER_DRAIN_GRACE_MS", () => {
    expect(loadConfig().drainGraceMs).toBe(25_000);
    process.env.STIGMER_DRAIN_GRACE_MS = "540000";
    expect(loadConfig().drainGraceMs).toBe(540_000);
  });

  it("respects STIGMER_SHELL_TIMEOUT_MAX_SECONDS", () => {
    process.env.STIGMER_SHELL_TIMEOUT_MAX_SECONDS = "900";
    const config = loadConfig();
    expect(config.shellTimeoutMaxSeconds).toBe(900);
  });

  it("turns background shell commands off for STIGMER_SHELL_BACKGROUND_ENABLED=false, and on for true or unset", () => {
    process.env.STIGMER_SHELL_BACKGROUND_ENABLED = "false";
    expect(loadConfig().shellBackgroundEnabled).toBe(false);
    process.env.STIGMER_SHELL_BACKGROUND_ENABLED = "true";
    expect(loadConfig().shellBackgroundEnabled).toBe(true);
    process.env.STIGMER_SHELL_BACKGROUND_ENABLED = "";
    expect(loadConfig().shellBackgroundEnabled).toBe(true);
  });

  it("keeps background shell commands on, warning, for any other STIGMER_SHELL_BACKGROUND_ENABLED", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      for (const raw of ["0", "off", "FALSE", "no"]) {
        process.env.STIGMER_SHELL_BACKGROUND_ENABLED = raw;
        expect(loadConfig().shellBackgroundEnabled, raw).toBe(true);
      }
      expect(warn.mock.calls.filter(([line]) => String(line).startsWith("STIGMER_SHELL_BACKGROUND_ENABLED="))).toHaveLength(4);
    } finally {
      warn.mockRestore();
    }
  });

  it("respects WORKSPACE_LOCK_TIMEOUT_MS", () => {
    process.env.WORKSPACE_LOCK_TIMEOUT_MS = "60000";
    const config = loadConfig();
    expect(config.workspaceLockTimeoutMs).toBe(60000);
  });

  it("respects STIGMER_TASK_QUEUE", () => {
    process.env.STIGMER_TASK_QUEUE = "runner:abc123";
    const config = loadConfig();

    expect(config.taskQueue).toBe("runner:abc123");
  });

  it("respects TEMPORAL_AGENT_EXECUTION_RUNNER_TASK_QUEUE as fallback", () => {
    process.env.TEMPORAL_AGENT_EXECUTION_RUNNER_TASK_QUEUE = "custom-queue";
    const config = loadConfig();

    expect(config.taskQueue).toBe("custom-queue");
  });

  it("no longer requires TEMPORAL_SERVICE_ADDRESS up front in cloud mode", () => {
    // Token-only embedding: the address is discovered from the control plane at
    // boot, so loadConfig must NOT fail when it is absent. It is left empty for
    // the factory to resolve (or throw with an actionable error if discovery
    // fails). The token + backend endpoint remain required in cloud mode.
    process.env.MODE = "cloud";
    process.env.STIGMER_TOKEN = "token";
    process.env.STIGMER_BACKEND_ENDPOINT = "https://api.example.com";

    const config = loadConfig();
    expect(config.temporalAddress).toBe("");
    expect(config.stigmerTokenRef.current).toBe("token");
  });

  it("requires STIGMER_TOKEN in cloud mode", () => {
    process.env.MODE = "cloud";
    process.env.TEMPORAL_SERVICE_ADDRESS = "temporal:7233";
    process.env.STIGMER_BACKEND_ENDPOINT = "https://api.example.com";

    expect(() => loadConfig()).toThrow("STIGMER_TOKEN");
  });

  it("activates proxy mode when STIGMER_PROXY_ENDPOINT is set", () => {
    process.env.STIGMER_PROXY_ENDPOINT = "https://proxy.example.com";
    process.env.STIGMER_TOKEN = "token";
    const config = loadConfig();

    expect(config.proxyEndpoint).toBe("https://proxy.example.com");
    expect(config.stigmerTokenRef.current).toBe("token");
  });

  it("normalizes bare host:port to http://", () => {
    process.env.STIGMER_BACKEND_ENDPOINT = "backend:7234";
    const config = loadConfig();

    expect(config.stigmerBackendEndpoint).toBe("http://backend:7234");
  });

  it("normalizes :443 endpoints to https://", () => {
    process.env.STIGMER_BACKEND_ENDPOINT = "api.stigmer.ai:443";
    const config = loadConfig();

    expect(config.stigmerBackendEndpoint).toBe("https://api.stigmer.ai:443");
  });

  it("preserves existing http:// scheme", () => {
    process.env.STIGMER_BACKEND_ENDPOINT = "http://localhost:7234";
    const config = loadConfig();

    expect(config.stigmerBackendEndpoint).toBe("http://localhost:7234");
  });

  it("parses maxConcurrentActivities from env", () => {
    process.env.TEMPORAL_MAX_CONCURRENCY = "10";
    const config = loadConfig();

    expect(config.maxConcurrentActivities).toBe(10);
  });
});
