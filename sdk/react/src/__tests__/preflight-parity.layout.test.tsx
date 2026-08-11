// Preflight-parity regression suite for form controls (#374).
//
// Runs in a real Chromium via `vitest.a11y.config.ts` — the defect under
// guard is the user agent's OWN default control styling (buttonface
// background, built-in padding, UA font stack), which only a real browser
// applies. happy-dom has no UA stylesheet, so it would pass vacuously.
//
// The contract: every SDK component is authored against Tailwind's preflight
// baseline (our consoles run it globally). In a host WITHOUT a preflight —
// third-party embeds, the packed demo tours — the scoped form-control
// preflight in `styles.css` must reproduce that baseline under `.stgm`, or
// every unstyled-by-intent button renders as a grey UA box (the #374
// screenshots). Like the sibling layout suites (DD-21), this renders against
// the SHIPPED stylesheet (`dist/styles.css`, rebuilt by `npm run build:css`)
// and nothing else — exactly what an embed loads.
//
// Two directions, both load-bearing:
// 1. UA defaults neutralized: bare controls show no buttonface box, no UA
//    padding, no UA font.
// 2. Utilities still win: the preflight lives in `@layer base`, so `bg-*`
//    and `p-*` utilities on themed components must beat it. This half is
//    what fails if the block ever migrates to a layer above `utilities`
//    (the exact mistake that shipped three times with the border reset —
//    see styles-border-layer-invariant.test.ts for the host-compiled twin).

import "../../dist/styles.css";

import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import type { Stigmer } from "@stigmer/sdk";
import { StigmerProvider } from "../provider";
import { Button } from "../button/Button.js";
import { UNSTYLED_BUTTON } from "../internal/form-primitives.js";

afterEach(cleanup);

// A minimal client (the provider-container suite's idiom): a null credential
// keeps the provider's registry fetches non-blocking so rendering is
// synchronous and never touches the network.
function makeClient(): Stigmer {
  return {
    baseUrl: "https://example.test",
    getAuthCredential: async () => null,
    fetch: (async () => {
      throw new Error("network disabled in test");
    }) as unknown as typeof globalThis.fetch,
  } as unknown as Stigmer;
}

/**
 * Renders `ui` inside the provider, wrapped in a probe `<div>` with a
 * distinctive font so inheritance is detectable: a control that inherits
 * (`font: inherit`) computes to Georgia; one still wearing the UA button
 * font does not.
 */
function renderScoped(ui: React.ReactNode): HTMLElement {
  render(
    <StigmerProvider client={makeClient()}>
      <div data-testid="probe" style={{ fontFamily: "Georgia, serif" }}>
        {ui}
      </div>
    </StigmerProvider>,
  );
  return document.querySelector('[data-testid="probe"]') as HTMLElement;
}

function computed(el: Element): CSSStyleDeclaration {
  return getComputedStyle(el);
}

const TRANSPARENT = "rgba(0, 0, 0, 0)";

describe("scoped form-control preflight (#374)", () => {
  describe("UA defaults are neutralized under .stgm", () => {
    it("a bare button loses the buttonface box, UA padding, and UA font", () => {
      const probe = renderScoped(<button type="button">bare</button>);
      const style = computed(probe.querySelector("button")!);

      expect(style.backgroundColor, "UA buttonface background must be cleared").toBe(TRANSPARENT);
      // Chromium's UA button padding is 1px 6px — all four sides must be 0.
      expect(
        [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft],
        "UA button padding must be zeroed",
      ).toEqual(["0px", "0px", "0px", "0px"]);
      expect(style.fontFamily, "button font must inherit, not the UA stack").toBe(
        computed(probe).fontFamily,
      );
      expect(style.borderTopLeftRadius).toBe("0px");
    });

    it("an unstyled-by-intent tile button (the #371 shape) renders content-only", () => {
      // The exact pattern the issue screenshotted: an image tile whose only
      // classes are UNSTYLED_BUTTON + geometry.
      const probe = renderScoped(
        <button type="button" className={`${UNSTYLED_BUTTON} stg:relative stg:block stg:h-14 stg:w-14 stg:rounded-md`}>
          tile
        </button>,
      );
      const style = computed(probe.querySelector("button")!);

      expect(style.backgroundColor).toBe(TRANSPARENT);
      expect(style.paddingLeft).toBe("0px");
      expect(style.cursor, "UNSTYLED_BUTTON supplies the pointer cursor").toBe("pointer");
      // Geometry utilities keep working on top of the reset.
      expect(style.width).toBe("56px");
      expect(style.borderTopLeftRadius).not.toBe("0px");
    });

    it("bare input, textarea, and select lose UA backgrounds and inherit the font", () => {
      const probe = renderScoped(
        <>
          <input readOnly value="i" />
          <textarea readOnly value="t" />
          <select defaultValue="o">
            <option value="o">o</option>
          </select>
        </>,
      );

      for (const tag of ["input", "textarea", "select"] as const) {
        const style = computed(probe.querySelector(tag)!);
        expect(style.backgroundColor, `${tag} UA background must be cleared`).toBe(TRANSPARENT);
        expect(style.fontFamily, `${tag} font must inherit`).toBe(computed(probe).fontFamily);
      }
      expect(
        computed(probe.querySelector("textarea")!).resize,
        "textareas resize vertically only (preflight parity)",
      ).toBe("vertical");
    });
  });

  describe("utilities still beat the preflight (the base-vs-utilities invariant, on the shipped artifact)", () => {
    it("the themed Button keeps its background and padding", () => {
      const probe = renderScoped(<Button variant="primary">go</Button>);
      const style = computed(probe.querySelector("button")!);

      // `bg-primary` must survive the preflight's background-color:
      // transparent — this is the assertion that fails if the form-control
      // block ever lands in a layer above `utilities`.
      expect(style.backgroundColor, "bg-primary must win over the preflight").not.toBe(
        TRANSPARENT,
      );
      // size "sm" = px-3 py-1.5 → 12px / 6px.
      expect(style.paddingLeft, "p-* utilities must win over the preflight").toBe("12px");
      expect(style.paddingTop).toBe("6px");
    });

    it("the ghost Button is transparent by design and stays that way", () => {
      // Ghost sets NO bg-* utility: pre-#374 it silently wore the UA
      // buttonface grey in embeds. Transparent here proves the preflight is
      // what ghost was implicitly depending on all along.
      const probe = renderScoped(<Button variant="ghost">go</Button>);
      expect(computed(probe.querySelector("button")!).backgroundColor).toBe(TRANSPARENT);
    });
  });
});
