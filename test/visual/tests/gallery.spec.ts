// The visual suite: every scene of the kit's gallery (src/catalog.ts)
// compared with its approved screenshot, in light and dark at each of its
// widths, and audited with axe in both modes.
//
// A scene is drawn as tests/draw.ts draws it: at the scenario catalogue's
// clock, settled, and opened if its state opens on a click.
//
// A changed look fails until its screenshots are minted again
// (`make test-visual UPDATE=1`) and the difference is approved in review.
// The audit fails on any critical or serious violation (test/support's
// `axe-policy`); a violation today's screens already have is listed below
// against the open issue that tracks it, and fails once it is fixed, so its
// line comes off in the fix's pull request.
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { AXE_TAGS, describeJudgement, judgeAxe, type KnownViolation } from "@stigmer/test-support/axe-policy";
import { MODES, SCENES, WIDTHS, screenshotsOf, type Mode, type SceneId } from "../src/catalog.ts";
import { draw } from "./draw.ts";

/** The rules each scene fails today, in each mode, against the issue that tracks each. */
const KNOWN_VIOLATIONS: Readonly<Partial<Record<`${SceneId} ${Mode}`, readonly KnownViolation[]>>> = {};

const SCREENSHOTS = fileURLToPath(new URL("./__screenshots__/", import.meta.url));

test.describe("KIT-03 the look changes only on purpose", () => {
  for (const shot of screenshotsOf(SCENES)) {
    test(`${shot.scene.id} ${shot.mode} ${shot.width} looks as approved`, async ({ page }) => {
      await draw(page, shot.scene, shot.mode, WIDTHS[shot.width]);
      await expect(page).toHaveScreenshot(shot.file, { fullPage: true });
    });
  }

  test("the approved screenshots are exactly the ones the catalogue takes", () => {
    const approved = readdirSync(SCREENSHOTS).filter((name) => !name.startsWith(".")).sort();
    const taken = screenshotsOf(SCENES).map((shot) => shot.file).sort();
    expect(approved.filter((name) => !taken.includes(name)), "screenshots no scene takes: delete them").toEqual([]);
    // While the screenshots are minted again (`--update-snapshots`), the
    // cases beside this one are writing the missing ones as it runs.
    const minting = ["all", "changed"].includes(test.info().config.updateSnapshots);
    if (!minting) {
      expect(taken.filter((name) => !approved.includes(name)), "scenes with no approved screenshot: mint them").toEqual([]);
    }
  });
});

test.describe("KIT-04 every hero screen passes the accessibility audit", () => {
  for (const scene of SCENES) {
    for (const mode of MODES) {
      test(`${scene.id} ${mode} passes the accessibility audit`, async ({ page }) => {
        await draw(page, scene, mode, WIDTHS[scene.widths[0] ?? "desktop"]);
        const results = await new AxeBuilder({ page }).withTags([...AXE_TAGS]).analyze();
        const judged = judgeAxe(results.violations, KNOWN_VIOLATIONS[`${scene.id} ${mode}`]);
        const report = describeJudgement(judged);
        if (report !== "") console.log(`[axe: ${scene.id} ${mode}]\n${report}`);
        expect(judged.failing, `critical or serious violations:\n${report}`).toEqual([]);
        expect(judged.stale, `listed violations that no longer occur:\n${report}`).toEqual([]);
      });
    }
  }

  test("every listed violation names a scene and mode the gallery draws", () => {
    const drawn = new Set(SCENES.flatMap((scene) => MODES.map((mode) => `${scene.id} ${mode}`)));
    expect(Object.keys(KNOWN_VIOLATIONS).filter((key) => !drawn.has(key))).toEqual([]);
  });
});
