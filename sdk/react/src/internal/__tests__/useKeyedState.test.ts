/**
 * `useKeyedState` holds state that belongs to one key (a conversation), so
 * moving to another key starts from that key's initial value in the very
 * render the key changes, and nothing written for the old key can show on
 * the new one.
 *
 * Pinned:
 * - a new key reads `initial` in the render that carries it;
 * - the same key keeps what was written;
 * - a setter created under an old key (a late write from an awaited path)
 *   never changes the new key's value, and returning to the old key seeds
 *   it fresh rather than resurrecting that write;
 * - a setter from an earlier visit to the same key writes nothing after a
 *   return to it: each visit is its own;
 * - the setter keeps its identity while the key holds, and changes it only
 *   when the key does (callback deps name it).
 */
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useKeyedState } from "../useKeyedState";

function renderKeyed(initial: string) {
  const values: { key: string; value: string }[] = [];
  const hook = renderHook(
    ({ k }: { k: string }) => {
      const state = useKeyedState(k, initial);
      values.push({ key: k, value: state[0] });
      return state;
    },
    { initialProps: { k: "A" } },
  );
  return { ...hook, values };
}

describe("useKeyedState", () => {
  it("reads the initial value in the render a new key arrives", () => {
    const { result, rerender, values } = renderKeyed("seed");
    act(() => result.current[1]("chosen-in-A"));
    expect(result.current[0]).toBe("chosen-in-A");

    const from = values.length;
    rerender({ k: "B" });
    const onB = values.slice(from);
    expect(onB.every((entry) => entry.key === "B" && entry.value === "seed")).toBe(true);
    expect(result.current[0]).toBe("seed");
  });

  it("keeps what was written while the key holds", () => {
    const { result, rerender } = renderKeyed("seed");
    act(() => result.current[1]("kept"));
    rerender({ k: "A" });
    expect(result.current[0]).toBe("kept");

    act(() => result.current[1]("again"));
    expect(result.current[0]).toBe("again");
  });

  it("drops a write from a setter created under the previous key", () => {
    const { result, rerender } = renderKeyed("seed");
    const setForA = result.current[1];
    rerender({ k: "B" });
    act(() => result.current[1]("chosen-in-B"));

    act(() => setForA("late-for-A"));
    expect(result.current[0]).toBe("chosen-in-B");

    rerender({ k: "A" });
    expect(result.current[0]).toBe("seed");
  });

  it("drops a late write that lands before the new key was ever written", () => {
    const { result, rerender } = renderKeyed("seed");
    const setForA = result.current[1];
    rerender({ k: "B" });

    act(() => setForA("late-for-A"));
    expect(result.current[0]).toBe("seed");

    rerender({ k: "A" });
    expect(result.current[0]).toBe("seed");
  });

  it("drops a write from an earlier visit to the same key", () => {
    const { result, rerender } = renderKeyed("seed");
    const setForFirstVisit = result.current[1];
    rerender({ k: "B" });
    rerender({ k: "A" });
    expect(result.current[0]).toBe("seed");

    act(() => setForFirstVisit("late-from-first-visit"));
    expect(result.current[0]).toBe("seed");

    act(() => result.current[1]("chosen-on-return"));
    expect(result.current[0]).toBe("chosen-on-return");
  });

  it("keeps the setter's identity until the key changes", () => {
    const { result, rerender } = renderKeyed("seed");
    const first = result.current[1];
    act(() => first("x"));
    rerender({ k: "A" });
    expect(result.current[1]).toBe(first);

    rerender({ k: "B" });
    expect(result.current[1]).not.toBe(first);
  });
});
