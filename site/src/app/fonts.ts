// ---------------------------------------------------------------------------
// fonts — the site's three faces, self-hosted from brand/fonts/
//
// The brand's type (brand/type.ts): Instrument Sans for display (page titles,
// section headlines, the closing line, the header's name), Geist and Geist
// Mono for everything else. Each loader defines one `--font-*` variable;
// globals.css builds Tailwind's `--font-sans`, `--font-mono` and
// `--font-display` from them, and the layout puts them on `<html>`.
//
// The Geist variable names are the product theme's contract
// (`sdk/theme/src/tokens.css` falls back through `--font-geist-sans` and
// `--font-geist-mono`), so the product components the site shows resolve to
// Geist too, as they do in the console.
//
// The files are vendored rather than fetched through `next/font/google`,
// because that loader downloads from Google during `next build` and a failed
// fetch turns the build red (stigmer#1508, the console's reason). They live
// in brand/fonts/, which the site's lanes already watch, beside the social
// card that draws from the same files. `next/font/local` resolves `src`
// through the bundler, so a path outside site/ is fine; it needs literal
// options, so the file names are written here and app/__tests__/fonts.test.ts
// holds them equal to brand/type.ts.
//
// Every file is the family's full character set: `→`, box-drawing in CLI
// output and accented names render in the face, not a fallback.
// ---------------------------------------------------------------------------

import localFont from "next/font/local";

export const geistSans = localFont({
  src: "../../../brand/fonts/Geist-Variable.woff2",
  variable: "--font-geist-sans",
  weight: "100 900",
});

export const geistMono = localFont({
  src: "../../../brand/fonts/GeistMono-Variable.woff2",
  variable: "--font-geist-mono",
  weight: "100 900",
  // Never the first text a visitor reads; it swaps in.
  preload: false,
});

export const instrumentSans = localFont({
  src: "../../../brand/fonts/InstrumentSans-Variable.woff2",
  variable: "--font-instrument-sans",
  weight: "400 700",
});

/** Every loader, in the order `RootLayout` applies their variables. */
export const siteFonts = [geistSans, geistMono, instrumentSans] as const;

/** The class list that defines every loader's variable, for `<html>`. */
export const fontVariables = siteFonts.map((font) => font.variable).join(" ");
