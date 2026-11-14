// The design facts test: every built screen says what the drawing that
// passed the owner's look says, and every scene keeps the kit's layout
// rules. The gallery's own comparison (gallery.spec.ts) holds the build to
// its approved screenshot; this holds it to the drawing.
//
// A drawing's facts are what the design page exported for it
// (`test/visual/design/<screen>.json`, `design/README.md`): each block's
// words with their type, and each button's name and height. Each drawing
// names the gallery scenes that build it; each scene is drawn whole, in
// light, at its width (tests/draw.ts), and read with the same rules the
// page read the drawing with (tests/design-read.ts). A fact holds when:
// - word: some built block's words hold the drawn words;
// - type: the built block whose words are exactly the drawn words has the
//   drawn size, line height and weight (checked only where such a block
//   exists; a word that fails is already reported);
// - button: a built button has the drawn name and height, to a pixel.
//
// A fact the drawing invents (a time, a name the scene's data differs in)
// is listed under `sample`; a difference the owner ruled under `ruled`,
// with his reason. Neither is checked. A fact known to fail is listed under
// `pending` with the change that fixes it, and fails here once it holds, so
// its line comes off in that change: the list is the work left between the
// build and its drawings, and they agree when only ruled differences remain.
//
// The layout audit reads every scene of the catalogue, drawn or not, for
// the families of drift no drawing has to name: text off the type scale,
// a paragraph or heading keeping the browser's margin, spacing off the
// scale. Its known breaks are listed in `design/layout-pending.json` per
// scene, against the change that fixes them, in the same way.
import { appendFileSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { SCENES, WIDTHS, type Scene, type WidthName } from "../src/catalog.ts";
import { auditLayout, readPage, type Reading } from "./design-read.ts";
import { draw } from "./draw.ts";

const DESIGN = fileURLToPath(new URL("../design/", import.meta.url));

/**
 * Where to write what fails, one JSON line per drawing or scene, when set:
 * how the pending lists are drawn up after a new export or a fix
 * (`design/README.md`). The test judges the same either way.
 */
const REPORT = process.env["DESIGN_FACTS_REPORT"];

/** One drawn block's words and type, as the page exported them. */
interface DrawnWord {
  readonly text: string;
  readonly type: readonly [number, number, number];
}

/** One drawing of a screen and the scenes that build it. */
interface Drawing {
  readonly caption: string;
  readonly narrow: boolean;
  readonly built: readonly { readonly scene: string; readonly width: WidthName }[];
  /** Why no scene builds the drawing yet, when none does. */
  readonly unbuilt?: string;
  readonly words: readonly DrawnWord[];
  readonly buttons: readonly { readonly name: string; readonly height: number }[];
  /** Facts the drawing invents (data the scene differs in), with what the scene shows instead. */
  readonly sample: Readonly<Record<string, string>>;
  /** Differences the owner ruled, with his reason. */
  readonly ruled: Readonly<Record<string, string>>;
  /** Facts known to fail, with the change that fixes each. */
  readonly pending: Readonly<Record<string, string>>;
}

/** One screen's facts file. */
interface ScreenFacts {
  readonly screen: string;
  readonly title: string;
  readonly source: string;
  /** A later look's screen that replaced this one; its drawings are not built. */
  readonly replacedBy?: string;
  readonly drawings: readonly Drawing[];
}

const SCREENS: readonly (ScreenFacts & { readonly file: string })[] = readdirSync(DESIGN)
  .filter((name) => /^[spg]\d+[a-z]?\.json$/.test(name))
  .sort()
  .map((file) => ({ file, ...(JSON.parse(readFileSync(`${DESIGN}${file}`, "utf8")) as ScreenFacts) }));

/** Each scene's known layout breaks, against the change that fixes them. */
const LAYOUT_PENDING = JSON.parse(readFileSync(`${DESIGN}layout-pending.json`, "utf8")) as Readonly<Record<string, Readonly<Record<string, string>>>>;

function sceneOf(id: string): Scene {
  const scene = SCENES.find((candidate) => candidate.id === id);
  if (scene === undefined) throw new Error(`no scene "${id}" in the catalogue`);
  return scene;
}

/** Collapses a text the way the readers do, and folds case, so a sentence's capital never differs from a button's. */
function fold(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/** The most readings taken while waiting for two to agree. */
const READINGS = 20;

/**
 * Reads the page with `reader` until two readings a tenth of a second apart
 * agree, as the screenshot comparison waits for two equal frames: a part
 * that replaces its loading state after the page settles is read once it
 * has.
 */
async function steady<T>(page: Page, reader: (selector: string) => T): Promise<T> {
  let last = JSON.stringify(await page.evaluate(reader, "body"));
  for (let round = 0; round < READINGS; round += 1) {
    await page.waitForTimeout(100);
    const next = JSON.stringify(await page.evaluate(reader, "body"));
    if (next === last) return JSON.parse(next) as T;
    last = next;
  }
  throw new Error(`the page kept changing for ${READINGS} readings`);
}

/** The scene `id` drawn whole in light at `width`, read once it is steady. */
async function readScene(page: Page, id: string, width: WidthName): Promise<Reading> {
  await draw(page, sceneOf(id), "light", WIDTHS[width], { whole: true });
  return steady(page, readPage);
}

/** The keys of the facts in `drawing` the built `readings` do not hold, each with what was found. */
function failingFacts(drawing: Drawing, readings: readonly Reading[]): Map<string, string> {
  const failing = new Map<string, string>();
  const blocks = readings.flatMap((reading) => reading.blocks);
  const buttons = readings.flatMap((reading) => reading.buttons);
  for (const word of drawing.words) {
    const want = fold(word.text);
    if (!blocks.some((block) => fold(block.text).includes(want))) failing.set(`word ${word.text}`, "no built block holds these words");
    const exact = blocks.find((block) => fold(block.text) === want);
    if (exact === undefined) continue;
    const [size, leading, weight] = word.type;
    const [builtSize, builtLeading, builtWeight] = exact.type;
    if (Math.abs(size - builtSize) > 0.5 || Math.abs(leading - builtLeading) > 0.5 || weight !== builtWeight) {
      failing.set(`type ${word.text}`, `built ${builtSize}/${builtLeading} weight ${builtWeight}, drawn ${size}/${leading} weight ${weight}`);
    }
  }
  for (const button of drawing.buttons) {
    // A built button's name may say more than the drawing's word ("Stop"
    // drawn, "Stop this turn" built), never less.
    const named = buttons.filter((built) => fold(built.name).includes(fold(button.name)));
    if (named.length === 0) failing.set(`button ${button.name}`, "no built button has this name");
    else if (!named.some((built) => Math.abs(built.height - button.height) <= 1)) {
      failing.set(`button ${button.name}`, `built ${named.map((built) => built.height).join(", ")}px tall, drawn ${button.height}px`);
    }
  }
  return failing;
}

test.describe("every built screen says what its drawing says", () => {
  for (const screen of SCREENS) {
    if (screen.replacedBy !== undefined) continue;
    screen.drawings.forEach((drawing, index) => {
      const name = `${screen.screen} ${screen.title}${screen.drawings.length > 1 ? ` (${index + 1}: ${drawing.caption.slice(0, 48)})` : ""}`;
      if (drawing.built.length === 0) {
        test(`${name} has a reason no scene builds it`, () => {
          expect(drawing.unbuilt ?? "", "a drawing no scene builds says why").not.toEqual("");
        });
        return;
      }
      test(`${name} matches its drawing`, async ({ page }) => {
        const readings: Reading[] = [];
        for (const { scene, width } of drawing.built) readings.push(await readScene(page, scene, width));
        const judged = new Set([...Object.keys(drawing.sample), ...Object.keys(drawing.ruled)]);
        const failing = failingFacts(drawing, readings);
        if (REPORT !== undefined) appendFileSync(REPORT, `${JSON.stringify({ file: screen.file, drawing: index, failing: Object.fromEntries(failing), built: readings.map((reading) => reading.blocks.map((block) => block.text)), buttons: readings.map((reading) => reading.buttons.map((button) => `${button.name} ${button.height}`)) })}\n`);
        const unexpected = [...failing].filter(([key]) => !judged.has(key) && drawing.pending[key] === undefined);
        const stale = Object.keys(drawing.pending).filter((key) => !failing.has(key));
        expect(unexpected.map(([key, found]) => `${key}: ${found}`), `facts the build does not hold (fix the build, or list them in ${screen.file})`).toEqual([]);
        expect(stale, `pending facts that now hold: take their lines out of ${screen.file}`).toEqual([]);
      });
    });
  }

  test("every facts file names a screen once, and every scene it names is in the catalogue", () => {
    const named = SCREENS.flatMap((screen) => screen.drawings.flatMap((drawing) => drawing.built.map((built) => built.scene)));
    expect(named.filter((id) => !SCENES.some((scene) => scene.id === id))).toEqual([]);
    expect(new Set(SCREENS.map((screen) => screen.screen)).size).toEqual(SCREENS.length);
  });
});

test.describe("every scene keeps the kit's layout rules", () => {
  for (const scene of SCENES) {
    const width = scene.widths[0] ?? "desktop";
    test(`${scene.id} keeps the layout rules`, async ({ page }) => {
      await draw(page, scene, "light", WIDTHS[width], { whole: true });
      const breaks = await steady(page, auditLayout);
      if (REPORT !== undefined) appendFileSync(REPORT, `${JSON.stringify({ scene: scene.id, breaks: breaks.map((one) => `${one.rule} ${one.where}: ${one.detail}`) })}\n`);
      const known = LAYOUT_PENDING[scene.id] ?? {};
      const found = new Set(breaks.map((one) => `${one.rule} ${one.where}: ${one.detail}`));
      const unexpected = [...found].filter((key) => known[key] === undefined);
      const stale = Object.keys(known).filter((key) => !found.has(key));
      expect(unexpected, "layout breaks (fix them, or list them in design/layout-pending.json against their fix)").toEqual([]);
      expect(stale, "listed layout breaks that no longer occur: take their lines out of design/layout-pending.json").toEqual([]);
    });
  }

  test("every scene with listed layout breaks is in the catalogue", () => {
    expect(Object.keys(LAYOUT_PENDING).filter((id) => !SCENES.some((scene) => scene.id === id))).toEqual([]);
  });
});
