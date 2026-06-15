"use client";

import { useEffect, useState } from "react";

/**
 * Origin that serves the published Scenar tours. Used both to build the iframe
 * `src` and to validate inbound `postMessage` events — a path-less origin, since
 * `MessageEvent.origin` never carries a path.
 */
const EMBED_ORIGIN = "https://stigmer.github.io";

/** Base URL of the published bundles: `<origin>/<repo>`. */
const EMBED_BASE = `${EMBED_ORIGIN}/stigmer-demos`;

/**
 * The Scenar embed postMessage envelope (protocol v1). Mirrored here rather than
 * imported so the docs carry **zero** `@scenar/*` dependencies — the whole point
 * of the migration is that hosting a tour costs the docs nothing but an iframe.
 * Keep in lockstep with `SCENAR_EMBED_SOURCE` / `SCENAR_EMBED_PROTOCOL_VERSION`
 * in `@scenar/core`'s embed protocol.
 */
const SCENAR_EMBED_SOURCE = "scenar-embed";
const SCENAR_EMBED_PROTOCOL_VERSION = 1;

/** The tour's recorded canonical viewport, used as the pre-handshake baseline. */
const BASE_WIDTH = 896;
const BASE_HEIGHT = 480;

interface ScenarEmbedProps {
  /**
   * The published tour slug — the scenario id under `stigmer-demos` (e.g.
   * `authentication-flow-playback`). Resolves to
   * `https://stigmer.github.io/stigmer-demos/<id>/`.
   */
  id: string;
  /**
   * Accessible iframe title. Defaults to a generic label; pass a specific one
   * (e.g. "Authentication flow walkthrough") for better screen-reader context.
   */
  title?: string;
}

/**
 * Embed a hosted Scenar product tour as a responsive, theme-synced iframe.
 *
 * The tour is authored in the `stigmer-demos` repo, packed to a static bundle,
 * and published to GitHub Pages; this component only frames it. It carries no
 * `@scenar/*` imports, so the docs stay decoupled from the player runtime.
 *
 * Theme: the embed reads `?theme` from its URL, so we sync it to the docs page
 * theme by tracking the `dark` class on `<html>` (the same approach as the
 * sibling `Mermaid` renderer — robust across hydration and independent of
 * next-themes' resolution timing). Toggling the docs theme reloads the iframe in
 * the new palette — acceptable for an autoplay demo.
 *
 * Sizing: an `aspect-ratio` box (896×480) is the stable baseline; the embed then
 * reports its exact rendered size over the documented `resize` postMessage, and
 * we adopt that ratio so caption chrome below the shell is never clipped. The
 * listener is strict — it ignores any message whose origin, source tag, protocol
 * version, type, or payload shape does not match — so a hostile or unrelated
 * frame on the page can never drive our layout.
 */
export function ScenarEmbed({ id, title }: ScenarEmbedProps) {
  // Default to dark: the SSR/first-client render ships dark, so initializing here
  // keeps `src` stable across hydration (no mismatch warning); the effect below
  // corrects to the real theme and tracks subsequent toggles.
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const src = `${EMBED_BASE}/${id}/?theme=${theme}`;

  // The CSS aspect ratio of the frame, refined from the embed's resize report.
  const [ratio, setRatio] = useState(`${BASE_WIDTH} / ${BASE_HEIGHT}`);

  useEffect(() => {
    const html = document.documentElement;
    const sync = () =>
      setTheme(html.classList.contains("dark") ? "dark" : "light");

    sync();
    const observer = new MutationObserver(sync);
    observer.observe(html, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      // Strict origin + envelope validation: the global message channel is
      // shared with the host and every other widget, so trust nothing that
      // does not exactly match the Scenar embed contract from our origin.
      if (event.origin !== EMBED_ORIGIN) return;

      const data = event.data;
      if (
        typeof data !== "object" ||
        data === null ||
        data.source !== SCENAR_EMBED_SOURCE ||
        data.v !== SCENAR_EMBED_PROTOCOL_VERSION ||
        data.type !== "resize"
      ) {
        return;
      }

      const { widthPx, heightPx } = data as {
        widthPx: unknown;
        heightPx: unknown;
      };
      if (
        typeof widthPx !== "number" ||
        typeof heightPx !== "number" ||
        widthPx <= 0 ||
        heightPx <= 0
      ) {
        return;
      }

      setRatio(`${widthPx} / ${heightPx}`);
    }

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  return (
    <div
      className="not-prose relative mx-auto my-4 w-full max-w-4xl"
      style={{ aspectRatio: ratio }}
    >
      <iframe
        src={src}
        title={title ?? "Interactive product tour"}
        loading="lazy"
        allow="autoplay; fullscreen"
        allowFullScreen
        className="absolute inset-0 h-full w-full rounded-lg border-0"
      />
    </div>
  );
}
