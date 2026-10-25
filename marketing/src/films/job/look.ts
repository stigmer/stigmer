/**
 * The job film's look: the homepage hero's palette and the site's two fonts,
 * so the film reads like the picture it retells.
 *
 * The colours are the site's dark tokens (site/src/app/globals.css) as the
 * hero's picture uses them; the fonts are the ones site/src/app/layout.tsx
 * loads, fetched at render time as the site's build fetches them. The intro
 * film keeps its own theme (../../theme.ts).
 */
import { loadFont as loadDmMono } from "@remotion/google-fonts/DMMono";
import { loadFont as loadInstrumentSans } from "@remotion/google-fonts/InstrumentSans";

const sans = loadInstrumentSans("normal", { weights: ["400", "500", "600", "700"], subsets: ["latin"] });
const mono = loadDmMono("normal", { weights: ["400", "500"], subsets: ["latin"] });

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
  sans: sans.fontFamily,
  mono: mono.fontFamily,
} as const;
