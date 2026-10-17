/**
 * Proves useRunActions (../useRunActions.ts): terminate, pause and resume
 * each call their run RPC with the run id (and reason), return the updated
 * run and report it to `onSuccess`; a failure returns null and keeps the
 * error until cleared or the next action; a null run id makes every action a
 * no-op. Stopping a turn is the session's interrupt, not one of these.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Stigmer } from "@stigmer/client";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { StigmerContext } from "../../context";
import { samples } from "../../test/samples";
import { useRunActions } from "../useRunActions";

const terminate = vi.fn();
const pause = vi.fn();
const resume = vi.fn();
const client = { run: { terminate, pause, resume } } as unknown as Stigmer;

function Wrapper({ children }: { children: ReactNode }) {
  return <StigmerContext.Provider value={client}>{children}</StigmerContext.Provider>;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useRunActions", () => {
  it("terminates with the run id and reason, returning the updated run", async () => {
    const run = samples.run({ phase: RunPhase.RUN_TERMINATED });
    terminate.mockResolvedValueOnce(run);
    const onSuccess = vi.fn();
    const { result } = renderHook(() => useRunActions("run-1", { onSuccess }), { wrapper: Wrapper });

    let returned: unknown;
    await act(async () => {
      returned = await result.current.terminate("stuck");
    });

    expect(returned).toBe(run);
    expect(terminate.mock.calls[0][0]).toMatchObject({ id: "run-1", reason: "stuck" });
    expect(onSuccess).toHaveBeenCalledWith(run);
    expect(result.current.isSubmitting).toBe(false);
  });

  it("pauses (reason defaults to empty) and resumes", async () => {
    pause.mockResolvedValueOnce(samples.run({ phase: RunPhase.RUN_PAUSED }));
    resume.mockResolvedValueOnce(samples.run({ phase: RunPhase.RUN_IN_PROGRESS }));
    const { result } = renderHook(() => useRunActions("run-1"), { wrapper: Wrapper });

    await act(async () => {
      await result.current.pause();
      await result.current.terminate();
    });
    await act(async () => {
      await result.current.resume();
    });

    expect(pause.mock.calls[0][0]).toMatchObject({ id: "run-1", reason: "" });
    expect(terminate.mock.calls[0][0]).toMatchObject({ id: "run-1", reason: "" });
    expect(resume.mock.calls[0][0]).toMatchObject({ id: "run-1" });
  });

  it("returns null and keeps the error on failure, until cleared", async () => {
    pause.mockRejectedValueOnce(new Error("not running"));
    const { result } = renderHook(() => useRunActions("run-1"), { wrapper: Wrapper });

    let returned: unknown = "unset";
    await act(async () => {
      returned = await result.current.pause("hold");
    });

    expect(returned).toBeNull();
    expect(result.current.error?.message).toBe("not running");
    act(() => result.current.clearError());
    expect(result.current.error).toBeNull();
  });

  it("does nothing for a null run id", async () => {
    const { result } = renderHook(() => useRunActions(null), { wrapper: Wrapper });

    let returned: unknown = "unset";
    await act(async () => {
      returned = await result.current.terminate();
    });

    expect(returned).toBeNull();
    expect(terminate).not.toHaveBeenCalled();
  });
});
