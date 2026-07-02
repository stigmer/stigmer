"use client";

import { ScenarEmbed as ScenarEmbedBase } from "@scenar/embed/react";

/** Base URL of the published bundles on GitHub Pages: `<origin>/<repo>`. */
const EMBED_BASE = "https://stigmer.github.io/stigmer-demos";

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
 * Embed a hosted Scenar product tour in the docs.
 *
 * This is now a thin slug → URL adapter over `@scenar/embed`'s official React
 * component: the iframe creation, strict postMessage bridge, host-theme sync, and
 * resize-to-fit all live in `@scenar/embed` (built on `@scenar/core`'s embed host
 * controller), so the docs no longer hand-mirror the protocol or its layout glue.
 * Tours are authored in the `stigmer-demos` repo, packed, and published to GitHub
 * Pages; this component only frames one by id.
 */
export function ScenarEmbed({ id, title }: ScenarEmbedProps) {
  return (
    <ScenarEmbedBase
      id={id}
      base={EMBED_BASE}
      title={title}
      className="not-prose relative mx-auto my-4 w-full max-w-4xl rounded-lg"
    />
  );
}
