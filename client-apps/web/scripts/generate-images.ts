/** Generate theme-aware web icons directly from the refined brand source at each target size. */
import sharp from "sharp";
import pngToIco from "png-to-ico";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { brandSvg } from "../../../brand/assets.mjs";

async function main(): Promise<void> {
  const publicDir = path.join(process.cwd(), "public");
  for (const theme of ["light", "dark"] as const) {
    const options = {
      color: theme === "dark" ? "#fefefe" : "#0a0a0a",
      background: theme === "dark" ? "#0a0a0a" : "#f1f1f1",
    };
    await fs.writeFile(
      path.join(publicDir, `favicon-${theme}.svg`),
      await brandSvg({ ...options, size: 32, tight: true }),
    );
    const pngs: Buffer[] = [];
    for (const size of [16, 32]) {
      const buffer = await sharp(
        Buffer.from(await brandSvg({ ...options, size, tight: true })),
      )
        .png()
        .toBuffer();
      await fs.writeFile(
        path.join(publicDir, `favicon-${theme}-${size}x${size}.png`),
        buffer,
      );
      pngs.push(buffer);
    }
    await fs.writeFile(
      path.join(publicDir, `favicon-${theme}.ico`),
      await pngToIco(pngs),
    );
    await sharp(Buffer.from(await brandSvg({ ...options, size: 180 })))
      .png()
      .toFile(path.join(publicDir, `apple-touch-icon-${theme}.png`));
  }
  console.log("All web icons generated from brand/logo.svg.");
}
void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
