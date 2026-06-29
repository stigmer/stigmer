import { describe, it, expect, afterEach } from "vitest";
import { createElement } from "react";
import { render, cleanup } from "@testing-library/react";
import { useIsOverflowing } from "../useIsOverflowing";

afterEach(cleanup);

function Probe({
  enabled,
  onState,
}: {
  enabled: boolean;
  onState: (overflowing: boolean) => void;
}) {
  const { ref, isOverflowing } = useIsOverflowing<HTMLDivElement>(enabled);
  onState(isOverflowing);
  return createElement("div", { ref }, "content");
}

// happy-dom does not compute layout (scrollHeight === clientHeight === 0), so the
// deterministic contract here is the `enabled` gate and the not-overflowing
// baseline; the clipped (overflowing) case is verified against a real browser in
// the e2e layer, mirroring the SDK's documented unit/e2e split.
describe("useIsOverflowing", () => {
  it("reports not-overflowing when disabled (observer never attached)", () => {
    let state = true;
    render(createElement(Probe, { enabled: false, onState: (s) => (state = s) }));
    expect(state).toBe(false);
  });

  it("reports not-overflowing for content that fits its container", () => {
    let state = true;
    render(createElement(Probe, { enabled: true, onState: (s) => (state = s) }));
    expect(state).toBe(false);
  });
});
