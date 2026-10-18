/** Read the canonical refined SVGs and derive consistent colors, crops and backgrounds. */
import { readFile } from "node:fs/promises";

/** The two brand tones: graphite ink and its light counterpart, never pure black or white. */
export const BRAND_DARK = "#1c1c1e";
export const BRAND_LIGHT = "#ededed";

/** The faces of the shaded mark, in drawing order: inner cube first, then the ring and its bars. */
export const SHADED_FACES = [
  "inner-top",
  "inner-left",
  "inner-right",
  "ring-top",
  "ring-left",
  "ring-right",
  "bars",
] as const;
export type ShadedFace = (typeof SHADED_FACES)[number];

/** Each face's tone when the shaded mark is lit for a dark or a light background. */
export const SHADED_TONES: Record<
  "dark" | "light",
  Record<ShadedFace, string>
> = {
  dark: {
    "inner-top": "#58585c",
    "inner-left": "#424245",
    "inner-right": "#2c2c2e",
    "ring-top": BRAND_LIGHT,
    "ring-left": "#c7c7ca",
    "ring-right": "#9c9ca0",
    bars: "#9c9ca0",
  },
  light: {
    "inner-top": "#dcdcde",
    "inner-left": "#c7c7ca",
    "inner-right": "#aeaeb2",
    "ring-top": "#48484b",
    "ring-left": "#333336",
    "ring-right": BRAND_DARK,
    bars: BRAND_DARK,
  },
};

type Framing = {
  size?: number;
  background?: string;
  tight?: boolean;
  rounded?: boolean;
};

/** Size, crop and back one 34-unit source the same way for the flat and the shaded mark. */
function frame(
  source: string,
  { size = 1024, background, tight = false, rounded = false }: Framing,
): string {
  const box = tight ? "3 3 28 28" : "0 0 34 34";
  const origin = tight ? 3 : 0;
  const extent = tight ? 28 : 34;
  const backdrop = background
    ? `<rect x="${origin}" y="${origin}" width="${extent}" height="${extent}" rx="${rounded ? 7 : 0}" fill="${background}"/>`
    : "";
  return source
    .replace(/width="1024" height="1024"/, `width="${size}" height="${size}"`)
    .replace('viewBox="0 0 34 34"', `viewBox="${box}"`)
    .replace("</title>", `</title>${backdrop}`);
}

/** The flat one-color mark: favicons, small sizes and anywhere a single ink is required. */
export async function brandSvg({
  color = BRAND_DARK,
  ...framing
}: Framing & { color?: string } = {}): Promise<string> {
  const source = await readFile(new URL("./logo.svg", import.meta.url), "utf8");
  return frame(source.replaceAll(BRAND_DARK, color), framing);
}

/** The default mark, lit for its background; flat artwork is reserved for tiny or single-ink uses. */
export async function brandShadedSvg({
  on = "light",
  ...framing
}: Framing & { on?: "dark" | "light" } = {}): Promise<string> {
  const source = await readFile(
    new URL("./source/shaded.svg", import.meta.url),
    "utf8",
  );
  const tones = SHADED_TONES[on];
  return frame(
    source.replace(
      /data-face="([a-z-]+)" fill="#[0-9a-f]{6}"/g,
      (_match, face: ShadedFace) => `data-face="${face}" fill="${tones[face]}"`,
    ),
    framing,
  );
}

/** Pair the unmodified mark with the approved, font-independent Instrument Sans lettering. */
export async function brandLockupSvg({
  width = 1536,
  color = BRAND_DARK,
  flat = false,
}: {
  width?: number;
  color?: string;
  flat?: boolean;
} = {}): Promise<string> {
  const mark = flat
    ? await brandSvg({ size: 96, color })
    : await brandShadedSvg({ size: 96, on: color === BRAND_LIGHT ? "dark" : "light" });
  const wordmark = await readFile(
    new URL("./source/wordmark.svg", import.meta.url),
    "utf8",
  );
  // The 96-unit mark box retains its original clear space; this offset gives
  // the lettering a visible gap of 0.38 times its 48-unit capital height.
  // Lower the lettering 7.2 units for optical centering: 3 px at a 40 px height.
  const lettering = wordmark
    .replace("<svg ", '<svg x="103.62352941176471" y="7.2" ')
    .replaceAll(BRAND_DARK, color);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${Math.round((width * 96) / 364)}" viewBox="0 0 364 96"><title>Stigmer</title>${mark}${lettering}</svg>\n`;
}
