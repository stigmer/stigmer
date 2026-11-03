// The pictures the site shows (../shown.ts) against the catalogue: every
// entry draws a scene the gallery has, in a mode it draws, under a name a
// page can use, and keeps a part of the screen it actually draws.
import { describe, expect, it } from "vitest";
import { MODES, SCENES } from "../catalog.ts";
import { SHOWN, SHOWN_MODE, SHOWN_SCALE, shownSize } from "../shown.ts";

describe("the shown pictures", () => {
  it("draw only scenes the catalogue lists", () => {
    const ids: readonly string[] = SCENES.map((scene) => scene.id);
    expect(SHOWN.filter((shown) => !ids.includes(shown.scene)).map((shown) => shown.name)).toEqual([]);
  });

  it("are drawn in a mode the gallery draws, at a whole device scale", () => {
    expect(MODES).toContain(SHOWN_MODE);
    expect(Number.isInteger(SHOWN_SCALE) && SHOWN_SCALE >= 1).toBe(true);
  });

  it("have unique kebab-case names, each a file name and an address as it stands", () => {
    const names = SHOWN.map((shown) => shown.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names.filter((name) => !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name))).toEqual([]);
  });

  it("are drawn in a whole-pixel viewport and keep a part of it that lies inside it", () => {
    const outside = SHOWN.filter(({ viewport, clip }) => {
      const whole = [viewport.width, viewport.height].every((n) => Number.isInteger(n) && n > 0);
      if (!clip) return !whole;
      const clipWhole = [clip.x, clip.y, clip.width, clip.height].every((n) => Number.isInteger(n) && n >= 0);
      return (
        !whole ||
        !clipWhole ||
        clip.width === 0 ||
        clip.height === 0 ||
        clip.x + clip.width > viewport.width ||
        clip.y + clip.height > viewport.height
      );
    });
    expect(outside.map((shown) => shown.name)).toEqual([]);
  });

  it("size a picture by its clip, or else its viewport", () => {
    const viewport = { width: 1280, height: 800 };
    expect(shownSize({ name: "whole", scene: "x", title: "x", viewport })).toEqual(viewport);
    expect(shownSize({ name: "card", scene: "x", title: "x", viewport, clip: { x: 10, y: 20, width: 400, height: 300 } })).toEqual({
      width: 400,
      height: 300,
    });
  });
});
