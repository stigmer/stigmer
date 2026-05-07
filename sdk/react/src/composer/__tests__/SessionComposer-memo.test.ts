import { describe, it, expect } from "vitest";
import { SessionComposer } from "../SessionComposer";

describe("SessionComposer — memo isolation", () => {
  it("is wrapped in React.memo (shallow prop comparison)", () => {
    // React.memo returns an exotic component with $$typeof set to
    // Symbol.for("react.memo") and a `type` field pointing at the
    // inner function. Regular function components have neither.
    const memoSymbol = Symbol.for("react.memo");
    const typed = SessionComposer as unknown as { $$typeof: symbol; type: Function; compare: unknown };

    expect(typed.$$typeof).toBe(memoSymbol);
    expect(typeof typed.type).toBe("function");
    // The transform may rename the inner function to avoid shadowing
    // the outer `const SessionComposer` binding (e.g. "SessionComposer2").
    expect(typed.type.name).toMatch(/^SessionComposer/);
  });

  it("uses default shallow comparison (no custom areEqual)", () => {
    const typed = SessionComposer as unknown as { compare: unknown };

    // When React.memo is called without a second argument, `compare`
    // is null — React falls back to shallow prop comparison.
    expect(typed.compare).toBeNull();
  });
});
