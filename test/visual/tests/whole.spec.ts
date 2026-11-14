// The whole pictures a Built look compares with the drawings: each scene
// the design facts name, drawn whole (tests/draw.ts) in light and dark at
// two device pixels per CSS pixel, written into the folder `WHOLE_OUT`
// names. Nothing is compared here: the pictures go beside the drawings on
// the design page, where the owner judges what no fact holds. Run it as
// `WHOLE_OUT=<folder> node test/visual/run-in-image.mjs --project=whole
// whole.spec.ts`; the `whole` project collects this file only when
// `WHOLE_OUT` names a folder (playwright.config.ts), so the suite's own run
// draws nothing extra.
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "@playwright/test";
import { MODES, SCENES, WIDTHS, type WidthName } from "../src/catalog.ts";
import { draw } from "./draw.ts";

const OUT = process.env["WHOLE_OUT"] ?? "";
const DESIGN = fileURLToPath(new URL("../design/", import.meta.url));

/** Every scene and width a facts file names, once each. */
const NAMED: readonly { readonly scene: string; readonly width: WidthName }[] = [
  ...new Map(
    readdirSync(DESIGN)
      .filter((name) => /^[spg]\d+[a-z]?\.json$/.test(name))
      .flatMap((name) => (JSON.parse(readFileSync(join(DESIGN, name), "utf8")) as { drawings: { built: { scene: string; width: WidthName }[] }[] }).drawings)
      .flatMap((drawing) => drawing.built)
      .map((built) => [`${built.scene} ${built.width}`, built] as const),
  ).values(),
];

for (const { scene: id, width } of NAMED) {
  for (const mode of MODES) {
    test(`${id} ${mode} ${width} drawn whole`, async ({ page }) => {
      const scene = SCENES.find((candidate) => candidate.id === id);
      if (scene === undefined) throw new Error(`no scene "${id}" in the catalogue`);
      if (OUT === "") throw new Error("WHOLE_OUT names no folder to write the pictures into");
      mkdirSync(OUT, { recursive: true });
      await draw(page, scene, mode, WIDTHS[width], { whole: true });
      await page.screenshot({ path: join(OUT, `${id}-${mode}-${width}.png`), fullPage: true, animations: "disabled", caret: "hide" });
    });
  }
}
