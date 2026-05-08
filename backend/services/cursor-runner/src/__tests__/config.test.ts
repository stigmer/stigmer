import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { homedir } from "node:os";
import { loadConfig } from "../config.js";

describe("loadConfig", () => {
  let envSnapshot: NodeJS.ProcessEnv;

  beforeEach(() => {
    envSnapshot = { ...process.env };
  });

  afterEach(() => {
    process.env = envSnapshot;
  });

  function clearCursorRunnerEnv() {
    delete process.env.MODE;
    delete process.env.STIGMER_TASK_QUEUE;
    delete process.env.TEMPORAL_AGENT_EXECUTION_RUNNER_TASK_QUEUE;
    delete process.env.TEMPORAL_SERVICE_ADDRESS;
    delete process.env.TEMPORAL_NAMESPACE;
    delete process.env.STIGMER_BACKEND_ENDPOINT;
    delete process.env.STIGMER_TOKEN;
    delete process.env.CURSOR_API_KEY;
    delete process.env.WORKSPACE_ROOT_DIR;
    delete process.env.STIGMER_PROXY_ENDPOINT;
    delete process.env.TEMPORAL_MAX_CONCURRENCY;
    delete process.env.STIGMER_IDLE_TIMEOUT_SECONDS;
  }

  describe("local mode (default)", () => {
    beforeEach(clearCursorRunnerEnv);

    it("defaults mode to local", () => {
      process.env.CURSOR_API_KEY = "key-123";
      const config = loadConfig();
      expect(config.mode).toBe("local");
    });

    it("uses default task queue", () => {
      process.env.CURSOR_API_KEY = "key-123";
      const config = loadConfig();
      expect(config.taskQueue).toBe("agent_execution_runner");
    });

    it("uses default temporal address in local mode", () => {
      process.env.CURSOR_API_KEY = "key-123";
      const config = loadConfig();
      expect(config.temporalAddress).toBe("localhost:7233");
    });

    it("uses default temporal namespace", () => {
      process.env.CURSOR_API_KEY = "key-123";
      const config = loadConfig();
      expect(config.temporalNamespace).toBe("default");
    });

    it("uses default backend endpoint with http scheme", () => {
      process.env.CURSOR_API_KEY = "key-123";
      const config = loadConfig();
      expect(config.stigmerBackendEndpoint).toBe("http://localhost:7234");
    });

    it("requires CURSOR_API_KEY in local mode", () => {
      expect(() => loadConfig()).toThrow("CURSOR_API_KEY");
    });

    it("makes STIGMER_TOKEN optional in local mode", () => {
      process.env.CURSOR_API_KEY = "key-123";
      const config = loadConfig();
      expect(config.stigmerToken).toBeNull();
    });

    it("reads STIGMER_TOKEN when provided in local mode", () => {
      process.env.CURSOR_API_KEY = "key-123";
      process.env.STIGMER_TOKEN = "tok-local";
      const config = loadConfig();
      expect(config.stigmerToken).toBe("tok-local");
    });

    it("falls back to isolated workspace instead of process.cwd()", () => {
      process.env.CURSOR_API_KEY = "key-123";
      const config = loadConfig();
      const expected = join(homedir(), ".stigmer", "workspaces", "cursor-runner");
      expect(config.workspaceRootDir).toBe(expected);
      expect(config.workspaceRootDir).not.toBe(process.cwd());
    });

    it("defaults max concurrent activities to 5", () => {
      process.env.CURSOR_API_KEY = "key-123";
      const config = loadConfig();
      expect(config.maxConcurrentActivities).toBe(5);
    });

    it("defaults idle timeout to null", () => {
      process.env.CURSOR_API_KEY = "key-123";
      const config = loadConfig();
      expect(config.idleTimeoutSeconds).toBeNull();
    });
  });

  describe("cloud mode", () => {
    beforeEach(() => {
      clearCursorRunnerEnv();
      process.env.MODE = "cloud";
      process.env.TEMPORAL_SERVICE_ADDRESS = "temporal.cloud:7233";
      process.env.STIGMER_BACKEND_ENDPOINT = "https://api.stigmer.ai";
      process.env.STIGMER_TOKEN = "tok-cloud";
      process.env.CURSOR_API_KEY = "key-cloud";
    });

    it("sets mode to cloud", () => {
      const config = loadConfig();
      expect(config.mode).toBe("cloud");
    });

    it("requires TEMPORAL_SERVICE_ADDRESS", () => {
      delete process.env.TEMPORAL_SERVICE_ADDRESS;
      expect(() => loadConfig()).toThrow("TEMPORAL_SERVICE_ADDRESS");
    });

    it("requires STIGMER_BACKEND_ENDPOINT", () => {
      delete process.env.STIGMER_BACKEND_ENDPOINT;
      expect(() => loadConfig()).toThrow("STIGMER_BACKEND_ENDPOINT");
    });

    it("requires STIGMER_TOKEN", () => {
      delete process.env.STIGMER_TOKEN;
      expect(() => loadConfig()).toThrow("STIGMER_TOKEN");
    });

    it("requires CURSOR_API_KEY", () => {
      delete process.env.CURSOR_API_KEY;
      expect(() => loadConfig()).toThrow("CURSOR_API_KEY");
    });
  });

  describe("proxy mode", () => {
    beforeEach(() => {
      clearCursorRunnerEnv();
      process.env.STIGMER_PROXY_ENDPOINT = "https://proxy.stigmer.ai";
      process.env.STIGMER_TOKEN = "tok-proxy";
    });

    it("activates when STIGMER_PROXY_ENDPOINT is set", () => {
      const config = loadConfig();
      expect(config.proxyEndpoint).toBe("https://proxy.stigmer.ai");
    });

    it("defaults CURSOR_API_KEY to proxy-managed", () => {
      const config = loadConfig();
      expect(config.cursorApiKey).toBe("proxy-managed");
    });

    it("uses explicit CURSOR_API_KEY if provided alongside proxy", () => {
      process.env.CURSOR_API_KEY = "explicit-key";
      const config = loadConfig();
      expect(config.cursorApiKey).toBe("explicit-key");
    });

    it("requires STIGMER_TOKEN in proxy mode", () => {
      delete process.env.STIGMER_TOKEN;
      expect(() => loadConfig()).toThrow("STIGMER_TOKEN");
    });

    it("works in local mode with proxy", () => {
      const config = loadConfig();
      expect(config.mode).toBe("local");
      expect(config.proxyEndpoint).toBe("https://proxy.stigmer.ai");
    });
  });

  describe("endpoint normalization", () => {
    beforeEach(() => {
      clearCursorRunnerEnv();
      process.env.CURSOR_API_KEY = "key-123";
    });

    it("adds http:// scheme when missing", () => {
      process.env.STIGMER_BACKEND_ENDPOINT = "localhost:7234";
      const config = loadConfig();
      expect(config.stigmerBackendEndpoint).toBe("http://localhost:7234");
    });

    it("adds https:// scheme for port 443", () => {
      process.env.STIGMER_BACKEND_ENDPOINT = "api.stigmer.ai:443";
      const config = loadConfig();
      expect(config.stigmerBackendEndpoint).toBe("https://api.stigmer.ai:443");
    });

    it("preserves existing http:// scheme", () => {
      process.env.STIGMER_BACKEND_ENDPOINT = "http://my-host:8080";
      const config = loadConfig();
      expect(config.stigmerBackendEndpoint).toBe("http://my-host:8080");
    });

    it("preserves existing https:// scheme", () => {
      process.env.STIGMER_BACKEND_ENDPOINT = "https://api.stigmer.ai";
      const config = loadConfig();
      expect(config.stigmerBackendEndpoint).toBe("https://api.stigmer.ai");
    });
  });

  describe("custom env overrides", () => {
    beforeEach(() => {
      clearCursorRunnerEnv();
      process.env.CURSOR_API_KEY = "key-123";
    });

    it("reads STIGMER_TASK_QUEUE", () => {
      process.env.STIGMER_TASK_QUEUE = "custom-queue";
      const config = loadConfig();
      expect(config.taskQueue).toBe("custom-queue");
    });

    it("falls back to TEMPORAL_AGENT_EXECUTION_RUNNER_TASK_QUEUE", () => {
      process.env.TEMPORAL_AGENT_EXECUTION_RUNNER_TASK_QUEUE = "fallback-queue";
      const config = loadConfig();
      expect(config.taskQueue).toBe("fallback-queue");
    });

    it("reads WORKSPACE_ROOT_DIR", () => {
      process.env.WORKSPACE_ROOT_DIR = "/custom/workspace";
      const config = loadConfig();
      expect(config.workspaceRootDir).toBe("/custom/workspace");
    });

    it("reads TEMPORAL_MAX_CONCURRENCY", () => {
      process.env.TEMPORAL_MAX_CONCURRENCY = "10";
      const config = loadConfig();
      expect(config.maxConcurrentActivities).toBe(10);
    });

    it("reads STIGMER_IDLE_TIMEOUT_SECONDS", () => {
      process.env.STIGMER_IDLE_TIMEOUT_SECONDS = "300";
      const config = loadConfig();
      expect(config.idleTimeoutSeconds).toBe(300);
    });
  });
});
