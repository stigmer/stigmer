import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, act, waitFor, cleanup } from "@testing-library/react";
import { ScenarEmbed } from "../scenar-embed";

const EMBED_ORIGIN = "https://stigmer.github.io";

/** Build a framed Scenar embed resize message (protocol v1). */
function resizeMessage(widthPx: unknown, heightPx: unknown) {
  return { source: "scenar-embed", v: 1, type: "resize", widthPx, heightPx };
}

/** Dispatch a window `message` event from a given origin, flushed in act(). */
function postFromOrigin(data: unknown, origin: string) {
  act(() => {
    window.dispatchEvent(new MessageEvent("message", { data, origin }));
  });
}

function getIframe(): HTMLIFrameElement {
  return screen.getByTitle("Authentication flow walkthrough") as HTMLIFrameElement;
}

beforeEach(() => {
  document.documentElement.className = "";
});

afterEach(() => {
  cleanup();
});

describe("ScenarEmbed", () => {
  it("frames the published tour by id with a themed src", () => {
    document.documentElement.classList.add("dark");
    render(
      <ScenarEmbed
        id="authentication-flow-playback"
        title="Authentication flow walkthrough"
      />,
    );

    const iframe = getIframe();
    expect(iframe.getAttribute("src")).toBe(
      "https://stigmer.github.io/stigmer-demos/authentication-flow-playback/?theme=dark",
    );
  });

  it("syncs the theme to the light docs theme", () => {
    // No `dark` class on <html> → light.
    render(
      <ScenarEmbed
        id="authentication-flow-playback"
        title="Authentication flow walkthrough"
      />,
    );

    expect(getIframe().getAttribute("src")).toBe(
      "https://stigmer.github.io/stigmer-demos/authentication-flow-playback/?theme=light",
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
    expect(
      screen.getByTitle("Interactive product tour"),
    ).toBeTruthy();
  });

  it("uses the recorded aspect-ratio baseline before any resize", () => {
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
    expect(wrapper.style.aspectRatio).toBe("896 / 480");
  });

  it("adopts the exact ratio from a valid same-origin resize message", () => {
    render(
      <ScenarEmbed
        id="authentication-flow-playback"
        title="Authentication flow walkthrough"
      />,
    );
    const wrapper = getIframe().parentElement as HTMLElement;

    postFromOrigin(resizeMessage(900, 520), EMBED_ORIGIN);

    expect(wrapper.style.aspectRatio).toBe("900 / 520");
  });

  describe("ignores messages that do not match the embed contract", () => {
    let wrapper: HTMLElement;

    beforeEach(() => {
      render(
        <ScenarEmbed
          id="authentication-flow-playback"
          title="Authentication flow walkthrough"
        />,
      );
      wrapper = getIframe().parentElement as HTMLElement;
    });

    it("rejects a spoofed origin", () => {
      postFromOrigin(resizeMessage(900, 520), "https://evil.example");
      expect(wrapper.style.aspectRatio).toBe("896 / 480");
    });

    it("rejects a foreign source tag", () => {
      postFromOrigin(
        { source: "other-widget", v: 1, type: "resize", widthPx: 900, heightPx: 520 },
        EMBED_ORIGIN,
      );
      expect(wrapper.style.aspectRatio).toBe("896 / 480");
    });

    it("rejects a mismatched protocol version", () => {
      postFromOrigin(
        { source: "scenar-embed", v: 999, type: "resize", widthPx: 900, heightPx: 520 },
        EMBED_ORIGIN,
      );
      expect(wrapper.style.aspectRatio).toBe("896 / 480");
    });

    it("rejects a non-resize event type", () => {
      postFromOrigin(
        { source: "scenar-embed", v: 1, type: "stepchange", widthPx: 900, heightPx: 520 },
        EMBED_ORIGIN,
      );
      expect(wrapper.style.aspectRatio).toBe("896 / 480");
    });

    it("rejects a malformed payload", () => {
      postFromOrigin(resizeMessage("huge", 520), EMBED_ORIGIN);
      postFromOrigin(resizeMessage(900, 0), EMBED_ORIGIN);
      postFromOrigin("not-an-object", EMBED_ORIGIN);
      expect(wrapper.style.aspectRatio).toBe("896 / 480");
    });
  });
});
