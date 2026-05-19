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
    expect(config.taskQueue).toBe("agent_execution_runner");
    expect(config.temporalAddress).toBe("localhost:7233");
    expect(config.temporalNamespace).toBe("default");
    expect(config.stigmerBackendEndpoint).toBe("http://localhost:7234");
    expect(config.stigmerToken).toBeNull();
    expect(config.cursorApiKey).toBe("test-key");
    expect(config.proxyEndpoint).toBeNull();
    expect(config.maxConcurrentActivities).toBe(5);
    expect(config.runnerId).toBeNull();
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

  it("requires TEMPORAL_SERVICE_ADDRESS in cloud mode", () => {
    process.env.MODE = "cloud";
    process.env.STIGMER_TOKEN = "token";
    process.env.STIGMER_BACKEND_ENDPOINT = "https://api.example.com";

    expect(() => loadConfig()).toThrow("TEMPORAL_SERVICE_ADDRESS");
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
    expect(config.cursorApiKey).toBe("proxy-managed");
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

  it("reads runnerId from STIGMER_RUNNER_ID", () => {
    process.env.STIGMER_RUNNER_ID = "runner-xyz";
    process.env.CURSOR_API_KEY = "test-key";
    const config = loadConfig();

    expect(config.runnerId).toBe("runner-xyz");
  });

  it("reads cloudModeEnabled flag", () => {
    process.env.STIGMER_CURSOR_CLOUD_MODE_ENABLED = "true";
    process.env.CURSOR_API_KEY = "test-key";
    const config = loadConfig();

    expect(config.cloudModeEnabled).toBe(true);
  });
});
