// The app's mermaid loader resolves to the module StigmerProvider's
// `loadMermaid` expects: a default export with the `initialize` and `render`
// the kit's diagrams call.

import { describe, it, expect } from "vitest";
import { loadMermaid } from "../load-mermaid";

describe("loadMermaid", () => {
  it("loads mermaid's default export, the renderer the kit's diagrams call", async () => {
    const mermaid = (await loadMermaid()).default;

    expect(mermaid.initialize).toBeTypeOf("function");
    expect(mermaid.render).toBeTypeOf("function");
  });
});
