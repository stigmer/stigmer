/**
 * The job film's three faces, the brand's (brand/type.ts): Instrument Sans
 * for display, Geist and Geist Mono for every other word.
 *
 * Each module names its family and loads nothing until `loadFont` is called,
 * so the film's test reads the families here and holds them to brand/type.ts
 * in Node, where a font load (a browser `FontFace`) cannot run; `look.ts`
 * loads them from these same modules.
 */
export * as display from "@remotion/google-fonts/InstrumentSans";
export * as sans from "@remotion/google-fonts/Geist";
export * as mono from "@remotion/google-fonts/GeistMono";
