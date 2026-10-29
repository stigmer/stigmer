// Tests for loadMermaid, which runs the host's `loadMermaid`: diagrams
// mounted together share one load, and a failed load is not remembered, so
// the next diagram tries again. Each test loads the module fresh, because
// the shared load is module state.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { MermaidModule } from "../../mermaid-loader-context";

const MERMAID = { initialize: vi.fn(), render: vi.fn() } as unknown as MermaidModule;

async function freshLoader() {
  vi.resetModules();
  return (await import("../mermaid-loader")).loadMermaid;
}

beforeEach(() => {
  vi.resetModules();
});

describe("loadMermaid", () => {
  it("returns the loaded module's default export, loading once for concurrent callers", async () => {
    const loadMermaid = await freshLoader();
    const hostLoader = vi.fn(() => Promise.resolve({ default: MERMAID }));

    const [first, second] = await Promise.all([loadMermaid(hostLoader), loadMermaid(hostLoader)]);

    expect(first).toBe(MERMAID);
    expect(second).toBe(MERMAID);
    expect(hostLoader).toHaveBeenCalledTimes(1);
  });

  it("calls the host's loader again after a failed load", async () => {
    const loadMermaid = await freshLoader();
    const hostLoader = vi
      .fn<() => Promise<{ default: MermaidModule }>>()
      .mockRejectedValueOnce(new Error("chunk failed to load"))
      .mockResolvedValue({ default: MERMAID });

    await expect(loadMermaid(hostLoader)).rejects.toThrow("chunk failed to load");
    await expect(loadMermaid(hostLoader)).resolves.toBe(MERMAID);
    expect(hostLoader).toHaveBeenCalledTimes(2);
  });
});
