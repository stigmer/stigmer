/**
 * Pins the live tests' one cross-package read (`real-model-registry.ts`):
 * the server's committed registry is where the helper looks, it parses to
 * the shape the live tests read, and the two rows they rely on are there.
 *
 * Runs in the ordinary suite, so the day the server moves or reshapes the
 * file this goes red on that pull request, not in the live lane after a
 * release.
 */
import { describe, expect, it } from "vitest";

import { cursorCatalogRows, nativeRows, providerModelId, realModelRegistry } from "../real-model-registry.js";

describe("realModelRegistry", () => {
  const document = realModelRegistry();

  it("reads the server's committed registry, native and Cursor rows both present", () => {
    expect(nativeRows(document).length).toBeGreaterThan(0);
    expect(cursorCatalogRows(document).length).toBeGreaterThan(0);
  });

  it("carries the native live model with a provider id that is not its registry id", () => {
    const haiku = nativeRows(document).find((m) => m.id === "claude-haiku-4.5");
    expect(haiku, "the native live cases run on claude-haiku-4.5").toBeDefined();
    expect(providerModelId(haiku!)).not.toBe("claude-haiku-4.5");
  });

  it("leaves the Cursor Auto pool out of the catalog rows", () => {
    expect(cursorCatalogRows(document).map((m) => m.id)).not.toContain("default");
    expect(cursorCatalogRows(document).map((m) => m.id)).toContain("composer-2.5");
  });
});
