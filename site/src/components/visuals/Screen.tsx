/**
 * A screen of the product, as the visual suite draws it.
 *
 * `<Screen name="approval" alt="…" />` shows one picture from the suite's
 * shown list (test/visual/src/shown.ts) by its name: never a captured
 * screenshot, so a change to the product's look reaches the page in the
 * pull request that redraws it. The size comes from the list, not the file,
 * so the page reserves its space before the picture loads, and the browser
 * picks the 1x or 2x file by the space it gets.
 *
 * In the docs it opens larger on a click (fumadocs' `ImageZoom`, on the
 * sharpest file); `zoom={false}` gives a page the bare picture. A name the
 * list does not hold, or blank alt text, throws, so the static build fails
 * on the page that asked. The alt text is also what the markdown exports
 * carry in the picture's place (`cleanContent` in src/lib/llms-pages.ts).
 */
import { ImageZoom } from "fumadocs-ui/components/image-zoom";
import { cn } from "@/lib/utils";
import { SCREEN_DENSITIES, SHOWN_SCALE, screenPath, shownScreen, shownSize } from "@/lib/screens";

/** The slot a docs image gets in the page, as fumadocs' own `ImageZoom` declares it. */
export const DOCS_IMAGE_SIZES = "(max-width: 768px) 100vw, (max-width: 1200px) 70vw, 900px";

export interface ScreenProps {
  /** The shown picture's name in test/visual/src/shown.ts. */
  name: string;
  /** What the screen shows, for a reader who cannot see it; the markdown exports carry it too. */
  alt: string;
  /** The slot the picture fills, for the browser's choice of file; the docs column by default. */
  sizes?: string;
  /** Whether a click opens it larger; the docs' default. */
  zoom?: boolean;
  className?: string;
}

export function Screen({ name, alt, sizes = DOCS_IMAGE_SIZES, zoom = true, className }: ScreenProps) {
  const shown = shownScreen(name);
  if (alt.trim() === "") {
    throw new Error(`<Screen name="${name}">: alt text is required; it is what a reader who cannot see the screen, and the markdown exports, get`);
  }
  const { width, height } = shownSize(shown);
  const srcSet = SCREEN_DENSITIES.map((density) => `${screenPath(name, density)} ${width * density}w`).join(", ");
  const picture = (
    // A static export serves these files as converted; next/image's optimiser is off (next.config.ts).
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={screenPath(name, 1)}
      srcSet={srcSet}
      sizes={sizes}
      width={width}
      height={height}
      alt={alt}
      loading="lazy"
      decoding="async"
      className={cn("h-auto max-w-full", className)}
    />
  );
  if (!zoom) return picture;
  return (
    <ImageZoom alt={alt} zoomInProps={{ src: screenPath(name, SHOWN_SCALE), alt }}>
      {picture}
    </ImageZoom>
  );
}
