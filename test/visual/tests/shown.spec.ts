// The pictures the site and the docs show (src/shown.ts), each compared with
// its approved file under tests/__shown__ at the device scale the site
// serves. The `shown` project in playwright.config.ts runs this file.
//
// A shown picture is a gallery scene drawn as its screenshot is drawn
// (tests/draw.ts), only sharper, so a change that moves its scene fails here
// too until both are minted again (`make test-visual UPDATE=1`). The
// pictures are dark only, the site's one mode, so these cases claim no
// promise on the UX bar: KIT-03 is the look in light and dark, which the
// gallery holds, and KIT-04 already audits every scene in dark.
//
// A picture's marks (the parts a page points a pin at) are checked on the
// same drawing: each target is found by its role and exact name, and its
// box, rounded to whole pixels, must be the one the entry declares. A
// moved target fails, minting included, with the box it was found at, so
// whoever moves it looks again at whether the pin still says the truth.
import { existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { SCENES, type Scene } from "../src/catalog.ts";
import { SHOWN, SHOWN_MODE, type Shown, type ShownClip } from "../src/shown.ts";
import { draw } from "./draw.ts";

const PICTURES = fileURLToPath(new URL("./__shown__/", import.meta.url));

/** The catalogue's scene a shown picture names; the unit check holds every name to the catalogue. */
function sceneOf(id: string): Scene {
  const scene = SCENES.find((candidate) => candidate.id === id);
  if (!scene) throw new Error(`no scene "${id}" in the catalogue`);
  return scene;
}

/** Each of `shown`'s marks found on the drawn page, its box rounded to whole CSS pixels; a target that is gone or not one element fails by name. */
async function measuredMarks(page: Page, shown: Shown): Promise<Record<string, ShownClip>> {
  const measured: Record<string, ShownClip> = {};
  for (const [id, mark] of Object.entries(shown.marks ?? {})) {
    const target = page.getByRole(mark.role, { name: mark.name, exact: true });
    await expect(target, `${shown.name}'s "${id}" mark: one ${mark.role} named "${mark.name}"`).toHaveCount(1);
    const box = await target.boundingBox();
    if (box === null) throw new Error(`${shown.name}'s "${id}" mark: the ${mark.role} "${mark.name}" is not drawn`);
    measured[id] = { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) };
  }
  return measured;
}

test.describe("the pictures the site shows match what the suite approved", () => {
  for (const shown of SHOWN) {
    test(`${shown.name} (${shown.scene}) looks as approved`, async ({ page }) => {
      await draw(page, sceneOf(shown.scene), SHOWN_MODE, shown.viewport);
      const declared = Object.fromEntries(Object.entries(shown.marks ?? {}).map(([id, mark]) => [id, mark.box]));
      expect(await measuredMarks(page, shown), `${shown.name}'s marks, as drawn (src/shown.ts declares where)`).toEqual(declared);
      await expect(page).toHaveScreenshot(`${shown.name}.png`, { clip: shown.clip });
    });
  }

  test("the approved pictures are exactly the ones the list names", () => {
    const approved = existsSync(PICTURES) ? readdirSync(PICTURES).filter((name) => !name.startsWith(".")).sort() : [];
    const named = SHOWN.map((shown) => `${shown.name}.png`).sort();
    expect(approved.filter((name) => !named.includes(name)), "pictures no entry names: delete them").toEqual([]);
    // While the pictures are minted again, the cases beside this one are
    // writing the missing ones as it runs.
    const minting = ["all", "changed"].includes(test.info().config.updateSnapshots);
    if (!minting) {
      expect(named.filter((name) => !approved.includes(name)), "entries with no approved picture: mint them").toEqual([]);
    }
  });
});
