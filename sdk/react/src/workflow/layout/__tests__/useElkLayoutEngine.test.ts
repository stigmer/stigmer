import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { useElkLayoutEngine } from "../useElkLayoutEngine";
import type { LayoutEngine } from "../types";

const mockTerminate = vi.fn();

const mockEngine: LayoutEngine = {
  name: "elk-layered",
  layout: vi.fn().mockResolvedValue({
    positions: new Map(),
    durationMs: 10,
    engine: "elk-layered",
  }),
  terminate: mockTerminate,
};

vi.mock("../elk-layout-engine", () => ({
  createElkLayoutEngine: vi.fn(),
}));

async function getCreateElkMock() {
  const mod = await import("../elk-layout-engine");
  return vi.mocked(mod.createElkLayoutEngine);
}

describe("useElkLayoutEngine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTerminate.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("returns null initially while the engine is loading", async () => {
    const createElk = await getCreateElkMock();
    let resolveEngine!: (e: LayoutEngine) => void;
    createElk.mockReturnValue(
      new Promise((resolve) => {
        resolveEngine = resolve;
      }),
    );

    const { result } = renderHook(() => useElkLayoutEngine());

    expect(result.current).toBeNull();

    await act(async () => resolveEngine(mockEngine));
    expect(result.current).toBe(mockEngine);
  });

  it("returns the engine once creation resolves", async () => {
    const createElk = await getCreateElkMock();
    createElk.mockResolvedValue(mockEngine);

    const { result } = renderHook(() => useElkLayoutEngine());

    await vi.waitFor(() => {
      expect(result.current).toBe(mockEngine);
    });

    expect(createElk).toHaveBeenCalledTimes(1);
  });

  it("passes workerFactory and layoutOptions to createElkLayoutEngine", async () => {
    const createElk = await getCreateElkMock();
    createElk.mockResolvedValue(mockEngine);

    const workerFactory = vi.fn();
    const layoutOptions = { "elk.direction": "RIGHT" };

    renderHook(() =>
      useElkLayoutEngine({ workerFactory, layoutOptions }),
    );

    await vi.waitFor(() => {
      expect(createElk).toHaveBeenCalledWith({
        workerFactory,
        layoutOptions,
      });
    });
  });

  it("terminates the engine on unmount", async () => {
    const createElk = await getCreateElkMock();
    createElk.mockResolvedValue(mockEngine);

    const { result, unmount } = renderHook(() => useElkLayoutEngine());

    await vi.waitFor(() => {
      expect(result.current).toBe(mockEngine);
    });

    unmount();

    expect(mockTerminate).toHaveBeenCalledTimes(1);
  });

  it("returns null and does not create engine when enabled is false", async () => {
    const createElk = await getCreateElkMock();
    createElk.mockResolvedValue(mockEngine);

    const { result } = renderHook(() =>
      useElkLayoutEngine({ enabled: false }),
    );

    await new Promise((r) => setTimeout(r, 50));

    expect(result.current).toBeNull();
    expect(createElk).not.toHaveBeenCalled();
  });

  it("returns null gracefully when elkjs is not installed", async () => {
    const createElk = await getCreateElkMock();
    createElk.mockRejectedValue(new Error("Cannot find module 'elkjs'"));

    const { result } = renderHook(() => useElkLayoutEngine());

    await new Promise((r) => setTimeout(r, 50));

    expect(result.current).toBeNull();
  });

  it("terminates engine created after unmount (race condition)", async () => {
    const createElk = await getCreateElkMock();
    const lateTerminate = vi.fn();
    const lateEngine: LayoutEngine = {
      name: "elk-layered",
      layout: vi.fn().mockResolvedValue({ positions: new Map(), durationMs: 0, engine: "elk" }),
      terminate: lateTerminate,
    };

    let resolveEngine!: (e: LayoutEngine) => void;
    createElk.mockReturnValue(
      new Promise((resolve) => {
        resolveEngine = resolve;
      }),
    );

    const { result, unmount } = renderHook(() => useElkLayoutEngine());

    expect(result.current).toBeNull();

    unmount();

    await act(async () => resolveEngine(lateEngine));

    expect(lateTerminate).toHaveBeenCalledTimes(1);
  });
});
