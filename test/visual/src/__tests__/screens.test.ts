// The screen list (../../screens.json) against the gallery: every console
// and desktop screen it names is drawn by scenes the catalogue has, and at
// least one of them is built to a drawing the maintainer passed (a design
// facts file names it in `built`), or the screen says why it has none. The
// apps' own tests hold the other half: every route they serve is on the
// list (client-apps/web/src/__tests__/screens-listed.test.ts,
// client-apps/desktop/src/__tests__/screens-listed.test.tsx). So a new
// screen cannot ship without a picture and an approved drawing behind it,
// and a `none` is a reviewed line in a gate file (test/README.md rule 5).
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SCENES } from "../catalog.ts";
import { readScreens, type ScreenEntry } from "../screens.ts";

const DESIGN = fileURLToPath(new URL("../../design/", import.meta.url));

/** Every scene a design facts file says builds one of its drawings. */
function scenesInApprovedDrawings(): ReadonlySet<string> {
  const built = new Set<string>();
  for (const name of readdirSync(DESIGN).filter((file) => /^[spg]\d+[a-z]?\.json$/.test(file))) {
    const facts = JSON.parse(readFileSync(`${DESIGN}${name}`, "utf8")) as { readonly drawings?: readonly { readonly built: readonly { readonly scene: string }[] }[] };
    for (const drawing of facts.drawings ?? []) for (const { scene } of drawing.built) built.add(scene);
  }
  return built;
}

const SCREENS = readScreens();
const SCENE_IDS: ReadonlySet<string> = new Set(SCENES.map((scene) => scene.id));
const APPROVED = scenesInApprovedDrawings();

/** What is wrong with one listed screen, or nothing. */
function faultsOf(route: string, entry: ScreenEntry, console: Readonly<Record<string, ScreenEntry>>): string[] {
  const faults: string[] = [];
  if ("scenes" in entry) {
    if (entry.scenes.length === 0) faults.push(`${route} names no scene`);
    for (const scene of entry.scenes) if (!SCENE_IDS.has(scene)) faults.push(`${route} names the scene ${scene}, which the gallery's catalogue does not have`);
    const held = entry.scenes.some((scene) => APPROVED.has(scene));
    if (entry.pending !== undefined) {
      if (!/^stigmer#\d+$/.test(entry.pending)) faults.push(`${route} names its gap as ${entry.pending}, not an issue (stigmer#N)`);
      if (held) faults.push(`${route} is held to a passed drawing now: take its \`pending\` out of test/visual/screens.json`);
    } else if (entry.scenes.length > 0 && !held) {
      faults.push(`${route} has no scene inside a drawing the maintainer passed: name its scenes in a design facts file's \`built\` (test/visual/design/README.md)`);
    }
  } else if ("none" in entry) {
    if (entry.none.trim() === "") faults.push(`${route} says it has no screen without saying why`);
    if (entry.same !== undefined && console[entry.same] === undefined) faults.push(`${route} points at ${entry.same}, which the console list does not have`);
  } else {
    const target = console[entry.same];
    if (target === undefined) faults.push(`${route} draws the same view as ${entry.same}, which the console list does not have`);
    else if (!("scenes" in target)) faults.push(`${route} draws the same view as ${entry.same}, which has no scenes of its own`);
  }
  return faults;
}

describe("CON-16 every console screen is drawn and held to a passed drawing, or says why it has none", () => {
  it("draws each listed console screen in the gallery, inside a drawing the maintainer passed", () => {
    expect(Object.entries(SCREENS.console).flatMap(([route, entry]) => faultsOf(route, entry, SCREENS.console))).toEqual([]);
  });

  it("finds a screen whose scenes no passed drawing names, and a scene the catalogue lacks", () => {
    expect(faultsOf("/settings/audit", { scenes: ["settings-audit"] }, SCREENS.console)).toEqual([
      "/settings/audit names the scene settings-audit, which the gallery's catalogue does not have",
      "/settings/audit has no scene inside a drawing the maintainer passed: name its scenes in a design facts file's `built` (test/visual/design/README.md)",
    ]);
    expect(faultsOf("/settings/audit", { none: " " }, SCREENS.console)).toEqual(["/settings/audit says it has no screen without saying why"]);
  });

  it("lets a known gap stand only against an issue, and only while it is a gap", () => {
    const approved = SCENES.map((scene) => scene.id).find((id) => APPROVED.has(id)) ?? "";
    const unapproved = SCENES.map((scene) => scene.id).find((id) => !APPROVED.has(id)) ?? "";
    expect(faultsOf("/settings/audit", { scenes: [unapproved], pending: "stigmer#1" }, SCREENS.console)).toEqual([]);
    expect(faultsOf("/settings/audit", { scenes: [approved], pending: "stigmer#1" }, SCREENS.console)).toEqual([
      "/settings/audit is held to a passed drawing now: take its `pending` out of test/visual/screens.json",
    ]);
    expect(faultsOf("/settings/audit", { scenes: [unapproved], pending: "soon" }, SCREENS.console)).toEqual([
      "/settings/audit names its gap as soon, not an issue (stigmer#N)",
    ]);
  });
});

describe("DSK-08 every desktop screen is drawn and held to a passed drawing, or says why it has none", () => {
  it("draws each listed desktop screen in the gallery, or the console screen it shares, inside a drawing the maintainer passed", () => {
    expect(Object.entries(SCREENS.desktop).flatMap(([route, entry]) => faultsOf(route, entry, SCREENS.console))).toEqual([]);
  });

  it("finds a desktop screen that points at a console screen the list lacks", () => {
    expect(faultsOf("/settings/audit", { same: "/settings/audit" }, SCREENS.console)).toEqual([
      "/settings/audit draws the same view as /settings/audit, which the console list does not have",
    ]);
  });
});
