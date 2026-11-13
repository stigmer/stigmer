// The drawings' facts (../../design/*.json) are what design.spec.ts holds
// every built screen to, so each file must say something the spec can
// check: every drawing built by scenes the catalogue draws at a width it
// draws them at, or a reason none does yet; every judged fact (sample,
// ruled, pending) one the drawing has, judged once; and the import that
// writes them keeps those judgements when the drawing is exported again.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SCENES } from "../catalog.ts";

const DESIGN = fileURLToPath(new URL("../../design/", import.meta.url));
const IMPORT = fileURLToPath(new URL("../../scripts/import-design-facts.mjs", import.meta.url));

interface Drawing {
  readonly caption: string;
  readonly built: readonly { readonly scene: string; readonly width: string }[];
  readonly unbuilt?: string;
  readonly words: readonly { readonly text: string; readonly type: readonly number[] }[];
  readonly buttons: readonly { readonly name: string; readonly height: number }[];
  readonly sample: Readonly<Record<string, string>>;
  readonly ruled: Readonly<Record<string, string>>;
  readonly pending: Readonly<Record<string, string>>;
}

interface ScreenFacts {
  readonly screen: string;
  readonly replacedBy?: string;
  readonly drawings: readonly Drawing[];
}

const FILES = readdirSync(DESIGN).filter((name) => /^[spg]\d+[a-z]?\.json$/.test(name));
const read = (name: string): ScreenFacts => JSON.parse(readFileSync(join(DESIGN, name), "utf8")) as ScreenFacts;

/** The keys a drawing's facts are judged by, as design.spec.ts names them. */
function factKeys(drawing: Drawing): Set<string> {
  return new Set([
    ...drawing.words.flatMap((word) => [`word ${word.text}`, `type ${word.text}`]),
    ...drawing.buttons.map((button) => `button ${button.name}`),
  ]);
}

describe("the drawings' facts", () => {
  it("are there for the session page's screens and the console's parts and pages", () => {
    expect(FILES.filter((name) => name.startsWith("s")).length).toBeGreaterThan(50);
    expect(FILES.filter((name) => /^[pg]/.test(name)).length).toBe(18);
  });

  it.each(FILES)("%s builds each drawing from scenes the catalogue draws, or says why none does", (name) => {
    const facts = read(name);
    if (facts.replacedBy !== undefined) {
      expect(facts.drawings).toEqual([]);
      return;
    }
    for (const drawing of facts.drawings) {
      if (drawing.built.length === 0) expect(drawing.unbuilt ?? "", drawing.caption).not.toEqual("");
      for (const built of drawing.built) {
        const scene = SCENES.find((candidate) => candidate.id === built.scene);
        expect(scene, built.scene).toBeDefined();
        expect(scene!.widths as readonly string[], `${built.scene} at ${built.width}`).toContain(built.width);
      }
    }
  });

  it.each(FILES)("%s judges only facts its drawings have, each once, each with a reason", (name) => {
    for (const drawing of read(name).drawings) {
      const keys = factKeys(drawing);
      const judged = [...Object.entries(drawing.sample), ...Object.entries(drawing.ruled), ...Object.entries(drawing.pending)];
      expect(judged.filter(([key]) => !keys.has(key)).map(([key]) => key), drawing.caption).toEqual([]);
      expect(new Set(judged.map(([key]) => key)).size, drawing.caption).toEqual(judged.length);
      expect(judged.filter(([, why]) => why.trim() === "").map(([key]) => key), drawing.caption).toEqual([]);
    }
  });
});

describe("importing a design's export", () => {
  it("writes the drawing's facts and keeps the scenes, the judgements and a replacement already recorded", () => {
    const into = mkdtempSync(join(tmpdir(), "design-facts-"));
    const exported = join(into, "design-facts.json");
    const drawing = (words: string[]) => ({
      id: "s99",
      screen: "S99",
      title: "A screen",
      drawing: 0,
      caption: "A screen",
      narrow: false,
      blocks: words.map((text) => ({ text, type: [14, 20, 400] })),
      buttons: [{ name: "Run again", height: 24 }],
    });
    const run = () => spawnSync(process.execPath, [IMPORT, exported, "a page, version 1"], { encoding: "utf8", env: { ...process.env, DESIGN_FACTS_DIR: into } });

    writeFileSync(exported, JSON.stringify([drawing(["First words"])]));
    expect(run().status).toBe(0);
    const first = JSON.parse(readFileSync(join(into, "s99.json"), "utf8"));
    expect(first.drawings[0]).toMatchObject({ built: [], unbuilt: "", words: [{ text: "First words" }], pending: {} });

    first.drawings[0].built = [{ scene: "session-busy", width: "desktop" }];
    delete first.drawings[0].unbuilt;
    first.drawings[0].pending = { "button Run again": "a change that fixes it" };
    writeFileSync(join(into, "s99.json"), JSON.stringify(first));
    writeFileSync(exported, JSON.stringify([drawing(["Second words"])]));
    expect(run().status).toBe(0);
    const second = JSON.parse(readFileSync(join(into, "s99.json"), "utf8"));
    expect(second.source).toBe("a page, version 1");
    expect(second.drawings[0]).toMatchObject({
      built: [{ scene: "session-busy", width: "desktop" }],
      words: [{ text: "Second words" }],
      pending: { "button Run again": "a change that fixes it" },
    });
    expect(second.drawings[0].unbuilt).toBeUndefined();

    writeFileSync(join(into, "s99.json"), JSON.stringify({ ...second, replacedBy: "S100" }));
    expect(run().status).toBe(0);
    expect(JSON.parse(readFileSync(join(into, "s99.json"), "utf8"))).toMatchObject({ replacedBy: "S100", drawings: [] });
  });
});
