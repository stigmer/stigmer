// The visual suite: every scene of the kit's gallery (src/catalog.ts)
// compared with its approved screenshot, in light and dark at each of its
// widths, and audited with axe in both modes.
//
// A scene is drawn at the scenario catalogue's clock, so no duration moves,
// and pictured once its calls have settled and its fonts have loaded. A
// scene whose state opens on a click is pictured, and audited, open.
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
import { expect, test, type Page } from "@playwright/test";
import { AXE_TAGS, describeJudgement, judgeAxe, type KnownViolation } from "@stigmer/test-support/axe-policy";
import { SCENARIO_CLOCK } from "@stigmer/react-sdk/test";
import { MODES, SCENES, WIDTHS, screenshotsOf, sceneUrl, type Mode, type Scene, type SceneId, type WidthName } from "../src/catalog.ts";

/** The rules each scene fails today, in each mode, against the issue that tracks each. */
const KNOWN_VIOLATIONS: Readonly<Partial<Record<`${SceneId} ${Mode}`, readonly KnownViolation[]>>> = {
  "thread-failed light": [{ rule: "color-contrast", issue: "stigmer#2643" }],
  "thread-subagent-finished light": [{ rule: "color-contrast", issue: "stigmer#2644" }],
  "file-review-dock light": [{ rule: "color-contrast", issue: "stigmer#2645" }],
  "file-review-dock dark": [{ rule: "color-contrast", issue: "stigmer#2645" }],
};

const SCREENSHOTS = fileURLToPath(new URL("./__screenshots__/", import.meta.url));

/** Draws `scene` in `mode` at `width`, settled: its calls answered, its fonts loaded, and opened if it opens. */
async function draw(page: Page, scene: Scene, mode: Mode, width: WidthName): Promise<void> {
  await page.clock.setFixedTime(new Date(SCENARIO_CLOCK));
  await page.setViewportSize(WIDTHS[width]);
  await page.goto(sceneUrl(scene.id, mode));
  await settled(page);
  if (scene.opens !== undefined) {
    await page.getByRole("button", { name: scene.opens }).click();
    await settled(page);
  }
}

async function settled(page: Page): Promise<void> {
  await page.waitForFunction(() => window.gallery?.idle === true);
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
}

test.describe("KIT-03 the look changes only on purpose", () => {
  for (const shot of screenshotsOf(SCENES)) {
    test(`${shot.scene.id} ${shot.mode} ${shot.width} looks as approved`, async ({ page }) => {
      await draw(page, shot.scene, shot.mode, shot.width);
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
        await draw(page, scene, mode, scene.widths[0] ?? "desktop");
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
