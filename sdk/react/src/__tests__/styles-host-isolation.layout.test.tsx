// Real-browser reproduction of stigmer/stigmer#454: loading the shipped SDK
// stylesheet must not change a HOST application's computed layout — outside
// OR inside the `StigmerProvider` subtree.
//
// The pre-#454 stylesheet emitted bare Tailwind utilities (`.grid-cols-1`,
// `.relative`) inside `@layer stgm`, which the SDK's own layer-order
// declaration pins ABOVE the host's `utilities` layer. Any host element
// pairing a base utility with a variant override of the same property lost
// the variant the moment the stylesheet loaded — permanently, regardless of
// load order. Observed in production: Stigmer Law's case-detail facts rail
// (`grid-cols-1 @xl:grid-cols-[...]`) collapsed to one column at every width,
// and its phone sheet lost `position: fixed` (`relative max-lg:fixed`).
//
// Since #454 every SDK utility carries the `stg:` prefix, so the shipped
// stylesheet shares no class names with the host. This suite renders the
// exact breakage shapes from the issue against the SHIPPED `dist/styles.css`
// (built by `npm run build:libs`) plus a simulated host-Tailwind stylesheet,
// and measures computed layout in a real Chromium — happy-dom cannot resolve
// `@layer` or container queries.

import "../../dist/styles.css";

import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import type { Stigmer } from "@stigmer/sdk";
import { StigmerProvider } from "../provider";

/**
 * What a host's own Tailwind v4 build emits for the issue's two breakage
 * shapes: the standard layer-order declaration, base utilities and their
 * variant overrides in `@layer utilities`. Kept byte-faithful to Tailwind's
 * emission (same layer names, same rule shapes) so the cascade under test is
 * the real embedding cascade.
 */
const HOST_TAILWIND_CSS = `
  @layer theme, base, components, utilities;
  @layer utilities {
    .\\@container { container-type: inline-size; }
    .grid { display: grid; }
    .grid-cols-1 { grid-template-columns: repeat(1, minmax(0, 1fr)); }
    .relative { position: relative; }
    @container (width >= 36rem) {
      .\\@xl\\:grid-cols-\\[600px_1fr\\] { grid-template-columns: 600px 1fr; }
    }
    @media (width < 64rem) {
      .max-lg\\:fixed { position: fixed; }
    }
  }
`;

/**
 * The PRE-#454 SDK emission shape: a bare shared-name utility inside
 * `@layer stgm`, declared last. Injected only by the negative control to
 * prove this suite measures the defect mechanism.
 */
const LEGACY_SDK_LEAK_CSS = `
  @layer theme, base, components, utilities, stgm;
  @layer stgm {
    .grid-cols-1 { grid-template-columns: repeat(1, minmax(0, 1fr)); }
    .relative { position: relative; }
  }
`;

const injectedStyles: HTMLStyleElement[] = [];

function injectStyle(css: string): void {
  const el = document.createElement("style");
  el.textContent = css;
  document.head.appendChild(el);
  injectedStyles.push(el);
}

beforeEach(() => injectStyle(HOST_TAILWIND_CSS));

afterEach(() => {
  cleanup();
  for (const el of injectedStyles.splice(0)) el.remove();
});

/** See provider-container.layout.test.tsx — non-blocking, network-free. */
function makeClient(): Stigmer {
  return {
    baseUrl: "https://example.test",
    getAuthCredential: async () => null,
    fetch: (async () => {
      throw new Error("network disabled in test");
    }) as unknown as typeof globalThis.fetch,
  } as unknown as Stigmer;
}

/** The issue's facts-rail shape: base `grid-cols-1` + container-query variant. */
// prefix-classnames-ignore: these classNames simulate HOST-authored markup —
// they must stay unprefixed or this suite stops testing anything.
function HostFactsRail({ testId }: { readonly testId: string }) {
  return (
    <div className="@container" style={{ width: 800 }}>
      <div
        data-testid={testId}
        className="grid grid-cols-1 @xl:grid-cols-[600px_1fr]"
      >
        <div>main</div>
        <div>rail</div>
      </div>
    </div>
  );
}

