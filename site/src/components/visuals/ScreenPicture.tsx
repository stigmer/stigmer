/**
 * A screen of the product shown whole on a large screen and as a crop of
 * the same drawing on a small one, where the whole would be too small to
 * read.
 *
 * `<ScreenPicture name="in-product" narrow="in-product-panel" … />` is a
 * `<picture>`: below `CROP_BREAKPOINT` the browser fetches only the crop's
 * files, shown at no more than the crop's own width; from it, the whole
 * picture's. Both are shown pictures (test/visual/src/shown.ts), named
 * through @/lib/screens like every other, and each carries its own size, so
 * the page reserves the right space before either loads; the whole one is a
 * `ScreenImage`, which checks the name and the alt text. `srcset` alone
 * cannot do this: it picks a density, never a crop.
 *
 * Anything drawn over the picture (the hero's pins) is a child, laid over
 * the frame both crops fill, and switches crop at the same breakpoint by
 * `CROP_BREAKPOINT`'s classes.
 */
import type * as React from "react";
import { cn } from "@/lib/utils";
import { screenSrcSet, shownScreen, shownSize } from "@/lib/screens";
import { ScreenImage } from "./ScreenImage";

/**
 * Where the picture changes crop: Tailwind's `lg` (64rem). `media` is the
 * `<source>`'s, and the two classes show a layer on one side of it only,
 * so a layer never shows over the other crop.
 */
export const CROP_BREAKPOINT = {
  media: "(width < 64rem)",
  narrowOnly: "lg:hidden",
  wideOnly: "max-lg:hidden",
} as const;

export interface ScreenPictureProps {
  /** The whole picture, shown from the breakpoint up. */
  name: string;
  /** The crop of the same drawing shown below the breakpoint. */
  narrow: string;
  /** What the screen shows, for a reader who cannot see it. */
  alt: string;
  /** The slot the whole picture fills, for the browser's choice of file; the crop's slot is its own width. */
  sizes: string;
  /** The page's largest paint: load it eagerly and ahead of other images. */
  priority?: boolean;
  /** Layers drawn over the picture. */
  children?: React.ReactNode;
  className?: string;
}

export function ScreenPicture({ name, narrow, alt, sizes, priority = false, children, className }: ScreenPictureProps) {
  const crop = shownSize(shownScreen(narrow));
  const style = { "--crop-width": `${crop.width}px` } as React.CSSProperties;
  return (
    <div className={cn("relative mx-auto w-full max-lg:max-w-(--crop-width)", className)} style={style}>
      <picture>
        <source media={CROP_BREAKPOINT.media} srcSet={screenSrcSet(narrow)} sizes={`${crop.width}px`} width={crop.width} height={crop.height} />
        <ScreenImage name={name} alt={alt} sizes={sizes} priority={priority} className="block w-full" />
      </picture>
      {children}
    </div>
  );
}
