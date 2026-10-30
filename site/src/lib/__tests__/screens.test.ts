/**
 * The screens' names, files and addresses: one module makes them for the
 * build that writes the files, the component that embeds them and the
 * export that links them, from the visual suite's own list.
 */
import { describe, expect, it } from "vitest";
import { SHOWN as SUITE_SHOWN, SHOWN_SCALE as SUITE_SCALE } from "../../../../test/visual/src/shown";
import { SCREEN_DENSITIES, SCREENS_DIR, SHOWN, SHOWN_SCALE, screenFile, screenPath, shownScreen } from "../screens";

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
});
