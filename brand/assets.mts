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
