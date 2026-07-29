"use client";

import { ScenarEmbed as ScenarEmbedBase } from "@scenar/embed/react";
import { resolveDemosBase } from "@/lib/demos-base";

interface ScenarEmbedProps {
  /**
   * The published tour slug — the scenario id under `demos/tours/` (e.g.
   * `authentication-flow-playback`). Resolves to `<base>/<id>/` —
   * `https://stigmer.ai/demos/<id>/` by default.
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
 * component: the iframe creation, strict postMessage bridge, and resize-to-fit
 * all live in `@scenar/embed` (built on `@scenar/core`'s embed host
 * controller), so the docs no longer hand-mirror the protocol or its layout glue.
 * Tours are authored in this repo's `demos/` workspace and deployed with the
 * website release; this component only frames one by id.
 *
 * Tours are pinned to the light theme: the docs site is dark-only, and media
 * renders as bright content on the dark canvas (the same convention the
 * markdown exports follow — see `llms-pages.ts`, which links light stills).
 * Pinning also keeps `@scenar/embed` from installing its host-theme observer,
 * whose re-theme path reloads the iframe.
 */
export function ScenarEmbed({ id, title }: ScenarEmbedProps) {
  return (
    <ScenarEmbedBase
      id={id}
      base={resolveDemosBase()}
      title={title}
      theme="light"
      className="not-prose relative mx-auto my-4 w-full max-w-4xl rounded-lg"
      // The tours' recorded viewport is 1280x800 (16:10 — demos'
      // pack-all.mjs), but @scenar/embed's pre-handshake baseline is its own
      // 896x480 default; pinning the real ratio here removes the layout jump
      // between first paint and the embed's resize handshake.
      style={{ aspectRatio: "1280 / 800" }}
    />
  );
}
