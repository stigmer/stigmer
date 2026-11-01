/**
 * The job film's look: the homepage hero's palette and the brand's three
 * faces (brand/type.ts), so the film reads like the picture it retells.
 *
 * The colours are the site's dark tokens (site/src/app/globals.css) as the
 * hero's picture uses them. The faces are the site's: Instrument Sans for the
 * headline and the closing sentence, Geist for the picture's words, Geist Mono
 * for step labels and the address. They are fetched from Google Fonts at
 * render time, since the films render by hand and never in CI; the site and
 * the social card draw from the same faces vendored in brand/fonts/. The intro
 * film keeps its own theme (../../theme.ts).
 */
import { display, mono, sans } from "./fonts";

const LATIN = { subsets: ["latin" as const] };
const displayFont = display.loadFont("normal", { ...LATIN, weights: ["600", "700"] });
const sansFont = sans.loadFont("normal", { ...LATIN, weights: ["400", "500", "600"] });
const monoFont = mono.loadFont("normal", { ...LATIN, weights: ["400", "500"] });

export const LOOK = {
  /** The page's ground, and the hero's vignette over it. */
  background: "#0a0a0a",
  vignette: "radial-gradient(ellipse at 50% 30%, #111111 0%, #0a0a0a 70%)",
  /** The ground of your product's chips and of the agent's computer. */
  card: "#121212",
  /** The faint border of the other customers' computers. */
  border: "#1c1c1c",
  /** Resting borders, rules and arrows. */
  subtle: "#4f4f4f",
  /** Resting words. */
  muted: "#a3a3a3",
  /** Lit words and borders. */
  foreground: "#f5f5f5",
  /** The other customers' dimmed words. */
  dim: "#808080",
  /** The headline and the closing sentence. */
  display: displayFont.fontFamily,
  /** Every other word. */
  sans: sansFont.fontFamily,
  /** Step labels and the address. */
  mono: monoFont.fontFamily,
} as const;
