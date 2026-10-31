/**
 * A screen of the product in the docs, as the visual suite draws it.
 *
 * `<Screen name="approval" alt="…" />` shows one picture from the suite's
 * shown list (test/visual/src/shown.ts) by its name, through `ScreenImage`,
 * and opens it larger on a click (fumadocs' `ImageZoom`, on the sharpest
 * file). A page outside the docs that wants the bare picture uses
 * `ScreenImage`, which leaves the zoom out of its bundle. A name the list
 * does not hold, or blank alt text, throws, so the static build fails on the
 * page that asked. The alt text is also what the markdown exports carry in
 * the picture's place (`cleanContent` in src/lib/llms-pages.ts).
 */
import { ImageZoom } from "fumadocs-ui/components/image-zoom";
import { SHOWN_SCALE, screenPath } from "@/lib/screens";
import { ScreenImage } from "./ScreenImage";

/** The slot a docs image gets in the page, as fumadocs' own `ImageZoom` declares it. */
export const DOCS_IMAGE_SIZES = "(max-width: 768px) 100vw, (max-width: 1200px) 70vw, 900px";

export interface ScreenProps {
  /** The shown picture's name in test/visual/src/shown.ts. */
  name: string;
  /** What the screen shows, for a reader who cannot see it; the markdown exports carry it too. */
  alt: string;
  /** The slot the picture fills, for the browser's choice of file; the docs column by default. */
  sizes?: string;
  className?: string;
}

export function Screen({ name, alt, sizes = DOCS_IMAGE_SIZES, className }: ScreenProps) {
  return (
    <ImageZoom alt={alt} zoomInProps={{ src: screenPath(name, SHOWN_SCALE), alt }}>
      <ScreenImage name={name} alt={alt} sizes={sizes} className={className} />
    </ImageZoom>
  );
}
