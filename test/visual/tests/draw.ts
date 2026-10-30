// How a scene is drawn for a picture, shared by the gallery's screenshots
// (gallery.spec.ts) and the pictures the site shows (shown.spec.ts), so a
// shown picture is drawn exactly as its scene's approved screenshot is.
//
// A scene is drawn at the scenario catalogue's clock, so no duration moves,
// and pictured once its calls have settled and its fonts have loaded. A
// scene whose state opens on a click is pictured, and audited, open.
import type { Page } from "@playwright/test";
import { SCENARIO_CLOCK } from "@stigmer/react-sdk/test";
import { sceneUrl, type Mode, type Scene } from "../src/catalog.ts";

/** Draws `scene` in `mode` in a viewport of `size`, settled: its calls answered, its fonts loaded, and opened if it opens. */
export async function draw(page: Page, scene: Scene, mode: Mode, size: { readonly width: number; readonly height: number }): Promise<void> {
  await page.clock.setFixedTime(new Date(SCENARIO_CLOCK));
  await page.setViewportSize(size);
  await page.goto(sceneUrl(scene.id, mode));
  await settled(page);
  for (const name of [scene.opens ?? []].flat()) {
    await page.getByRole("button", { name }).click();
    await settled(page);
  }
}

async function settled(page: Page): Promise<void> {
  await page.waitForFunction(() => window.gallery?.idle === true);
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
}
