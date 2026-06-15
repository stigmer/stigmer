import { describe, it, expect, beforeEach, afterEach } from "vitest";
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
    process.env.CURSOR_API_KEY = "test-key";
    const config = loadConfig();

    expect(config.mode).toBe("local");
    expect(config.taskQueue).toBe("stigmer_runner");
    // temporalAddress is left empty by loadConfig now — it is resolved later by
    // the factory (resolveRunnerBootstrap), which falls back to localhost
    // for a tokenless local runner. loadConfig no longer hardcodes the default.
    expect(config.temporalAddress).toBe("");
    expect(config.temporalNamespace).toBe("default");
    expect(config.stigmerBackendEndpoint).toBe("http://localhost:7234");
    expect(config.stigmerToken).toBeNull();
    expect(config.cursorApiKey).toBe("test-key");
    expect(config.proxyEndpoint).toBeNull();
    expect(config.maxConcurrentActivities).toBe(5);
    expect(config.cursorStreamStallTimeoutMs).toBe(180000);
  });

  it("respects CURSOR_STREAM_STALL_TIMEOUT_MS", () => {
    process.env.CURSOR_API_KEY = "test-key";
    process.env.CURSOR_STREAM_STALL_TIMEOUT_MS = "90000";
    const config = loadConfig();
    expect(config.cursorStreamStallTimeoutMs).toBe(90000);
  });

  it("respects STIGMER_TASK_QUEUE", () => {
    process.env.STIGMER_TASK_QUEUE = "runner:abc123";
    process.env.CURSOR_API_KEY = "test-key";
    const config = loadConfig();

    expect(config.taskQueue).toBe("runner:abc123");
  });

  it("respects TEMPORAL_AGENT_EXECUTION_RUNNER_TASK_QUEUE as fallback", () => {
    process.env.TEMPORAL_AGENT_EXECUTION_RUNNER_TASK_QUEUE = "custom-queue";
    process.env.CURSOR_API_KEY = "test-key";
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
    expect(config.stigmerToken).toBe("token");
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
    expect(config.stigmerToken).toBe("token");
  });

  it("uses STIGMER_TOKEN as cursorApiKey in proxy mode for BiDi proxy auth", () => {
    process.env.STIGMER_PROXY_ENDPOINT = "https://api.stigmer.ai";
    process.env.STIGMER_TOKEN = "eyJhbGciOiJSUzI1NiJ9.test-jwt-token";
    const config = loadConfig();

    expect(config.cursorApiKey).toBe("eyJhbGciOiJSUzI1NiJ9.test-jwt-token");
  });

  it("prefers explicit CURSOR_API_KEY over STIGMER_TOKEN in proxy mode", () => {
    process.env.STIGMER_PROXY_ENDPOINT = "https://api.stigmer.ai";
    process.env.STIGMER_TOKEN = "stigmer-jwt";
    process.env.CURSOR_API_KEY = "explicit-cursor-key";
    const config = loadConfig();

    expect(config.cursorApiKey).toBe("explicit-cursor-key");
  });

  it("falls back to proxy-managed when no token in proxy mode", () => {
    process.env.MODE = "local";
    process.env.STIGMER_PROXY_ENDPOINT = "http://localhost:9090";
    process.env.STIGMER_TOKEN = "token";
    const config = loadConfig();

    // With STIGMER_TOKEN present, cursorApiKey should be the token
    expect(config.cursorApiKey).toBe("token");
  });

  it("normalizes bare host:port to http://", () => {
    process.env.STIGMER_BACKEND_ENDPOINT = "backend:7234";
    process.env.CURSOR_API_KEY = "test-key";
    const config = loadConfig();

    expect(config.stigmerBackendEndpoint).toBe("http://backend:7234");
  });

  it("normalizes :443 endpoints to https://", () => {
    process.env.STIGMER_BACKEND_ENDPOINT = "api.stigmer.ai:443";
    process.env.CURSOR_API_KEY = "test-key";
    const config = loadConfig();

    expect(config.stigmerBackendEndpoint).toBe("https://api.stigmer.ai:443");
  });

  it("preserves existing http:// scheme", () => {
    process.env.STIGMER_BACKEND_ENDPOINT = "http://localhost:7234";
    process.env.CURSOR_API_KEY = "test-key";
    const config = loadConfig();

    expect(config.stigmerBackendEndpoint).toBe("http://localhost:7234");
  });

  it("parses maxConcurrentActivities from env", () => {
    process.env.TEMPORAL_MAX_CONCURRENCY = "10";
    process.env.CURSOR_API_KEY = "test-key";
    const config = loadConfig();

    expect(config.maxConcurrentActivities).toBe(10);
  });

  it("reads cloudModeEnabled flag", () => {
    process.env.STIGMER_CURSOR_CLOUD_MODE_ENABLED = "true";
    process.env.CURSOR_API_KEY = "test-key";
    const config = loadConfig();

    expect(config.cloudModeEnabled).toBe(true);
  });
});
