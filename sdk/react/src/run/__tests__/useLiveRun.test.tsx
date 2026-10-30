/**
 * Proves useLiveRun (../useLiveRun.ts): a run that has ended is read once
 * and never again; a run that has not ended is read again every few seconds
 * until a read finds it ended; `live: false` reads once and stops; a missing
 * run is `null` with no error; a failed read is the error; `refetch` reads
 * at once; a null id reads nothing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

vi.mock("@stigmer/react-core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@stigmer/react-core")>()),
  useStigmer: vi.fn(),
}));

import type { Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { StigmerError } from "@stigmer/client";
import { useStigmer } from "@stigmer/react-core";
import { samples } from "@stigmer/react-core/test";
import { useLiveRun } from "../useLiveRun";

const mockUseStigmer = vi.mocked(useStigmer);

function mockGet(impl: (id: string) => Promise<Run>) {
  const get = vi.fn(impl);
  mockUseStigmer.mockReturnValue({ run: { get } } as unknown as ReturnType<typeof useStigmer>);
  return get;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useLiveRun", () => {
  it("reads a run that has ended once, and never again", async () => {
    const run = samples.run({ id: "r1", phase: RunPhase.RUN_COMPLETED });
    const get = mockGet(async () => run);

    const { result } = renderHook(() => useLiveRun("r1"));
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.run).toBe(run));

    expect(result.current.phase).toBe(RunPhase.RUN_COMPLETED);
    expect(result.current.isLive).toBe(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("reads a live run again until a read finds it ended", async () => {
    const live = samples.run({ id: "r2", phase: RunPhase.RUN_IN_PROGRESS });
    const done = samples.run({ id: "r2", phase: RunPhase.RUN_COMPLETED });
    let reads = 0;
    const get = mockGet(async () => (++reads >= 2 ? done : live));

    const { result } = renderHook(() => useLiveRun("r2"));
    await waitFor(() => expect(result.current.isLive).toBe(true));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_100);
    });
    await waitFor(() => expect(result.current.phase).toBe(RunPhase.RUN_COMPLETED));
    expect(result.current.isLive).toBe(false);

    const settled = get.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(get).toHaveBeenCalledTimes(settled);
  });

  it("reads once and stays put when not live", async () => {
    const get = mockGet(async () => samples.run({ id: "r3", phase: RunPhase.RUN_IN_PROGRESS }));

    const { result } = renderHook(() => useLiveRun("r3", { live: false }));
    await waitFor(() => expect(result.current.run).not.toBeNull());

    expect(result.current.isLive).toBe(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("reads a missing run as null, with no error", async () => {
    mockGet(async () => {
      throw new StigmerError("not-found", "no such run", 5);
    });

    const { result } = renderHook(() => useLiveRun("missing"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.run).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.phase).toBe(RunPhase.RUN_PHASE_UNSPECIFIED);
  });

  it("surfaces a failed read, and reads again on refetch", async () => {
    let fail = true;
    const run = samples.run({ id: "r4" });
    const get = mockGet(async () => {
      if (fail) throw new Error("boom");
      return run;
    });

    const { result } = renderHook(() => useLiveRun("r4"));
    await waitFor(() => expect(result.current.error?.message).toBe("boom"));

    fail = false;
    act(() => result.current.refetch());
    await waitFor(() => expect(result.current.run).toBe(run));
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("reads nothing for a null id", () => {
    const get = mockGet(async () => samples.run());
    const { result } = renderHook(() => useLiveRun(null));
    expect(result.current.run).toBeNull();
    expect(get).not.toHaveBeenCalled();
  });
});
