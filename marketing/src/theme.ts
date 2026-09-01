/**
 * Brand tokens for marketing films. Kept deliberately tiny: films should read
 * like the website (site/), not invent a second brand.
 */
export const theme = {
  colors: {
    ink: "#0b0d10",
    paper: "#ffffff",
    accent: "#6c5ce7",
    muted: "#8a93a6",
  },
  fonts: {
    // Same stack the site leans on; self-hosted fonts can replace this when
    // the visual polish pass lands.
    sans: "'Inter', 'Helvetica Neue', Helvetica, Arial, sans-serif",
    mono: "'JetBrains Mono', 'SF Mono', Menlo, monospace",
  },
} as const;
