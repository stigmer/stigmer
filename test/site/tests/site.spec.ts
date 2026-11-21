// The site suite: a sample of the built website's pages, each opened as a
// visitor opens it, at a phone width and a desktop width (the config's
// `narrow` and `wide` projects), and audited with axe.
//
// The pages are the export as built (site/out), served at their clean URLs
// as the host serves them. Every request that leaves the local server is
// aborted, so the audit never waits on the network and reads the pages
// exactly as built: the site loads no third-party script.
//
// The audit fails on any critical or serious violation (test/support's
// `axe-policy`, the policy the console's and the kit's audits judge by). A
// violation today's pages already have is listed below against the open
// issue that tracks it, for the page and width it fails at, and fails once
// it is fixed, so its line comes off in the fix's pull request.
//
// The pages are a sample, one per page shape that has carried a defect or
// is likely to: a defect on a shape none of them has ships unseen, so a
// shape that turns one up joins the list.
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { AXE_TAGS, describeJudgement, judgeAxe, type KnownViolation } from "@stigmer/test-support/axe-policy";

/** The pages audited, and why each is in the sample. */
const PAGES = [
  { path: "/", why: "the home page: the site's own layout, not the docs'" },
  { path: "/docs", why: "the docs' landing page and its navigation" },
  { path: "/docs/getting-started/quickstart", why: "a guide with many code blocks, each a scroll region a keyboard must reach" },
  { path: "/docs/sdk/ink", why: "a reference with wide tables, each a scroll region a keyboard must reach" },
  { path: "/docs/cli/commands/agent", why: "a page generated from the CLI's own help, not written by hand" },
  { path: "/blog", why: "the blog's index of posts" },
  { path: "/blog/infrastructure-as-yaml", why: "a blog post, the blog's own layout" },
] as const;

type PagePath = (typeof PAGES)[number]["path"];

/** The widths the config's projects audit at. */
const PROJECTS = ["narrow", "wide"] as const;

type Project = (typeof PROJECTS)[number];

/** The small grey labels (`text-subtle`): the home and blog pages' footer, and across the home page. */
const SUBTLE_LABELS: KnownViolation = { rule: "color-contrast", issue: "stigmer#2574" };
/** The home page's "How it fits" picture: its unlit boxes' detail lines. */
const PICTURE_DETAILS: KnownViolation = { rule: "color-contrast", issue: "stigmer#3386" };
/** The home page's code samples, which scroll but take no focus. */
const HOME_CODE_SAMPLES: KnownViolation = { rule: "scrollable-region-focusable", issue: "stigmer#3384" };
/** The quickstart's "On your machine" tab, whose id holds a space. */
const QUICKSTART_TAB_ID: KnownViolation = { rule: "aria-valid-attr-value", issue: "stigmer#3385" };

/**
 * The rules each page fails today, at each width, against the issue that
 * tracks each. A rule is judged per page, not per element, so a rule two
 * issues share on one page is listed once for each and passes as known
 * until both are fixed; it fails as stale once neither fails.
 */
const KNOWN_VIOLATIONS: Readonly<Partial<Record<`${PagePath} ${Project}`, readonly KnownViolation[]>>> = {
  "/ narrow": [SUBTLE_LABELS, PICTURE_DETAILS, HOME_CODE_SAMPLES],
  "/ wide": [SUBTLE_LABELS, PICTURE_DETAILS, HOME_CODE_SAMPLES],
  "/docs/getting-started/quickstart narrow": [QUICKSTART_TAB_ID],
  "/docs/getting-started/quickstart wide": [QUICKSTART_TAB_ID],
  "/blog narrow": [SUBTLE_LABELS],
  "/blog wide": [SUBTLE_LABELS],
  "/blog/infrastructure-as-yaml narrow": [SUBTLE_LABELS],
  "/blog/infrastructure-as-yaml wide": [SUBTLE_LABELS],
};

test.describe("every sampled page of the built site passes the accessibility audit", () => {
  for (const { path } of PAGES) {
    test(`${path} passes the accessibility audit`, async ({ page, baseURL }) => {
      const project = test.info().project.name as Project;
      const origin = new URL(baseURL ?? "").origin;
      await page.route("**/*", (route) => (new URL(route.request().url()).origin === origin ? route.continue() : route.abort()));

      const response = await page.goto(path, { waitUntil: "load" });
      expect(response?.status(), `${path} is not in the export`).toBe(200);
      await page.evaluate(() => document.fonts.ready.then(() => undefined));

      const results = await new AxeBuilder({ page }).withTags([...AXE_TAGS]).analyze();
      const judged = judgeAxe(results.violations, KNOWN_VIOLATIONS[`${path} ${project}`]);
      const report = describeJudgement(judged);
      if (report !== "") console.log(`[axe: ${path} ${project}]\n${report}`);
      expect(judged.failing, `critical or serious violations:\n${report}`).toEqual([]);
      expect(judged.stale, `listed violations that no longer occur:\n${report}`).toEqual([]);
    });
  }

  test("every listed violation names a page and width the suite audits", () => {
    expect(test.info().config.projects.map((p) => p.name).sort(), "the widths here are the config's projects").toEqual([...PROJECTS].sort());
    const audited = new Set(PAGES.flatMap(({ path }) => PROJECTS.map((project) => `${path} ${project}`)));
    expect(Object.keys(KNOWN_VIOLATIONS).filter((key) => !audited.has(key))).toEqual([]);
  });
});
