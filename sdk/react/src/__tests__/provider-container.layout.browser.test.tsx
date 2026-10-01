// Layout-contract regression suite for the provider's in-tree container
// (#260, DD-019). Runs in a real Chromium via `vitest.a11y.config.ts` —
// resolving percentage heights and flex min-size behavior requires a real
// layout engine, which happy-dom does not have.
//
// The contract has two halves, and both need guarding:
//
// 1. The SDK ships NO sizing for the container. A default `height: 100%`
//    looks benign but balloons under flex-item parents (flexbox treats a
//    flexed size as definite for percentage resolution — a `flex-1` prose
//    column made the container jump from ~320px to ~4800px on our own
//    docs site), so sizing is the host's call.
// 2. The documented opt-in recipe — host CSS targeting the stable
//    `.stgm[data-stgm-root]` selector — must actually deliver fixed-height
//    embedding: percentage chains pass through, and the container shrinks
//    inside flex layouts so content scrolls internally.
//
// Like the a11y harness (DD-21), this renders against the SHIPPED
// stylesheet (`dist/styles.css`, built by `npm run build:libs`), so the
// contract is verified on the artifact consumers actually load.

import "../../dist/styles.css";

import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import type { Stigmer } from "@stigmer/sdk";
import { StigmerProvider } from "../provider";

/**
 * The exact host CSS recipe documented for fixed-height embeddings.
 * Unlayered on purpose — that is how hosts author it, and it must beat
 * anything the SDK ships in `@layer stgm`.
 */
const FIXED_HEIGHT_RECIPE = `
  .stgm[data-stgm-root] {
    height: 100%;
    min-height: 0;
  }
`;

let recipeStyle: HTMLStyleElement | null = null;

function applyFixedHeightRecipe(): void {
  recipeStyle = document.createElement("style");
  recipeStyle.textContent = FIXED_HEIGHT_RECIPE;
  document.head.appendChild(recipeStyle);
}

afterEach(() => {
  cleanup();
  recipeStyle?.remove();
  recipeStyle = null;
});

// A minimal client: the provider eagerly fetches the model/task-kind
// registries on mount. Returning a null credential keeps that work
// non-blocking (it polls for a token) so rendering is synchronous and
// never touches the network during the test.
function makeClient(): Stigmer {
  return {
    baseUrl: "https://example.test",
    getAuthCredential: async () => null,
    fetch: (async () => {
      throw new Error("network disabled in test");
    }) as unknown as typeof globalThis.fetch,
  } as unknown as Stigmer;
}

function getInTreeContainer(): HTMLElement {
  const child = document.querySelector('[data-testid="probe"]');
  const container = child?.closest("[data-stgm-root]") as HTMLElement | null;
  expect(container, "provider must render an in-tree [data-stgm-root] container").not.toBeNull();
  return container!;
}

describe("StigmerProvider container layout contract (#260)", () => {
  describe("default: the SDK ships no container sizing", () => {
    it("sizes to content under a definite-height parent", () => {
      render(
        <div style={{ height: 480, overflow: "hidden" }}>
          <StigmerProvider client={makeClient()}>
            <div data-testid="probe" style={{ height: 120 }} />
          </StigmerProvider>
        </div>,
      );

      expect(getInTreeContainer().getBoundingClientRect().height).toBe(120);
    });

    it("sizes to content under a flex-item parent (the flex-1 prose-column shape that a default height rule would balloon)", () => {
      render(
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ flex: "1 1 0%" }}>
            <StigmerProvider client={makeClient()}>
              <div data-testid="probe" style={{ height: 120 }} />
            </StigmerProvider>
            <div style={{ height: 300 }} />
          </div>
        </div>,
      );

      expect(getInTreeContainer().getBoundingClientRect().height).toBe(120);
    });
  });

  describe("opt-in: the documented host CSS recipe", () => {
    it("passes a percentage-height chain through to descendants under a definite-height parent", () => {
      applyFixedHeightRecipe();

      // The exact embedding shape from the issue: a fixed-height pane
      // with an h-full-style chain below the provider.
      render(
        <div style={{ height: 480, overflow: "hidden" }}>
          <StigmerProvider client={makeClient()}>
            <div data-testid="probe" style={{ height: "100%" }} />
          </StigmerProvider>
        </div>,
      );

      const container = getInTreeContainer();
      const probe = document.querySelector('[data-testid="probe"]') as HTMLElement;

      expect(container.getBoundingClientRect().height).toBe(480);
      expect(probe.getBoundingClientRect().height).toBe(480);
    });

    it("shrinks below content as a flex child so internal-scroll panes can work", () => {
      applyFixedHeightRecipe();

      // As a flex item the container's default would be `min-height:
      // auto`, which floors it at its content height (500px here) and
      // defeats the fill-remaining-space pattern. The recipe's
      // `min-height: 0` lets the 300px column allocate 200px to the
      // container after the fixed 100px header.
      render(
        <div style={{ display: "flex", flexDirection: "column", height: 300 }}>
          <div style={{ flexShrink: 0, height: 100 }} />
          <StigmerProvider client={makeClient()}>
            <div data-testid="probe" style={{ height: 500 }} />
          </StigmerProvider>
        </div>,
      );

      expect(getInTreeContainer().getBoundingClientRect().height).toBe(200);
    });

    it("never reaches the portal container", () => {
      applyFixedHeightRecipe();

      render(
        <div style={{ height: 480 }}>
          <StigmerProvider client={makeClient()}>
            <div data-testid="probe" />
          </StigmerProvider>
        </div>,
      );

      const portal = document.body.querySelector("[data-stgm-portal]") as HTMLElement;
      expect(portal).not.toBeNull();
      // The recipe targets [data-stgm-root]; the portal container must
      // stay unsized (it hosts position-fixed surfaces only).
      expect(portal.getBoundingClientRect().height).toBe(0);
    });
  });
});
