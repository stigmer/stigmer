"use client";

import { ScenarEmbed as ScenarEmbedBase } from "@scenar/embed/react";

/**
 * Base URL of the hosted tour bundles. Tours are authored in this repo's
 * `demos/` workspace and packed + deployed by the website release workflow,
 * so the embeds ship atomically with the docs pages that frame them.
 *
 * Defaults to production — absolute (not a relative `/demos`) so local docs
 * dev shows the released tours instead of 404ing against the dev server.
 * `NEXT_PUBLIC_SCENAR_EMBED_BASE` overrides it for the authoring loop: point
 * it at a local `scenar serve` origin to see an unreleased tour (or an
 * unreleased engine version) on its real docs page before it deploys. See
 * `demos/README.md` for the loop. Resolved per render, not at module scope:
 * Next.js inlines the env read at build time either way, and a runtime read
 * is what lets tests exercise the override.
 */
function resolveEmbedBase(): string {
  return process.env.NEXT_PUBLIC_SCENAR_EMBED_BASE ?? "https://stigmer.ai/demos";
}

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
 * component: the iframe creation, strict postMessage bridge, host-theme sync, and
 * resize-to-fit all live in `@scenar/embed` (built on `@scenar/core`'s embed host
 * controller), so the docs no longer hand-mirror the protocol or its layout glue.
 * Tours are authored in this repo's `demos/` workspace and deployed with the
 * website release; this component only frames one by id.
 */
export function ScenarEmbed({ id, title }: ScenarEmbedProps) {
  return (
    <ScenarEmbedBase
      id={id}
      base={resolveEmbedBase()}
      title={title}
      className="not-prose relative mx-auto my-4 w-full max-w-4xl rounded-lg"
      // The tours' recorded viewport is 1280x800 (16:10 — demos'
      // pack-all.mjs), but @scenar/embed's pre-handshake baseline is its own
      // 896x480 default; pinning the real ratio here removes the layout jump
      // between first paint and the embed's resize handshake.
      style={{ aspectRatio: "1280 / 800" }}
    />
  );
}
