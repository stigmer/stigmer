import { describe, it, expect, vi } from "vitest";
import { SubAgentGate } from "../subagent-gate.js";

describe("SubAgentGate", () => {
  it("allows invocations under the concurrency limit", async () => {
    const gate = new SubAgentGate({ maxConcurrent: 2 });
    const invoke = vi.fn().mockResolvedValue({ messages: [{ content: "done" }] });

    const wrapped = gate.wrap(invoke, "test-agent");
    const result = await wrapped({ task: "hello" });

    expect(invoke).toHaveBeenCalledWith({ task: "hello" }, undefined);
    expect(result).toEqual({ messages: [{ content: "done" }] });
    expect(gate.activeCount).toBe(0);
  });

  it("rejects when at capacity with an error-shaped response", async () => {
    const gate = new SubAgentGate({ maxConcurrent: 1 });

    let resolveFirst!: () => void;
    const blockingPromise = new Promise<void>(r => { resolveFirst = r; });
    const invoke = vi.fn().mockImplementation(() => blockingPromise.then(() => ({ ok: true })));

    const wrapped = gate.wrap(invoke, "blocker");

    const first = wrapped({ task: "1" });
    expect(gate.activeCount).toBe(1);

    const second = await wrapped({ task: "2" });
    expect(second).toEqual(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            content: expect.stringContaining("was NOT started"),
          }),
        ]),
      }),
    );

    expect(invoke).toHaveBeenCalledTimes(1);

    resolveFirst();
    await first;
    expect(gate.activeCount).toBe(0);
  });

  it("releases slot on error", async () => {
    const gate = new SubAgentGate({ maxConcurrent: 1 });
    const invoke = vi.fn().mockRejectedValue(new Error("boom"));

    const wrapped = gate.wrap(invoke, "failing-agent");

    await expect(wrapped({ task: "crash" })).rejects.toThrow("boom");
    expect(gate.activeCount).toBe(0);
    expect(gate.hasCapacity).toBe(true);
  });

  it("tracks concurrent invocations correctly", async () => {
    const gate = new SubAgentGate({ maxConcurrent: 3 });
    const resolvers: Array<() => void> = [];
    const invoke = vi.fn().mockImplementation(() =>
      new Promise<{ ok: boolean }>(r => { resolvers.push(() => r({ ok: true })); }),
    );

    const wrapped = gate.wrap(invoke, "agent");

    const p1 = wrapped({ n: 1 });
    const p2 = wrapped({ n: 2 });
    const p3 = wrapped({ n: 3 });

    expect(gate.activeCount).toBe(3);
    expect(gate.hasCapacity).toBe(false);

    const rejected = await wrapped({ n: 4 });
    expect((rejected as { messages: unknown[] }).messages).toBeDefined();

    resolvers[0]();
    await p1;
    expect(gate.activeCount).toBe(2);
    expect(gate.hasCapacity).toBe(true);

    resolvers[1]();
    resolvers[2]();
    await Promise.all([p2, p3]);
    expect(gate.activeCount).toBe(0);
  });

  it("throws on invalid maxConcurrent", () => {
    expect(() => new SubAgentGate({ maxConcurrent: 0 })).toThrow("positive");
    expect(() => new SubAgentGate({ maxConcurrent: -1 })).toThrow("positive");
  });

  it("defaults to 3 concurrent", () => {
    const gate = new SubAgentGate();
    expect(gate.maxConcurrent).toBe(3);
  });

  it("includes agent name in rejection message", async () => {
    const gate = new SubAgentGate({ maxConcurrent: 1 });
    const invoke = vi.fn().mockImplementation(
      () => new Promise(() => {}),
    );

    const wrapped = gate.wrap(invoke, "research-agent");
    wrapped({ task: "1" });

    const rejection = await wrapped({ task: "2" });
    const content = (rejection as { messages: Array<{ content: string }> }).messages[0].content;
    expect(content).toContain("research-agent");
    expect(content).toContain("1");
  });
});
