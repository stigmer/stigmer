// ---------------------------------------------------------------------------
// fonts — the console's typefaces, self-hosted from this folder
//
// Each loader defines one `--font-*` variable that the theme's font stacks
// fall back through (`sdk/theme/src/tokens.css` for Geist, the corporate,
// friendly and fintech presets for the rest), so the variable names are a
// contract with `@stigmer/theme` and never change here alone. Only the
// default stack (Geist, Geist Mono) is preloaded; a preset's family downloads
// when that preset is active.
//
// The files are vendored rather than fetched through `next/font/google`
// because that loader downloads from Google during `next build` and
// `next dev`, and a failed fetch turned every lane that builds the console
// red (stigmer#1508). Nothing here needs the network.
//
// `next/font/local` emits one face per file and cannot give files their own
// `unicode-range`, so every file is the family's full character set, not
// one of Google's per-script subsets: text in any script the family covers
// renders in it.
//
// Provenance (every family SIL OFL 1.1; each licence is the OFL-*.txt
// beside its files):
//   Geist-Variable.woff2       google/fonts@9710da1e ofl/geist/Geist[wght].ttf, v1.800
//   GeistMono-Variable.woff2   google/fonts@9710da1e ofl/geistmono/GeistMono[wght].ttf, v1.701
//   Inter-Variable.woff2       google/fonts@9710da1e ofl/inter/Inter[opsz,wght].ttf, v4.001,
//                              opsz pinned at 14 (the instance Google serves when no
//                              optical size is requested)
//   Nunito-Variable.woff2      google/fonts@9710da1e ofl/nunito/Nunito[wght].ttf, v3.602
//   IBMPlexSans-*.woff2        npm @ibm/plex-sans@1.1.0 fonts/complete/woff2, v3.005, unmodified
//   IBMPlexMono-*.woff2        npm @ibm/plex-mono@2.5.0 fonts/complete/woff2, v2.005, unmodified
// The google/fonts sources were converted with fontTools 4.66.1
// (`fonttools varLib.instancer <ttf> opsz=14` for Inter, then
// `TTFont(ttf).flavor = "woff2"`). IBM Plex is taken as IBM publishes it: its
// licence reserves the name "Plex", and the OFL counts a change of format as
// a modified version, which may not carry that name.
// ---------------------------------------------------------------------------

import localFont from "next/font/local";

export const geistSans = localFont({
  src: "./Geist-Variable.woff2",
  variable: "--font-geist-sans",
  weight: "100 900",
});

export const geistMono = localFont({
  src: "./GeistMono-Variable.woff2",
  variable: "--font-geist-mono",
  weight: "100 900",
});

export const inter = localFont({
  src: "./Inter-Variable.woff2",
  variable: "--font-inter",
  weight: "100 900",
  preload: false,
});

export const nunito = localFont({
  src: "./Nunito-Variable.woff2",
  variable: "--font-nunito",
  weight: "200 1000",
  preload: false,
});

export const ibmPlexSans = localFont({
  src: [
    { path: "./IBMPlexSans-Light.woff2", weight: "300", style: "normal" },
    { path: "./IBMPlexSans-Regular.woff2", weight: "400", style: "normal" },
    { path: "./IBMPlexSans-Medium.woff2", weight: "500", style: "normal" },
    { path: "./IBMPlexSans-SemiBold.woff2", weight: "600", style: "normal" },
    { path: "./IBMPlexSans-Bold.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-ibm-plex-sans",
  preload: false,
});

export const ibmPlexMono = localFont({
  src: [
    { path: "./IBMPlexMono-Regular.woff2", weight: "400", style: "normal" },
    { path: "./IBMPlexMono-Medium.woff2", weight: "500", style: "normal" },
  ],
  variable: "--font-ibm-plex-mono",
  preload: false,
});

/** Every loader, in the order `RootLayout` applies their variables. */
export const consoleFonts = [
  geistSans,
  geistMono,
  inter,
  nunito,
  ibmPlexSans,
  ibmPlexMono,
] as const;
