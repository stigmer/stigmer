// Regression suite for #2824: a theme that names a typeface puts every piece
// of text in its scope in it, not only the text that reads the token by name.
//
// `font-family` is resolved where it is declared and inherited as a value,
// so redeclaring `--stgm-font-sans` on a theme class changes nothing a plain
// paragraph inherits. The corporate, friendly and fintech presets therefore
// declare `font-family: var(--stgm-font-sans)` beside the token, and the
// theming guide gives a host's own theme the same two lines. Only a real
// browser computes inherited fonts (happy-dom does not), so this runs in
// Chromium via `vitest.a11y.config.ts`, against the SHIPPED stylesheet
// (`dist/styles.css`, rebuilt by `npm run build:css`) and the presets' CSS.
// Fonts need not load: computed `font-family` is the declared stack.
//
// The directions, all load-bearing:
// 1. Each font-naming preset reaches inherited text (a paragraph, a heading,
//    a button) in the tree, and the portal container under `document.body`.
// 2. Controls: the default look and the font-less startup preset keep the
//    host page's font, the embedder contract the fix leaves alone.
// 3. The theming guide's recipe for a host's own theme: the token plus
//    `font-family` reaches inherited text, the token alone does not.

import "../../dist/styles.css";
import "@stigmer/design-tokens/presets/corporate.css";
import "@stigmer/design-tokens/presets/friendly.css";
import "@stigmer/design-tokens/presets/fintech.css";
import "@stigmer/design-tokens/presets/startup.css";

import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import type { ThemePresetId } from "@stigmer/design-tokens/presets";
import type { Stigmer } from "@stigmer/client";
import { StigmerProvider } from "../provider";

// The host page's own font, set on its root the way a host stylesheet does.
const HOST_FAMILY = "Host Page Sans";

// A host's own theme, written two ways: the guide's recipe, and the token
// alone (the shape the guide warns does not reach inherited text).
const HOST_THEME_CSS = `
.acme-theme {
  --stgm-font-sans: "Acme Grotesk", sans-serif;
  font-family: var(--stgm-font-sans);
}
.acme-token-only {
  --stgm-font-sans: "Acme Grotesk", sans-serif;
}
`;

let hostTheme: HTMLStyleElement;

beforeEach(() => {
  document.documentElement.style.fontFamily = `"${HOST_FAMILY}", serif`;
  hostTheme = document.createElement("style");
  hostTheme.textContent = HOST_THEME_CSS;
  document.head.appendChild(hostTheme);
});

afterEach(() => {
  cleanup();
  hostTheme.remove();
  document.documentElement.style.removeProperty("font-family");
});

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

/** The first family of an element's computed stack, unquoted. */
function firstFamily(el: Element): string {
  const [first = ""] = getComputedStyle(el).fontFamily.split(",");
  return first.trim().replace(/^["']|["']$/g, "");
}

function renderText(props: { preset?: ThemePresetId; className?: string }) {
  render(
    <StigmerProvider client={makeClient()} {...props}>
      <p data-testid="paragraph">Inherited text</p>
      <h2 data-testid="heading">A heading</h2>
      <button type="button" data-testid="button">
        A label
      </button>
    </StigmerProvider>,
  );
  const byId = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement;
  return { paragraph: byId("paragraph"), heading: byId("heading"), button: byId("button") };
}

describe("a theme that names a typeface applies it to its whole scope (#2824)", () => {
  it.each([
    ["corporate", "Inter"],
    ["friendly", "Nunito"],
    ["fintech", "IBM Plex Sans"],
  ] as const)("%s puts inherited text in %s", (preset, family) => {
    const { paragraph, heading, button } = renderText({ preset });

    expect(firstFamily(paragraph)).toBe(family);
    expect(firstFamily(heading)).toBe(family);
    expect(firstFamily(button), "form controls take font: inherit").toBe(family);
  });

  it("reaches the portal container, where popovers, dialogs and menus render", () => {
    renderText({ preset: "friendly" });
    const portal = document.body.querySelector("[data-stgm-portal]");
    expect(portal, "the provider must mount its portal container").not.toBeNull();

    const portaled = document.createElement("p");
    portal!.appendChild(portaled);

    expect(firstFamily(portal!)).toBe("Nunito");
    expect(firstFamily(portaled)).toBe("Nunito");
  });

  describe("controls: a look that names no typeface keeps the host's", () => {
    it("CONTROL: the default look inherits the host page's font", () => {
      const { paragraph, button } = renderText({});

      expect(firstFamily(paragraph)).toBe(HOST_FAMILY);
      expect(firstFamily(button)).toBe(HOST_FAMILY);
    });

    it("the startup preset, which names no font, inherits the host page's font", () => {
      const { paragraph } = renderText({ preset: "startup" });

      expect(firstFamily(paragraph)).toBe(HOST_FAMILY);
    });
  });

  describe("a host's own theme, passed as className (the theming guide's recipe)", () => {
    it("the token plus font-family reaches inherited text", () => {
      const { paragraph, heading } = renderText({ className: "acme-theme" });

      expect(firstFamily(paragraph)).toBe("Acme Grotesk");
      expect(firstFamily(heading)).toBe("Acme Grotesk");
    });

    it("the token alone does not: inherited text keeps the host page's font", () => {
      const { paragraph } = renderText({ className: "acme-token-only" });

      expect(firstFamily(paragraph)).toBe(HOST_FAMILY);
    });
  });
});
