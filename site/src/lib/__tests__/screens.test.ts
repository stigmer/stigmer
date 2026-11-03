/**
 * The screens' names, files and addresses: one module makes them for the
 * build that writes the files, the component that embeds them and the
 * export that links them, from the visual suite's own list. A picture's
 * marks are placed in percent of the crop they show on, and only on a crop
 * of the drawing they were measured on.
 */
import { describe, expect, it } from "vitest";
import { SHOWN as SUITE_SHOWN, SHOWN_SCALE as SUITE_SCALE } from "../../../../test/visual/src/shown";
import { SCREEN_DENSITIES, SCREENS_DIR, SHOWN, SHOWN_SCALE, placedMarks, screenFile, screenPath, shownScreen } from "../screens";

describe("the site's screens", () => {
  it("are the visual suite's shown list, at its scale", () => {
    expect(SHOWN).toBe(SUITE_SHOWN);
    expect(SHOWN_SCALE).toBe(SUITE_SCALE);
  });

  it("are served at one CSS pixel each and at the density the suite draws", () => {
    expect(SCREEN_DENSITIES).toEqual([1, SHOWN_SCALE]);
  });

  it("finds a screen by its name", () => {
    expect(shownScreen("approval").scene).toBe("session-approval");
  });

  it("refuses a name the list does not hold, naming the ones it does", () => {
    expect(() => shownScreen("dashboard")).toThrow(/no screen named "dashboard".*"approval"/);
  });

  it("names each file by screen and density, under the one screens folder", () => {
    expect(screenFile("approval", 2)).toBe("approval-2x.webp");
    expect(screenPath("approval", 1)).toBe(`/${SCREENS_DIR}/approval-1x.webp`);
    expect(SCREENS_DIR).toBe("screens");
  });

  it("places a picture's marks in percent of the crop they show on, leaving off any outside it", () => {
    const [asks] = placedMarks("in-product", "in-product-panel");
    const { box } = shownScreen("in-product").marks?.["asks-first"] ?? { box: { x: 0, y: 0, width: 0, height: 0 } };
    const crop = shownScreen("in-product-panel").clip ?? { x: 0, y: 0, width: 1, height: 1 };
    expect(asks.id).toBe("asks-first");
    expect(asks.left).toBeCloseTo(((box.x - crop.x) / crop.width) * 100);
    expect(asks.width).toBeCloseTo((box.width / crop.width) * 100);
    expect(placedMarks("in-product", "in-product-panel").map((mark) => mark.id)).toEqual(["asks-first"]);
    expect(placedMarks("in-product").map((mark) => mark.id)).toEqual(["asks-first", "walls"]);
    expect(placedMarks("approval")).toEqual([]);
  });

  it("refuses to place marks on a picture of another drawing", () => {
    expect(() => placedMarks("in-product", "approval")).toThrow(/"approval" is not a crop of the drawing "in-product" marks/);
  });
});
