// Regression suite for #1223: native controls, their popups and scrollbars
// follow the scope's resolved color mode. Browsers draw them from the CSS
// `color-scheme` property, not from the theme's tokens, so the shipped
// stylesheet must derive `color-scheme` from `data-stgm-color-mode` on BOTH
// provider containers (the in-tree root and the portal container), and must
// leave the host page's own scheme untouched.
//
// Runs in a real Chromium via `vitest.a11y.config.ts` against the SHIPPED
// stylesheet (`dist/styles.css`): happy-dom does not apply stylesheet rules
// to computed style.

import "../../dist/styles.css";

import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import type { Stigmer } from "@stigmer/sdk";
import { StigmerProvider } from "../provider";

afterEach(cleanup);

// A minimal client: the provider fetches registries on mount; a null
// credential keeps that off the network.
function makeClient(): Stigmer {
  return {
    baseUrl: "https://example.test",
    getAuthCredential: async () => null,
    fetch: (async () => {
      throw new Error("network disabled in test");
    }) as unknown as typeof globalThis.fetch,
  } as unknown as Stigmer;
}

function renderIn(mode: "light" | "dark") {
  render(
    <StigmerProvider client={makeClient()} colorMode={mode}>
      <input type="checkbox" data-testid="control" />
    </StigmerProvider>,
  );
  const control = document.querySelector('[data-testid="control"]') as HTMLElement;
  const root = control.closest("[data-stgm-root]") as HTMLElement;
  const portal = document.body.querySelector("[data-stgm-portal]") as HTMLElement | null;
  return { control, root, portal };
}

describe("StigmerProvider color-scheme (#1223)", () => {
  it.each(["light", "dark"] as const)("derives %s on both containers and their controls", (mode) => {
    const { control, root, portal } = renderIn(mode);

    expect(getComputedStyle(root).colorScheme).toBe(mode);
    expect(getComputedStyle(control).colorScheme).toBe(mode);
    expect(portal, "the provider must mount its portal container").not.toBeNull();
    expect(getComputedStyle(portal!).colorScheme).toBe(mode);
  });

  it("leaves the host page's own scheme alone", () => {
    renderIn("dark");
    expect(getComputedStyle(document.documentElement).colorScheme).toBe("normal");
  });
});
