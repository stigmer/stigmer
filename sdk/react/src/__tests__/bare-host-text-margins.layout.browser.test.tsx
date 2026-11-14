// Bare-host suite for the kit's paragraph and heading margins.
//
// Runs in a real Chromium via `vitest.a11y.config.ts`: the defect under guard
// is the user agent's own margin on a paragraph (a line's height above and
// below) and a heading, which only a real browser applies. Like its sibling
// (bare-host-resets.layout.browser.test.tsx), it renders against the shipped
// stylesheet (`dist/styles.css`) and nothing else, so the page is the bare
// host: a customer's site without Tailwind's preflight.
//
// The contract (styles.css, the base-layer rule for the kit's text): a
// paragraph or heading that carries a kit class, or sits directly in an
// element that does, starts at no margin; a host's own paragraph inside
// `StigmerProvider` keeps the browser's; and every utility still wins over
// the reset, a parent's `space-y-*` included.

import "../../dist/styles.css";

import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import type { Stigmer } from "@stigmer/client";
import { StigmerProvider } from "../provider";

afterEach(cleanup);

function makeClient(): Stigmer {
  return {
    baseUrl: "https://example.test",
    getAuthCredential: async () => null,
    fetch: (async () => {
      throw new Error("network disabled in test");
    }) as unknown as typeof globalThis.fetch,
  } as unknown as Stigmer;
}

function renderScoped(ui: React.ReactNode): HTMLElement {
  render(
    <StigmerProvider client={makeClient()}>
      <div data-testid="probe">{ui}</div>
    </StigmerProvider>,
  );
  return document.querySelector('[data-testid="probe"]') as HTMLElement;
}

/** The element's top and bottom margins, in pixels. */
function block(element: Element | null): [number, number] {
  const style = getComputedStyle(element!);
  return [Number.parseFloat(style.marginTop), Number.parseFloat(style.marginBottom)];
}

describe("bare-host margins of the kit's paragraphs and headings", () => {
  it("CONTROL: a host's own paragraph and heading inside the provider keep the browser's margins", () => {
    const probe = renderScoped(
      <>
        <p data-testid="host-p">The host's prose</p>
        <h2 data-testid="host-h2">The host's heading</h2>
      </>,
    );
    expect(block(probe.querySelector('[data-testid="host-p"]'))).toEqual([16, 16]);
    expect(block(probe.querySelector('[data-testid="host-h2"]'))[0]).toBeGreaterThan(0);
  });

  it("gives a kit-classed paragraph and heading no margin", () => {
    const probe = renderScoped(
      <>
        <p className="stg:text-sm">A kit paragraph</p>
        <h1 className="stg:text-lg">A kit heading</h1>
      </>,
    );
    expect(block(probe.querySelector("p"))).toEqual([0, 0]);
    expect(block(probe.querySelector("h1"))).toEqual([0, 0]);
  });

  it("gives a bare paragraph sitting directly in a kit-classed element no margin", () => {
    const probe = renderScoped(
      <div className="stg:text-sm">
        <p>Drawn by the kit, with no class of its own</p>
      </div>,
    );
    expect(block(probe.querySelector("p"))).toEqual([0, 0]);
  });

  it("lets a margin utility and a parent's space-y win over the reset", () => {
    const probe = renderScoped(
      <>
        <p data-testid="spaced" className="stg:mt-2 stg:text-sm">
          Spaced on purpose
        </p>
        <div className="stg:space-y-2">
          <p data-testid="first">First</p>
          <p data-testid="last">Last</p>
        </div>
      </>,
    );
    expect(block(probe.querySelector('[data-testid="spaced"]'))).toEqual([8, 0]);
    expect(block(probe.querySelector('[data-testid="first"]'))).toEqual([0, 8]);
    expect(block(probe.querySelector('[data-testid="last"]'))).toEqual([0, 0]);
  });
});
