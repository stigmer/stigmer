import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act, waitFor, cleanup } from "@testing-library/react";
import { ScenarEmbed } from "../scenar-embed";

/**
 * The docs `ScenarEmbed` is now a thin slug → URL adapter over `@scenar/embed`'s
 * official React component, so these tests cover only what this wrapper owns: the
 * id → published-URL mapping (production default + the authoring-loop env
 * override), the a11y title, host-theme sync, and the responsive box. The strict
 * postMessage validation, resize-to-fit, and multi-instance isolation are covered
 * by `@scenar/embed`'s own suite.
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
  it("frames the published tour by id with a themed src (dark)", () => {
    document.documentElement.classList.add("dark");
    render(
      <ScenarEmbed
        id="authentication-flow-playback"
        title="Authentication flow walkthrough"
      />,
    );

    expect(getIframe().getAttribute("src")).toBe(
      "https://stigmer.ai/demos/authentication-flow-playback/?theme=dark",
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

  it("syncs the theme to the light docs theme", () => {
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

  it("reacts to a live theme toggle on <html>", async () => {
    render(
      <ScenarEmbed
        id="authentication-flow-playback"
        title="Authentication flow walkthrough"
      />,
    );
    expect(getIframe().getAttribute("src")).toContain("?theme=light");

    act(() => {
      document.documentElement.classList.add("dark");
    });
    await waitFor(() =>
      expect(getIframe().getAttribute("src")).toContain("?theme=dark"),
    );

    act(() => {
      document.documentElement.classList.remove("dark");
    });
    await waitFor(() =>
      expect(getIframe().getAttribute("src")).toContain("?theme=light"),
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
    // 1280x800, 16:10 — DD-008), pinned here so first paint matches the
    // embed's post-handshake size with no layout jump.
    expect(wrapper.style.aspectRatio).toBe("1280 / 800");
  });
});
