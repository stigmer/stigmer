/** Read the canonical refined SVG and derive consistent colors, crops and backgrounds. */
import { readFile } from "node:fs/promises";

export async function brandSvg({
  size = 1024,
  color = "#0a0a0a",
  background,
  tight = false,
  rounded = false,
}: {
  size?: number;
  color?: string;
  background?: string;
  tight?: boolean;
  rounded?: boolean;
} = {}): Promise<string> {
  const source = await readFile(new URL("./logo.svg", import.meta.url), "utf8");
  const box = tight ? "3 3 28 28" : "0 0 34 34";
  const origin = tight ? 3 : 0;
  const extent = tight ? 28 : 34;
  const backdrop = background
    ? `<rect x="${origin}" y="${origin}" width="${extent}" height="${extent}" rx="${rounded ? 7 : 0}" fill="${background}"/>`
    : "";
  return source
    .replace(/width="1024" height="1024"/, `width="${size}" height="${size}"`)
    .replace('viewBox="0 0 34 34"', `viewBox="${box}"`)
    .replaceAll("#0a0a0a", color)
    .replace("</title>", `</title>${backdrop}`);
}

/** Pair the unmodified mark with the approved, font-independent Instrument Sans lettering. */
export async function brandLockupSvg({
  width = 1536,
  color = "#0a0a0a",
}: {
  width?: number;
  color?: string;
} = {}): Promise<string> {
  const mark = await brandSvg({ size: 96, color });
  const wordmark = await readFile(
    new URL("./source/wordmark.svg", import.meta.url),
    "utf8",
  );
  // The 96-unit mark box retains its original clear space; this offset gives
  // the lettering a visible gap of 0.38 times its 48-unit capital height.
  // Lower the lettering 2.4 units for optical centering: 1 px at a 40 px height.
  const lettering = wordmark
    .replace("<svg ", '<svg x="103.62352941176471" y="2.4" ')
    .replaceAll("#0a0a0a", color);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${Math.round((width * 96) / 364)}" viewBox="0 0 364 96"><title>Stigmer</title>${mark}${lettering}</svg>\n`;
}
