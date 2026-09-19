"use client";

/**
 * The mark of a marketplace source: the GitHub avatar of the account that
 * publishes it. One rule for every source, the official catalogue included
 * (it is published from `github.com/stigmer`), so the SDK carries no vendor
 * artwork and a repository a user adds gets its mark for free.
 *
 * The image is decorative beside the source's name: `alt=""`, and when the
 * browser cannot load it (offline, blocked) the mark hides rather than
 * showing a broken-image glyph. No referrer leaves the console for it.
 */

import { useState } from "react";
import { cn } from "@stigmer/theme";

import { githubAvatarUrl, githubOwner } from "./sources/github.js";
import { OFFICIAL_PUBLISHER } from "./sources/official.js";
import type { MarketplaceSource } from "./sources/types.js";

/** Props for {@link SourceMark}. */
export interface SourceMarkProps {
  readonly source: MarketplaceSource;
  /** `sm` for a chip or a card footer, `md` for a list row. @default "sm" */
  readonly size?: "sm" | "md";
  readonly className?: string;
}

const SIZE_CLASSES = { sm: "stg:size-4", md: "stg:size-6" } as const;
const SIZE_PIXELS = { sm: 32, md: 48 } as const;

/** The GitHub account that publishes `source`. */
export function publisherOf(source: MarketplaceSource): string {
  switch (source.type) {
    case "official":
      return OFFICIAL_PUBLISHER;
    case "github":
      return githubOwner(source.repo);
    default: {
      const exhaustive: never = source;
      return exhaustive;
    }
  }
}

export function SourceMark({ source, size = "sm", className }: SourceMarkProps) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <img
      src={githubAvatarUrl(publisherOf(source), SIZE_PIXELS[size])}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={cn("stg:shrink-0 stg:rounded-sm stg:bg-muted stg:object-cover", SIZE_CLASSES[size], className)}
    />
  );
}
