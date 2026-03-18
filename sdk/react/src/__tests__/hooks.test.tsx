import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Stigmer } from "@stigmer/sdk";
import { StigmerContext } from "../context";
import { useStigmer } from "../hooks";

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
