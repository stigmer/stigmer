// @vitest-environment node
//
// SSR safety: React frameworks prerender "use client" components on the
// server, so `import "@stigmer/embed/define"` runs where neither HTMLElement
// nor customElements exist. This suite runs in plain Node (no happy-dom) to
// prove the modules load and no-op there — the regression it pins is the
// module-scope `extends HTMLElement` crash (element.ts's BaseElement shim).

import { describe, it, expect } from "vitest";

describe("server-side import", () => {
  it("loads element.ts without a DOM and defineStigmerAgent no-ops", async () => {
    const { defineStigmerAgent, StigmerAgentElement } = await import(
      "../element.js"
    );

    expect(typeof StigmerAgentElement).toBe("function");
    expect(() => defineStigmerAgent()).not.toThrow();
  });

  it("loads the ./define side-effect entry without a DOM", async () => {
    await expect(import("../define.js")).resolves.toBeDefined();
  });
});