/** The issue's phone-sheet shape: base `relative` + viewport variant. */
// prefix-classnames-ignore: host-simulation markup — must stay unprefixed.
function HostPhoneSheet({ testId }: { readonly testId: string }) {
  // The browser harness viewport is narrower than `lg` (64rem), so the
  // host's `max-lg:fixed` must be the winning declaration.
  return <div data-testid={testId} className="relative max-lg:fixed" />;
}

function columnsOf(testId: string): string {
  const el = document.querySelector(`[data-testid="${testId}"]`)!;
  return getComputedStyle(el).gridTemplateColumns;
}

function positionOf(testId: string): string {
  const el = document.querySelector(`[data-testid="${testId}"]`)!;
  return getComputedStyle(el).position;
}

describe("host isolation of the shipped stylesheet (#454)", () => {
  it("host container-query variant survives OUTSIDE the provider", () => {
    render(<HostFactsRail testId="rail-outside" />);
    expect(
      columnsOf("rail-outside"),
      "the host's @xl variant must win — pre-#454 the SDK's bare .grid-cols-1 in the higher stgm layer collapsed this to one column",
    ).toMatch(/^600px/);
  });

  it("host container-query variant survives INSIDE the provider subtree", () => {
    // The documented quickstart wraps the host's WHOLE app in StigmerProvider,
    // so host DOM lives under `.stgm`. Selector-scoping could never protect
    // this case — only name isolation (the prefix) can. This is the headline
    // assertion of the fix.
    render(
      <StigmerProvider client={makeClient()}>
        <HostFactsRail testId="rail-inside" />
      </StigmerProvider>,
    );
    expect(columnsOf("rail-inside")).toMatch(/^600px/);
  });

  it("host `relative max-lg:fixed` keeps position:fixed, outside and inside", () => {
    render(
      <>
        <HostPhoneSheet testId="sheet-outside" />
        <StigmerProvider client={makeClient()}>
          <HostPhoneSheet testId="sheet-inside" />
        </StigmerProvider>
      </>,
    );
    expect(positionOf("sheet-outside")).toBe("fixed");
    expect(positionOf("sheet-inside")).toBe("fixed");
  });

  it("SDK prefixed utilities still style SDK-authored DOM", () => {
    render(
      <StigmerProvider client={makeClient()}>
        <div data-testid="sdk-el" className="stg:flex stg:relative" />
      </StigmerProvider>,
    );
    const el = document.querySelector('[data-testid="sdk-el"]')!;
    expect(getComputedStyle(el).display).toBe("flex");
    expect(getComputedStyle(el).position).toBe("relative");
  });

  it("xyflow styles apply only inside the .stgm scope", () => {
    render(
      <>
        <div data-testid="xy-outside" className="react-flow" />
        <StigmerProvider client={makeClient()}>
          <div data-testid="xy-inside" className="react-flow" />
        </StigmerProvider>
      </>,
    );
    const readVar = (testId: string) =>
      getComputedStyle(document.querySelector(`[data-testid="${testId}"]`)!)
        .getPropertyValue("--xy-edge-stroke-default")
        .trim();
    // A host page using react-flow itself must keep its own styling — the
    // SDK's copy is scoped under `:where(.stgm, .stgm *)` by the build.
    expect(readVar("xy-outside")).toBe("");
    expect(readVar("xy-inside")).not.toBe("");
  });

  it("negative control: the pre-#454 emission shape breaks the host (this suite detects the defect)", () => {
    injectStyle(LEGACY_SDK_LEAK_CSS);
    render(
      <>
        <HostFactsRail testId="rail-legacy" />
        <HostPhoneSheet testId="sheet-legacy" />
      </>,
    );
    // One column: the bare .grid-cols-1 in the higher layer beats the
    // host's variant — the exact production breakage.
    expect(columnsOf("rail-legacy")).not.toMatch(/^600px/);
    expect(positionOf("sheet-legacy")).toBe("relative");
  });
});
