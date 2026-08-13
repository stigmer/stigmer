import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  cacheSessionAgent,
  closeAllCachedAgents,
  computeAgentFingerprint,
  evictSessionAgent,
  takeCachedAgent,
  _parkedAgentCountForTests,
  _resetAgentSessionCacheForTests,
  type CacheableAgent,
} from "../agent-session-cache.js";

function makeAgent(agentId = "agent-1"): CacheableAgent & { close: ReturnType<typeof vi.fn> } {
  return { agentId, close: vi.fn() };
}

const FP = "fingerprint-a";
const OTHER_FP = "fingerprint-b";

describe("agent-session-cache", () => {
  beforeEach(() => {
    _resetAgentSessionCacheForTests();
    delete process.env.STIGMER_CURSOR_AGENT_CACHE_TTL_MS;
  });

  afterEach(() => {
    _resetAgentSessionCacheForTests();
    vi.useRealTimers();
  });

  describe("checkout semantics", () => {
    it("park then take returns the same agent without closing it", () => {
      const agent = makeAgent();
      cacheSessionAgent("ses-1", agent, FP);

      const taken = takeCachedAgent("ses-1", FP, "agent-1");

      expect(taken).toBe(agent);
      expect(agent.close).not.toHaveBeenCalled();
    });

    it("checkout is exclusive — a second take misses", () => {
      cacheSessionAgent("ses-1", makeAgent(), FP);

      expect(takeCachedAgent("ses-1", FP, "agent-1")).toBeDefined();
      expect(takeCachedAgent("ses-1", FP, "agent-1")).toBeUndefined();
    });

    it("an empty expectedAgentId (first-execution shape) still matches", () => {
      const agent = makeAgent();
      cacheSessionAgent("ses-1", agent, FP);

      expect(takeCachedAgent("ses-1", FP, "")).toBe(agent);
    });

    it("misses for a different session", () => {
      cacheSessionAgent("ses-1", makeAgent(), FP);

      expect(takeCachedAgent("ses-2", FP, "agent-1")).toBeUndefined();
      expect(_parkedAgentCountForTests()).toBe(1);
    });
  });

  describe("reuse guards", () => {
    it("fingerprint drift closes the parked agent and misses", () => {
      const agent = makeAgent();
      cacheSessionAgent("ses-1", agent, FP);

      const taken = takeCachedAgent("ses-1", OTHER_FP, "agent-1");

      expect(taken).toBeUndefined();
      expect(agent.close).toHaveBeenCalledTimes(1);
      expect(_parkedAgentCountForTests()).toBe(0);
    });

    it("agentId mismatch (harnessStateId replaced elsewhere) closes and misses", () => {
      const agent = makeAgent("agent-old");
      cacheSessionAgent("ses-1", agent, FP);

      const taken = takeCachedAgent("ses-1", FP, "agent-new");

      expect(taken).toBeUndefined();
      expect(agent.close).toHaveBeenCalledTimes(1);
    });
  });

  describe("lifetime bounds", () => {
    it("re-parking a session closes the displaced agent", () => {
      const first = makeAgent("agent-1");
      const second = makeAgent("agent-2");
      cacheSessionAgent("ses-1", first, FP);
      cacheSessionAgent("ses-1", second, FP);

      expect(first.close).toHaveBeenCalledTimes(1);
      expect(takeCachedAgent("ses-1", FP, "agent-2")).toBe(second);
    });

    it("idle TTL evicts and closes", () => {
      vi.useFakeTimers();
      process.env.STIGMER_CURSOR_AGENT_CACHE_TTL_MS = "1000";
      const agent = makeAgent();
      cacheSessionAgent("ses-1", agent, FP);

      vi.advanceTimersByTime(1001);

      expect(agent.close).toHaveBeenCalledTimes(1);
      expect(_parkedAgentCountForTests()).toBe(0);
    });

    it("checkout before the TTL fires disarms the eviction timer", () => {
      vi.useFakeTimers();
      process.env.STIGMER_CURSOR_AGENT_CACHE_TTL_MS = "1000";
      const agent = makeAgent();
      cacheSessionAgent("ses-1", agent, FP);

      const taken = takeCachedAgent("ses-1", FP, "agent-1");
      vi.advanceTimersByTime(5000);

      expect(taken).toBe(agent);
      expect(agent.close).not.toHaveBeenCalled();
    });

    it("the LRU cap closes the oldest parked agent", () => {
      vi.useFakeTimers();
      const first = makeAgent("agent-0");
      cacheSessionAgent("ses-0", first, FP);
      for (let i = 1; i < 32; i++) {
        vi.advanceTimersByTime(1);
        cacheSessionAgent(`ses-${i}`, makeAgent(`agent-${i}`), FP);
      }

      vi.advanceTimersByTime(1);
      cacheSessionAgent("ses-32", makeAgent("agent-32"), FP);

      expect(first.close).toHaveBeenCalledTimes(1);
      expect(_parkedAgentCountForTests()).toBe(32);
    });

    it("an empty sessionId is never parked — the lease releases immediately", () => {
      const agent = makeAgent();
      cacheSessionAgent("", agent, FP);

      expect(agent.close).toHaveBeenCalledTimes(1);
      expect(_parkedAgentCountForTests()).toBe(0);
    });
  });

  describe("explicit release", () => {
    it("evictSessionAgent closes the parked agent", () => {
      const agent = makeAgent();
      cacheSessionAgent("ses-1", agent, FP);

      evictSessionAgent("ses-1");

      expect(agent.close).toHaveBeenCalledTimes(1);
      expect(_parkedAgentCountForTests()).toBe(0);
    });

    it("closeAllCachedAgents closes everything (worker shutdown)", () => {
      const a = makeAgent("agent-a");
      const b = makeAgent("agent-b");
      cacheSessionAgent("ses-a", a, FP);
      cacheSessionAgent("ses-b", b, FP);

      closeAllCachedAgents();

      expect(a.close).toHaveBeenCalledTimes(1);
      expect(b.close).toHaveBeenCalledTimes(1);
      expect(_parkedAgentCountForTests()).toBe(0);
    });

    it("a close() that throws never breaks eviction", () => {
      const agent = makeAgent();
      agent.close.mockImplementation(() => {
        throw new Error("already disposed");
      });
      cacheSessionAgent("ses-1", agent, FP);

      expect(() => evictSessionAgent("ses-1")).not.toThrow();
      expect(_parkedAgentCountForTests()).toBe(0);
    });
  });

  describe("computeAgentFingerprint", () => {
    const baseOptions = {
      apiKey: "sk-secret-key",
      model: "gpt-5",
      modelParams: [{ key: "tier", value: "standard" }],
      workspaceDirs: ["/workspace/app"],
      mcpServers: { github: { command: "npx", env: { TOKEN: "t-1" } } },
    };

    it("is stable across key ordering", () => {
      const reordered = {
        mcpServers: { github: { env: { TOKEN: "t-1" }, command: "npx" } },
        workspaceDirs: ["/workspace/app"],
        modelParams: [{ key: "tier", value: "standard" }],
        model: "gpt-5",
        apiKey: "sk-secret-key",
      };
      expect(computeAgentFingerprint(baseOptions)).toBe(computeAgentFingerprint(reordered));
    });

    it("changes when any acquisition input changes", () => {
      const base = computeAgentFingerprint(baseOptions);
      expect(computeAgentFingerprint({ ...baseOptions, apiKey: "sk-rotated" })).not.toBe(base);
      expect(computeAgentFingerprint({ ...baseOptions, model: "gpt-5-mini" })).not.toBe(base);
      expect(
        computeAgentFingerprint({
          ...baseOptions,
          mcpServers: { github: { command: "npx", env: { TOKEN: "t-2" } } },
        }),
      ).not.toBe(base);
    });

    it("never embeds the raw api key", () => {
      expect(computeAgentFingerprint(baseOptions)).not.toContain("sk-secret-key");
    });
  });
});
