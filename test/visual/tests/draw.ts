// How a scene is drawn for a picture, shared by the gallery's screenshots
// (gallery.spec.ts) and the pictures the site shows (shown.spec.ts), so a
// shown picture is drawn exactly as its scene's approved screenshot is.
//
// A scene is drawn at the scenario catalogue's clock, so no duration moves
// (one reached by time passing is held ten seconds past it, then run on by its
// `elapse`),
// with every request off the machine refused, and pictured once its calls
// have settled and its fonts have loaded. A scene reached by acts (a
// click that opens it, a form a docs page fills) is pictured, and audited,
// after them, settled after each.
import type { Locator, Page } from "@playwright/test";
import { SCENARIO_CLOCK } from "@stigmer/react-sdk/test";
import { sceneUrl, type Act, type Mode, type Scene } from "../src/catalog.ts";

/** Draws `scene` in `mode` in a viewport of `size`, settled: its calls answered, its fonts loaded, and opened if it opens. */
export async function draw(page: Page, scene: Scene, mode: Mode, size: { readonly width: number; readonly height: number }): Promise<void> {
  // The page reads no network: a request for anything but the gallery itself
  // (a publisher's avatar a marketplace card shows) fails at once, so the
  // part falls back the same way on every machine instead of drawing
  // whatever the network returned.
  await page.route(
    (url) => url.hostname !== "localhost" && url.hostname !== "127.0.0.1",
    (route) => route.abort("blockedbyclient"),
  );
  if (scene.elapse === undefined) await page.clock.setFixedTime(new Date(SCENARIO_CLOCK));
  else await page.clock.install({ time: new Date(SCENARIO_CLOCK) });
  await page.setViewportSize(size);
  await page.goto(sceneUrl(scene.id, mode));
  await settled(page);
  if (scene.elapse !== undefined) {
    // Held ten seconds past the catalogue's clock, so what the load took
    // never shows; then run on, firing each timer due, and fixed there with
    // timers running again, as the other scenes are drawn (the audit waits
    // on its own).
    const held = Date.parse(SCENARIO_CLOCK) + 10_000;
    await page.clock.pauseAt(new Date(held));
    await page.clock.runFor(scene.elapse);
    await page.clock.resume();
    await page.clock.setFixedTime(new Date(held + scene.elapse));
    await settled(page);
  }
  for (const act of [scene.opens ?? []].flat()) {
    await perform(page, act);
    await settled(page);
  }
}

/** Performs one act as a reader would: presses a control by its role and name, or types into a field by its label. */
async function perform(page: Page, act: Act): Promise<void> {
  if (typeof act === "string") await page.getByRole("button", { name: act }).click();
  else if ("press" in act) await (await pressTarget(page, page.getByRole(act.role, { name: act.press, exact: act.exact }))).click();
  else await page.getByLabel(act.fill, { exact: act.exact }).fill(act.with);
}

/**
 * Where a reader presses `control`: on the control, or, for a radio or
 * checkbox the kit draws as its label (the input visually hidden, one pixel
 * square, inside the label that wraps it), on that label, which is what
 * takes the click.
 */
async function pressTarget(page: Page, control: Locator): Promise<Locator> {
  const box = await control.boundingBox();
  if (box !== null && box.width <= 1 && box.height <= 1) return page.locator("label").filter({ has: control });
  return control;
}

async function settled(page: Page): Promise<void> {
  await page.waitForFunction(() => window.gallery?.idle === true);
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
}
