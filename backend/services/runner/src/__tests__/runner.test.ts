import { describe, it, expect } from "vitest";
import type { StigmerRunnerOptions, StigmerRunner } from "../runner.js";

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

  it("rejects missing temporalAddress", async () => {
    const createStigmerRunner = await importFactory();
    const options = { ...VALID_OPTIONS, temporalAddress: "" };

    await expect(createStigmerRunner(options)).rejects.toThrow(
      "temporalAddress is required",
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
    };

    expect(options.temporalNamespace).toBe("prod");
    expect(options.maxConcurrentActivities).toBe(10);
    expect(options.proxyEndpoint).toBe("https://proxy.stigmer.ai");
    expect(options.checkpointerType).toBe("http");
    expect(options.cloudModeEnabled).toBe(true);
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
