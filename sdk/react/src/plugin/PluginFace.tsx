"use client";

/**
 * A plugin's face on a card: its own logo when the manifest names one the
 * tree can show, a monogram tile otherwise.
 *
 * Every card gets a face, because a grid of text-only cards reads as a
 * list. Claude Code's plugins, the official catalogue's and a few of
 * Cursor's declare no logo, so the fallback is designed, not incidental: a
 * `muted` tile with the first letter of the display name in `foreground`
 * (a pair the theme contract guarantees legible) and a ring in one of the
 * five categorical chart tokens, chosen by a hash of the plugin's name so
 * the same plugin wears the same colour on every visit. The letter never
 * sits on a chart colour directly: those tokens have no foreground pair
 * and their lightness differs between presets.
 *
 * The logo loads as the browser loads any image, at the commit or version
 * the tree was read at, with no referrer; a logo that fails to load falls
 * back to the monogram rather than a broken-image glyph.
 */

import { useState } from "react";
import { cn } from "@stigmer/theme";

/** Props for {@link PluginFace}. */
export interface PluginFaceProps {
  /** The install name; the hash key for the monogram's colour, so a display-name edit does not recolour it. */
  readonly name: string;
  /** The name for people; its first letter is the monogram. */
  readonly displayName: string;
  /** The logo's URL, or `null` for the monogram. */
  readonly logoUrl: string | null;
  readonly className?: string;
}

/** The five categorical chart tokens, the SDK's palette for "one colour per thing". */
const RING_CLASSES = [
  "stg:border-chart-1",
  "stg:border-chart-2",
  "stg:border-chart-3",
  "stg:border-chart-4",
  "stg:border-chart-5",
] as const;

/** A stable small hash: the same name, the same colour, across visits and clients. */
export function monogramRing(name: string): (typeof RING_CLASSES)[number] {
  let hash = 0;
  for (let index = 0; index < name.length; index++) {
    hash = (hash * 31 + name.charCodeAt(index)) | 0;
  }
  return RING_CLASSES[Math.abs(hash) % RING_CLASSES.length] ?? RING_CLASSES[0];
}

const TILE = "stg:flex stg:size-10 stg:shrink-0 stg:items-center stg:justify-center stg:overflow-hidden stg:rounded-lg";

export function PluginFace({ name, displayName, logoUrl, className }: PluginFaceProps) {
  const [failed, setFailed] = useState(false);
  if (logoUrl !== null && !failed) {
    return (
      <span className={cn(TILE, "stg:bg-muted", className)}>
        <img
          src={logoUrl}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          className="stg:size-full stg:object-contain"
        />
      </span>
    );
  }
  const initial = (displayName.trim() || name).charAt(0).toUpperCase();
  return (
    <span
      aria-hidden="true"
      data-monogram={initial}
      className={cn(TILE, "stg:border-2 stg:bg-muted stg:text-base stg:font-semibold stg:text-foreground", monogramRing(name), className)}
    >
      {initial}
    </span>
  );
}
