// The gallery's catalogue (../catalog.ts) against what it pictures: every
// state of the scenario catalogue has its thread scene or a reason it has
// none, every preset beyond the default look has its scene, and every scene
// takes pictures under names no other scene takes.
import { THEME_PRESETS } from "@stigmer/design-tokens";
import { SCENARIO_NAMES } from "@stigmer/react-sdk/test";
import { describe, expect, it } from "vitest";
import { MODES, PRESETS, SCENES, THREAD_DRAWN_ELSEWHERE, THREAD_STATES, screenshotsOf, sceneUrl, type Act, type Scene } from "../catalog.ts";

describe("the scene sweep", () => {
  it("draws every state of the scenario catalogue in the thread, or says what draws it instead", () => {
    const covered = [...THREAD_STATES, ...Object.keys(THREAD_DRAWN_ELSEWHERE)];
    expect(SCENARIO_NAMES.filter((name) => !covered.includes(name)), "a scenario with no thread scene and no reason").toEqual([]);
    expect(covered.filter((name) => !(SCENARIO_NAMES as readonly string[]).includes(name)), "a scene for a scenario the catalogue dropped").toEqual([]);
  });

  it("never both draws a state and says it is drawn elsewhere", () => {
    expect(THREAD_STATES.filter((state) => state in THREAD_DRAWN_ELSEWHERE)).toEqual([]);
  });

  it("keeps the catalogue's order, so the index lists the states as a conversation meets them", () => {
    expect(SCENARIO_NAMES.filter((name) => (THREAD_STATES as readonly string[]).includes(name))).toEqual([...THREAD_STATES]);
  });

  it("draws the completed thread in every preset beyond the default look", () => {
    expect([...PRESETS].sort()).toEqual(THEME_PRESETS.map((preset) => preset.id).filter((id) => id !== "default").sort());
  });
});

describe("the scenes' pictures", () => {
  it("gives every scene a unique id and at least one width", () => {
    const ids = SCENES.map((scene) => scene.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(SCENES.filter((scene) => scene.widths.length === 0).map((scene) => scene.id)).toEqual([]);
  });

  it("names every picture <scene>-<mode>-<width>.png, each once", () => {
    const files = screenshotsOf(SCENES).map((shot) => shot.file);
    expect(new Set(files).size).toBe(files.length);
    expect(files).toContain("thread-approval-dark-narrow.png");
    expect(files.length).toBe(SCENES.reduce((total, scene) => total + scene.widths.length * MODES.length, 0));
  });

  it("names a control and, for a field, what is typed, in every act a scene performs", () => {
    expect(blankActs(SCENES)).toEqual([]);
  });

  it("finds a blank act", () => {
    const planted: Scene = {
      id: "thread-empty",
      title: "planted",
      widths: ["desktop"],
      opens: [{ press: " ", role: "tab" }, { fill: "Name", with: "" }],
    };
    expect(blankActs([planted])).toEqual(["thread-empty act 1", "thread-empty act 2"]);
  });

  it("addresses a scene by its id and mode", () => {
    expect(sceneUrl("thread-approval", "dark")).toBe("/?scene=thread-approval&mode=dark");
  });
});

/** Every act, as `<scene> act <n>`, that names no control or, filling a field, types nothing. */
function blankActs(scenes: readonly Scene[]): string[] {
  const blank = (act: Act): boolean =>
    typeof act === "string" ? act.trim() === "" : "press" in act ? act.press.trim() === "" : act.fill.trim() === "" || act.with.trim() === "";
  return scenes.flatMap((scene) =>
    [scene.opens ?? []].flat().flatMap((act, index) => (blank(act) ? [`${scene.id} act ${index + 1}`] : [])),
  );
}
