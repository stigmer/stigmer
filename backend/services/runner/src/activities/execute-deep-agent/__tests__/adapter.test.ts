/**
 * The native adapter's lifecycle half (`adapter.ts`), outside any activity
 * context: what `boot` does and in what order, that the two no-op lifetimes
 * resolve, that a turn before boot is refused loudly, and that the config
 * slice is exactly the five fields the engine slice reads. The engine turn
 * itself is proven by the hermetic goldens (`__tests__/hermetic/`).
 *
 * The profiles module is doubled (it imports the SDK to register against
 * it), so this file proves the ORDER — registration before the engine
 * slice loads — without loading deepagents.
 */

import { describe, expect, it, vi } from "vitest";

import type { Config } from "../../../config.js";
import { createDeepAgentAdapter, resolveDeepAgentConfig } from "../adapter.js";
import { DEEP_AGENT_CAPABILITIES } from "../deep-agent-capabilities.js";

const { registerSpy } = vi.hoisted(() => ({ registerSpy: vi.fn() }));
vi.mock("../deepagents-profiles.js", () => ({ registerStigmerDeepagentsProfiles: registerSpy }));

const CONFIG: Config = {
  taskQueue: "adapter-test-queue",
  temporalAddress: "localhost:7233",
  temporalNamespace: "default",
  stigmerBackendEndpoint: "http://localhost:7234",
  mcpBridgeEndpoint: null,
  stigmerTokenRef: { current: "tok" },
  cursorApiKey: "",
  workspaceRootDir: "/tmp/adapter-test",
  mode: "local",
  proxyEndpoint: null,
  maxConcurrentActivities: 1,
  idleTimeoutSeconds: null,
  cloudModeEnabled: false,
  checkpointerType: "memory",
  checkpointerProxyEndpoint: null,
  artifactProxyEndpoint: null,
  primaryModel: "anthropic/claude-sonnet-4-5",
  cursorStreamStallTimeoutMs: 180_000,
  agentResolveTimeoutMs: 120_000,
  workspaceLockTimeoutMs: 900_000,
};

describe("createDeepAgentAdapter", () => {
  it("declares its identity and the native capability flags", () => {
    const adapter = createDeepAgentAdapter();
    expect(adapter.name).toBe("deep-agent");
    expect(adapter.capabilities).toBe(DEEP_AGENT_CAPABILITIES);
    expect(adapter.capabilities.pausePrimitive).toBe("interrupt");
    expect(adapter.capabilities.stateIdSource).toBe("deterministic");
  });

  it("refuses a turn before boot, loudly", async () => {
    const adapter = createDeepAgentAdapter();
    await expect(
      adapter.runTurn({} as never, {} as never),
    ).rejects.toThrow(/runTurn before boot/);
  });

  it("boot registers the deepagents profiles and loads the engine slice; shutdown and releaseSession resolve as no-ops", async () => {
    const adapter = createDeepAgentAdapter();

    await adapter.boot(CONFIG);

    expect(registerSpy).toHaveBeenCalledTimes(1);
    await expect(adapter.shutdown()).resolves.toBeUndefined();
    await expect(adapter.releaseSession("ses_unknown")).resolves.toBeUndefined();
  });

  it("the config slice is the five fields the engine slice reads and nothing else", () => {
    expect(resolveDeepAgentConfig(CONFIG)).toEqual({
      checkpointerType: "memory",
      checkpointerProxyEndpoint: null,
      stigmerTokenRef: { current: "tok" },
      proxyEndpoint: null,
      mode: "local",
    });
  });
});
