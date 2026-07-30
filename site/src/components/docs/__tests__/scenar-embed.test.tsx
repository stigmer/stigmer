import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import { ScenarEmbed } from "../scenar-embed";

/**
 * The docs `ScenarEmbed` is now a thin slug → URL adapter over `@scenar/embed`'s
 * official React component, so these tests cover only what this wrapper owns: the
 * id → published-URL mapping (production default + the authoring-loop env
 * override), the a11y title, the light theme pin, and the responsive box. The
 * strict postMessage validation, resize-to-fit, and multi-instance isolation are
 * covered by `@scenar/embed`'s own suite.
 */
function getIframe(): HTMLIFrameElement {
  return screen.getByTitle("Authentication flow walkthrough") as HTMLIFrameElement;
}

beforeEach(() => {
  document.documentElement.className = "";
});

afterEach(() => {
  vi.unstubAllEnvs();
  cleanup();
});

describe("ScenarEmbed", () => {
  it("pins tours to the light theme even though the site itself is dark", () => {
    // The docs page always carries the `dark` class; media is deliberately
    // light-on-dark, so the pin must win over the host state.
    document.documentElement.classList.add("dark");
    render(
      <ScenarEmbed
        id="authentication-flow-playback"
        title="Authentication flow walkthrough"
      />,
    );

    expect(getIframe().getAttribute("src")).toBe(
      "https://stigmer.ai/demos/authentication-flow-playback/?theme=light",
    );
  });

  it("frames the tour from NEXT_PUBLIC_SCENAR_EMBED_BASE when set (authoring loop)", () => {
    vi.stubEnv("NEXT_PUBLIC_SCENAR_EMBED_BASE", "http://localhost:4173");
    render(
      <ScenarEmbed
        id="authentication-flow-playback"
        title="Authentication flow walkthrough"
      />,
    );

    expect(getIframe().getAttribute("src")).toBe(
      "http://localhost:4173/authentication-flow-playback/?theme=light",
    );
  });

  it("sets accessibility, lazy-loading, and fullscreen attributes", () => {
    render(
      <ScenarEmbed
        id="authentication-flow-playback"
        title="Authentication flow walkthrough"
      />,
    );

    const iframe = getIframe();
    expect(iframe.getAttribute("loading")).toBe("lazy");
    expect(iframe.getAttribute("allow")).toBe("autoplay; fullscreen");
    expect(iframe.hasAttribute("allowfullscreen")).toBe(true);
    expect(iframe.getAttribute("title")).toBe("Authentication flow walkthrough");
  });

  it("falls back to a generic accessible title", () => {
    render(<ScenarEmbed id="authentication-flow-playback" />);
    expect(screen.getByTitle("Interactive product tour")).toBeTruthy();
  });

  it("renders inside the responsive docs box with the recorded aspect-ratio baseline", () => {
    render(
      <ScenarEmbed
        id="authentication-flow-playback"
        title="Authentication flow walkthrough"
      />,
    );

    const wrapper = getIframe().parentElement as HTMLElement;
    expect(wrapper.className).toContain("not-prose");
    expect(wrapper.className).toContain("mx-auto");
    expect(wrapper.className).toContain("max-w-4xl");
    // The tours' recorded viewport (demos/scripts/pack-all.mjs packs at
    // 1440x900, 16:10), pinned here so first paint matches the embed's
    // post-handshake size with no layout jump. Gate invariant 9
    // (verify-scenar-tours) holds this pin and the pack flags in lockstep;
    // this assertion is the unit-level half of that pairing.
    expect(wrapper.style.aspectRatio).toBe("1440 / 900");
  });

  it("drops the pin once the embed reports its own size", () => {
    // The pin is a pre-handshake baseline only. `@scenar/embed`'s wrapper
    // spreads host `style` last, so a permanent pin would override the
    // resize handshake for the embed's whole life — and letterbox every
    // tour the moment the pin and the packed viewport disagree.
    render(
      <ScenarEmbed
        id="authentication-flow-playback"
        title="Authentication flow walkthrough"
      />,
    );

    const wrapper = getIframe().parentElement as HTMLElement;
    expect(wrapper.style.aspectRatio).toBe("1440 / 900");

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            source: "scenar-embed",
            v: 1,
            type: "resize",
            widthPx: 1440,
            heightPx: 812,
          },
          origin: "https://stigmer.ai",
          source: getIframe().contentWindow,
        } as MessageEventInit),
      );
    });

    // The reported size now governs, exactly — not merely "something else".
    expect(wrapper.style.aspectRatio).toBe("1440 / 812");
  });
});
