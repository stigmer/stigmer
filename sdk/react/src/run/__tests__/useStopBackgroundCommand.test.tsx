/**
 * Proves useStopBackgroundCommand (../useStopBackgroundCommand.ts): a stop
 * goes through the session's `stopBackgroundCommand` with the session and
 * the tool use that started the command; the stop in flight and a failure
 * are kept per tool use (with a scalar mirror) and rethrown; clearing resets
 * both.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Stigmer } from "@stigmer/client";
import { StigmerContext } from "../../context";
import { useStopBackgroundCommand } from "../useStopBackgroundCommand";

const stopBackgroundCommand = vi.fn();

const client = { session: { stopBackgroundCommand } } as unknown as Stigmer;

function Wrapper({ children }: { children: ReactNode }) {
  return <StigmerContext.Provider value={client}>{children}</StigmerContext.Provider>;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useStopBackgroundCommand", () => {
  it("stops through stopBackgroundCommand, by session and tool use, tracking the stop in flight", async () => {
    let resolve!: () => void;
    stopBackgroundCommand.mockReturnValueOnce(new Promise<void>((r) => (resolve = r)));
    const { result } = renderHook(() => useStopBackgroundCommand(), { wrapper: Wrapper });

    let pending!: Promise<void>;
    act(() => {
      pending = result.current.stopBackgroundCommand("ses-1", "run_1.bg-1");
    });
    expect(result.current.stoppingToolUseIds.has("run_1.bg-1")).toBe(true);
    await act(async () => {
      resolve();
      await pending;
    });
    expect(result.current.stoppingToolUseIds.has("run_1.bg-1")).toBe(false);
    expect(stopBackgroundCommand.mock.calls[0][0]).toMatchObject({ sessionId: "ses-1", toolUseId: "run_1.bg-1" });
  });

  it("keeps a failure per tool use and as the latest, rethrows it, and clears both", async () => {
    stopBackgroundCommand.mockRejectedValueOnce(new Error("the command already ended"));
    const { result } = renderHook(() => useStopBackgroundCommand(), { wrapper: Wrapper });

    await act(async () => {
      await expect(result.current.stopBackgroundCommand("ses-1", "run_1.bg-1")).rejects.toThrow("the command already ended");
    });
    expect(result.current.errorsByToolUseId.get("run_1.bg-1")?.message).toBe("the command already ended");
    expect(result.current.error?.message).toBe("the command already ended");

    act(() => result.current.clearError());
    expect(result.current.errorsByToolUseId.size).toBe(0);
    expect(result.current.error).toBeNull();
  });
});
