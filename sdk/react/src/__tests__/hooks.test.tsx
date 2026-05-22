import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Stigmer } from "@stigmer/sdk";
import { StigmerContext } from "../context";
import { useStigmer } from "../hooks";
import { ExecutionTargetContext, useExecutionTarget } from "../execution-target-context";

describe("useStigmer", () => {
  it("throws when used outside StigmerProvider", () => {
    expect(() => renderHook(() => useStigmer())).toThrow(
      "useStigmer must be used within <StigmerProvider>. " +
        "Wrap your component tree with <StigmerProvider client={stigmerClient}>.",
    );
  });

  it("returns the Stigmer client when inside a provider", () => {
    const mockClient = { agent: {} } as unknown as Stigmer;

    const wrapper = ({ children }: { children: ReactNode }) => (
      <StigmerContext.Provider value={mockClient}>
        {children}
      </StigmerContext.Provider>
    );

    const { result } = renderHook(() => useStigmer(), { wrapper });
    expect(result.current).toBe(mockClient);
  });
});

describe("useExecutionTarget", () => {
  it("returns undefined when no ExecutionTargetContext.Provider wraps it", () => {
    const { result } = renderHook(() => useExecutionTarget());
    expect(result.current).toBeUndefined();
  });

  it("returns 'local' when provider sets executionTarget to local", () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ExecutionTargetContext.Provider value="local">
        {children}
      </ExecutionTargetContext.Provider>
    );
    const { result } = renderHook(() => useExecutionTarget(), { wrapper });
    expect(result.current).toBe("local");
  });

  it("returns 'cloud' when provider sets executionTarget to cloud", () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ExecutionTargetContext.Provider value="cloud">
        {children}
      </ExecutionTargetContext.Provider>
    );
    const { result } = renderHook(() => useExecutionTarget(), { wrapper });
    expect(result.current).toBe("cloud");
  });
});
