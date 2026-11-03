/**
 * A screen of the product, as the visual suite draws it: the bare picture.
 *
 * `<ScreenImage name="asks-first" alt="…" sizes="…" />` shows one picture
 * from the suite's shown list (test/visual/src/shown.ts) by its name: never
 * a captured screenshot, so a change to the product's look reaches the page
 * in the pull request that redraws it. The size comes from the list, not the
 * file, so the page reserves its space before the picture loads, and the
 * browser picks the 1x or 2x file by the `sizes` slot it is given.
 *
 * It imports nothing from the docs' framework, so a page outside the docs
 * (the homepage) can show a picture without loading the docs' zoom; the
 * docs embed one with `<Screen>`, which wraps this in the zoom. A name the
 * list does not hold, or blank alt text, throws, so the static build fails
 * on the page that asked.
 *
 * A picture lower down a page loads lazily. `priority` is for the one that
 * is the page's largest paint (the hero's): fetched at once, first.
 */
import { cn } from "@/lib/utils";
import { screenPath, screenSrcSet, shownScreen, shownSize } from "@/lib/screens";

export interface ScreenImageProps {
  /** The shown picture's name in test/visual/src/shown.ts. */
  name: string;
  /** What the screen shows, for a reader who cannot see it. */
  alt: string;
  /** The slot the picture fills, for the browser's choice of file. */
  sizes: string;
  /** The page's largest paint: load it eagerly and ahead of other images. */
  priority?: boolean;
  className?: string;
}

export function ScreenImage({ name, alt, sizes, priority = false, className }: ScreenImageProps) {
  const shown = shownScreen(name);
  // MDX is not typechecked, so a page can leave `alt` out entirely.
  if (!alt || alt.trim() === "") {
    throw new Error(`<Screen name="${name}">: alt text is required; it is what a reader who cannot see the screen, and the markdown exports, get`);
  }
  const { width, height } = shownSize(shown);
  return (
    // A static export serves these files as converted; next/image's optimiser is off (next.config.ts).
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={screenPath(name, 1)}
      srcSet={screenSrcSet(name)}
      sizes={sizes}
      width={width}
      height={height}
      alt={alt}
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : undefined}
      decoding="async"
      className={cn("h-auto max-w-full", className)}
    />
  );
}
