/**
 * Pins the evaluator write hook's error handling: a refused save is kept as
 * `error` and rethrown, and `clearError` resets it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { DEFAULT_GRADING_SETTINGS } from "../grading-settings";
import { useSaveEvaluator } from "../useSaveEvaluator";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function wrap(mock: unknown) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <FetchCacheContext.Provider value={null}>
        <StigmerContext.Provider value={mock as never}>{children}</StigmerContext.Provider>
      </FetchCacheContext.Provider>
    );
  };
}

describe("useSaveEvaluator", () => {
  it("keeps and rethrows a refused save, and clears it", async () => {
    const refusal = new Error("unauthorized to configure grading for agent");
    const mock = { evaluator: { create: vi.fn().mockRejectedValue(refusal), update: vi.fn() } };
    const { result } = renderHook(() => useSaveEvaluator(), { wrapper: wrap(mock) });
    await act(async () => {
      await expect(
        result.current.save({ id: "agt_1", org: "org_acme" }, DEFAULT_GRADING_SETTINGS, null),
      ).rejects.toThrow("unauthorized to configure grading for agent");
    });
    expect(result.current.error?.message).toBe("unauthorized to configure grading for agent");
    act(() => result.current.clearError());
    expect(result.current.error).toBeNull();
  });
});
