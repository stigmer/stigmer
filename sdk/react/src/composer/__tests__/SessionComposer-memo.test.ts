import { describe, it, expect } from "vitest";
import { SessionComposer } from "../SessionComposer";

describe("SessionComposer — memo isolation", () => {
  it("is wrapped in React.memo (shallow prop comparison)", () => {
    // React.memo returns an exotic component with $$typeof set to
    // Symbol.for("react.memo") and a `type` field pointing at the
    // inner component. For forwardRef components the inner type is an
    // object (the forwardRef exotic), not a plain function.
    const memoSymbol = Symbol.for("react.memo");
    const typed = SessionComposer as unknown as { $$typeof: symbol; type: unknown; compare: unknown };

    expect(typed.$$typeof).toBe(memoSymbol);
    expect(typed.type).toBeTruthy();

    const innerType = typed.type as { $$typeof?: symbol; render?: Function };
    if (typeof typed.type === "function") {
      expect((typed.type as Function).name).toMatch(/^SessionComposer/);
    } else {
      expect(innerType.$$typeof).toBe(Symbol.for("react.forward_ref"));
    }
  });

  it("uses default shallow comparison (no custom areEqual)", () => {
    const typed = SessionComposer as unknown as { compare: unknown };

    // When React.memo is called without a second argument, `compare`
    // is null — React falls back to shallow prop comparison.
    expect(typed.compare).toBeNull();
  });
});
