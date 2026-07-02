import { describe, it, expect } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useAutoDisclosure } from "../useAutoDisclosure";

describe("useAutoDisclosure", () => {
  it("starts open when autoOpen is true", () => {
    const { result } = renderHook(() => useAutoDisclosure(true));
    expect(result.current[0]).toBe(true);
  });

  it("starts closed when autoOpen is false", () => {
    const { result } = renderHook(() => useAutoDisclosure(false));
    expect(result.current[0]).toBe(false);
  });

  it("honours initialOpen over autoOpen for the first render", () => {
    const { result } = renderHook(() =>
      useAutoDisclosure(false, { initialOpen: true }),
    );
    expect(result.current[0]).toBe(true);
  });

  it("tracks autoOpen while the user has not toggled", () => {
    const { result, rerender } = renderHook(
      ({ autoOpen }) => useAutoDisclosure(autoOpen),
      { initialProps: { autoOpen: true } },
    );
    expect(result.current[0]).toBe(true);

    rerender({ autoOpen: false });
    expect(result.current[0]).toBe(false);

    rerender({ autoOpen: true });
    expect(result.current[0]).toBe(true);
  });

  it("freezes on the user's choice once toggled, ignoring autoOpen", () => {
    const { result, rerender } = renderHook(
      ({ autoOpen }) => useAutoDisclosure(autoOpen),
      { initialProps: { autoOpen: true } },
    );

    // User collapses while the section is auto-open.
    act(() => result.current[1]());
    expect(result.current[0]).toBe(false);

    // Auto signal flips both ways — user's collapse must persist.
    rerender({ autoOpen: false });
    expect(result.current[0]).toBe(false);
    rerender({ autoOpen: true });
    expect(result.current[0]).toBe(false);
  });

  it("toggle flips from a user-opened state too", () => {
    const { result } = renderHook(() => useAutoDisclosure(false));
    expect(result.current[0]).toBe(false);

    act(() => result.current[1]());
    expect(result.current[0]).toBe(true);

    act(() => result.current[1]());
    expect(result.current[0]).toBe(false);
  });

  it("keeps a stable toggle identity across renders", () => {
    const { result, rerender } = renderHook(
      ({ autoOpen }) => useAutoDisclosure(autoOpen),
      { initialProps: { autoOpen: false } },
    );
    const first = result.current[1];
    rerender({ autoOpen: true });
    expect(result.current[1]).toBe(first);
  });
});
