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

/** How a caller wants a scene drawn beyond its catalogue entry. */
export interface DrawOptions {
  /** Grow the viewport until nothing scrolls, for a scene the catalogue pictures whole. */
  readonly whole?: boolean;
}

/** Draws `scene` in `mode` in a viewport of `size`, settled: its calls answered, its fonts loaded, opened if it opens, and grown whole if asked. */
export async function draw(
  page: Page,
  scene: Scene,
  mode: Mode,
  size: { readonly width: number; readonly height: number },
  options: DrawOptions = {},
): Promise<void> {
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
  if (options.whole === true && scene.whole === true) await growWhole(page, size);
}

/** What a scrolling region may hide and still count as whole, in CSS pixels. */
const HIDDEN_SLOP = 4;

/** The most rounds a page is grown: a thread that grows as it is given room settles in two. */
const GROW_ROUNDS = 4;

/** How far the viewport is stretched to find the regions that grow with it. */
const PROBE_PX = 1_000;

/** Each scrolling region on the page (`overflow-y` auto or scroll), by a mark it keeps between readings: its box's height and what it hides. */
async function scrollingRegions(page: Page): Promise<Record<string, { readonly box: number; readonly hidden: number }>> {
  return page.evaluate(() => {
    const regions: Record<string, { box: number; hidden: number }> = {};
    let next = document.querySelectorAll("[data-whole-region]").length;
    for (const element of document.querySelectorAll<HTMLElement>("*")) {
      const overflow = getComputedStyle(element).overflowY;
      if (overflow !== "auto" && overflow !== "scroll") continue;
      element.dataset["wholeRegion"] ??= String(next++);
      regions[element.dataset["wholeRegion"]] = { box: element.clientHeight, hidden: element.scrollHeight - element.clientHeight };
    }
    return regions;
  });
}

/**
 * Grows the viewport until no region that follows the page's height
 * scrolls. The regions that follow it are found first, by stretching the
 * viewport once and seeing whose box grew: the session's thread, a page
 * under the console's frame. A region that keeps its own height (a capped
 * list, an opened picker) or clips without scrolling (a truncated line) is
 * drawn as the page draws it, and never decides the growth. Then, round by
 * round, the viewport grows by the most any following region hides. The
 * width stays the scene's.
 */
async function growWhole(page: Page, size: { readonly width: number; readonly height: number }): Promise<void> {
  const before = await scrollingRegions(page);
  await page.setViewportSize({ width: size.width, height: size.height + PROBE_PX });
  await settled(page);
  const stretched = await scrollingRegions(page);
  const following = Object.keys(before).filter((id) => (stretched[id]?.box ?? 0) > before[id]!.box);
  let height = size.height;
  await page.setViewportSize({ width: size.width, height });
  await settled(page);
  for (let round = 0; round < GROW_ROUNDS; round += 1) {
    const regions = await scrollingRegions(page);
    const hidden = Math.max(0, ...following.map((id) => regions[id]?.hidden ?? 0));
    // A region hiding a few pixels (a focus ring's room, a rounding) hides
    // no content.
    if (hidden <= HIDDEN_SLOP) return;
    height += hidden;
    await page.setViewportSize({ width: size.width, height });
    await settled(page);
  }
  throw new Error(`still scrolling after ${GROW_ROUNDS} rounds of growing to ${height}px`);
}

/** Performs one act as a reader would: presses a control by its role and name, or types into a field by its label. */
async function perform(page: Page, act: Act): Promise<void> {
  if (typeof act === "string") await page.getByRole("button", { name: act }).click();
  else if ("press" in act) {
    const control = page.getByRole(act.role, { name: act.press, exact: act.exact });
    await (await pressTarget(page, act.first === true ? control.first() : control)).click();
  }
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
