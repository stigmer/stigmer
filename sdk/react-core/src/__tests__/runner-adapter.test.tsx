import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { StigmerContext } from "../context";
import { FetchCacheContext } from "../internal/FetchCacheProvider";
import { ExecutionTargetContext } from "../execution-target-context";
import { RunnerAdapterContext, useRunnerAdapter } from "../runner-adapter";
import type { RunnerAdapter } from "../runner-adapter";

function createMockAdapter(): RunnerAdapter & {
  onSessionOpened: ReturnType<typeof vi.fn>;
  onSessionClosed: ReturnType<typeof vi.fn>;
} {
  return {
    onSessionOpened: vi.fn().mockResolvedValue(undefined),
    onSessionClosed: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockStigmer(overrides: {
  create?: (...args: unknown[]) => Promise<unknown>;
} = {}) {
  return {
    session: {
      create: overrides.create ?? vi.fn().mockResolvedValue({
        metadata: { id: "ses_new-1" },
      }),
    },
  } as never;
}

function wrapperWithAdapter(
  client: unknown,
  adapter: RunnerAdapter | null,
  executionTarget?: "local" | "cloud",
) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <FetchCacheContext.Provider value={null}>
        <ExecutionTargetContext.Provider value={executionTarget}>
          <RunnerAdapterContext.Provider value={adapter}>
            <StigmerContext.Provider value={client as never}>
              {children}
            </StigmerContext.Provider>
          </RunnerAdapterContext.Provider>
        </ExecutionTargetContext.Provider>
      </FetchCacheContext.Provider>
    );
  };
}

describe("RunnerAdapter", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("useRunnerAdapter", () => {
    it("returns null when no adapter is provided", () => {
      const { result } = renderHook(() => useRunnerAdapter(), {
        wrapper: wrapperWithAdapter(createMockStigmer(), null),
      });
      expect(result.current).toBeNull();
    });

    it("returns the adapter when provided", () => {
      const adapter = createMockAdapter();
      const { result } = renderHook(() => useRunnerAdapter(), {
        wrapper: wrapperWithAdapter(createMockStigmer(), adapter),
      });
      expect(result.current).toBe(adapter);
    });
  });
});
