"use client";

import { useCallback, useState } from "react";
import type { ScenarEmbedEvent } from "@scenar/core";
import { ScenarEmbed as ScenarEmbedBase } from "@scenar/embed/react";
import { resolveDemosBase } from "@/lib/demos-base";

/**
 * The tours' canonical viewport, mirrored from `demos/scripts/pack-all.mjs`
 * (PACK_FLAGS) and held in lockstep by the verify gate's canonical-viewport
 * invariant — a drifted pin letterboxes every embed on the page.
 */
const CANONICAL_VIEWPORT = { width: 1440, height: 900 } as const;

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
  // The aspect-ratio pin is strictly a pre-handshake baseline. The base
  // component's wrapper spreads host `style` last, so a pin passed for the
  // embed's whole lifetime would permanently override the resize handshake —
  // and letterbox the tour whenever the pin and the packed viewport disagree.
  // Dropping the pin on the first `resize` event hands sizing back to the
  // embed's own reported ratio, making the pin's only job removing the layout
  // jump between first paint and the handshake.
  const [handshaken, setHandshaken] = useState(false);
  const handleEvent = useCallback((event: ScenarEmbedEvent) => {
    if (event.type === "resize") setHandshaken(true);
  }, []);

  return (
    <ScenarEmbedBase
      id={id}
      base={resolveDemosBase()}
      title={title}
      theme="light"
      onEvent={handleEvent}
      className="not-prose relative mx-auto my-4 w-full max-w-4xl rounded-lg"
      style={
        handshaken
          ? undefined
          : { aspectRatio: `${CANONICAL_VIEWPORT.width} / ${CANONICAL_VIEWPORT.height}` }
      }
    />
  );
}
