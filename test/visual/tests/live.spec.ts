// The docs' live demos (src/live.ts), drawn as a docs page frames them: in
// the docs mode (`embed=1`), on the page's own clock, with every request
// off the machine refused.
//
// Each demo must settle and pass the accessibility audit in both modes,
// and leave the browser's storage as it found it: on stigmer.ai that
// storage is the docs site's own. The chat a reader can talk to must answer
// a send with the scripted turn, go on when the reader approves the
// command, and stop when they press Stop, never showing an error; the
// hooks guide's chat must do the same with its own plain controls. A theme
// message from the page's own origin changes the look without a reload.
//
// The pictures themselves are the gallery's screenshots (gallery.spec.ts):
// this spec holds what a reader does with them.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { AXE_TAGS, describeJudgement, judgeAxe } from "@stigmer/test-support/axe-policy";
import { LIVE, LIVE_THEME_MESSAGE, liveUrl, type LiveMode, type LiveTheme } from "../src/live.ts";

/** The address the docs frame `name` at, on the suite's server, which serves the gallery at its root. */
function framed(name: string, theme: LiveTheme): string {
  const url = liveUrl(name, theme);
  return `/${url.slice(url.indexOf("?"))}`;
}

/** Opens `name` as a docs page frames it, after the site wrote its own entry to the browser's storage, and waits for it to settle. */
async function open(page: Page, name: string, mode: LiveMode = "dark"): Promise<void> {
  await page.route(
    (url) => url.hostname !== "localhost" && url.hostname !== "127.0.0.1",
    (route) => route.abort("blockedbyclient"),
  );
  await page.addInitScript(() => {
    if (window.localStorage.getItem("site:theme") === null) window.localStorage.setItem("site:theme", "dark");
  });
  await page.setViewportSize({ width: 900, height: 700 });
  await page.goto(framed(name, { preset: "default", mode, radius: null }));
  await page.waitForFunction(() => window.gallery?.idle === true);
}

/** The site's own storage, as another page of the same origin reads it: the gallery's index, which neither clears nor writes it. */
async function siteStorage(page: Page): Promise<Record<string, string>> {
  const other = await page.context().newPage();
  await other.goto("/");
  const entries = await other.evaluate(() => ({ ...window.localStorage }));
  await other.close();
  return entries;
}

test.describe("KIT-12 the docs show the kit's parts live, drawn by the same code the screenshot check approves", () => {
  for (const demo of LIVE) {
    for (const mode of ["light", "dark"] as const) {
      test(`${demo.name} ${mode} settles, passes the accessibility audit and leaves the site's storage alone`, async ({ page }) => {
        await open(page, demo.name, mode);
        const results = await new AxeBuilder({ page }).withTags([...AXE_TAGS]).analyze();
        const judged = judgeAxe(results.violations, []);
        expect(judged.failing, `critical or serious violations:\n${describeJudgement(judged)}`).toEqual([]);
        expect(await siteStorage(page)).toEqual({ "site:theme": "dark" });
      });
    }
  }

  test("a scene the docs do not embed is refused in the docs mode", async ({ page }) => {
    await page.goto("/?scene=settings-members&mode=dark&embed=1");
    await expect(page.getByRole("heading", { name: "No scene is called “settings-members”" })).toBeVisible();
  });

  test("a theme message from a page on another origin is ignored", async ({ page }) => {
    // A page on another origin (another port is another origin, and a browser
    // lets a local page frame a local one) frames the demo, as any site
    // could, and posts it a well-formed theme message.
    const demo = `http://localhost:4179${framed("chat-popup", { preset: "default", mode: "dark", radius: null })}`;
    await page.route("http://localhost:4180/", (route) =>
      route.fulfill({ contentType: "text/html", body: `<iframe id="demo" src="${demo}" style="width:900px;height:640px"></iframe>` }),
    );
    await page.goto("http://localhost:4180/");
    const frame = page.frameLocator("#demo");
    await frame.locator(".gallery-scene[data-stgm-root]").waitFor();
    await page.evaluate(
      ([type]) => (document.getElementById("demo") as HTMLIFrameElement).contentWindow!.postMessage({ type, preset: "friendly", mode: "light", radius: 1 }, "*"),
      [LIVE_THEME_MESSAGE],
    );
    await page.waitForTimeout(500);
    await expect(frame.locator(".gallery-scene[data-stgm-root]")).not.toHaveClass(/stgm-theme-friendly/);
  });

  test("a theme message from the page's own origin changes the look without a reload", async ({ page }) => {
    await open(page, "chat-popup");
    const scope = page.locator(".gallery-scene[data-stgm-root]");
    await expect(scope).not.toHaveClass(/stgm-theme-friendly/);
    await page.evaluate(() => {
      (window as unknown as { marker: string }).marker = "same document";
    });
    await page.evaluate(
      ([type]) => window.postMessage({ type, preset: "friendly", mode: "light", radius: 1 }, window.location.origin),
      [LIVE_THEME_MESSAGE],
    );
    await expect(scope).toHaveClass(/stgm-theme-friendly/);
    await expect(scope).not.toHaveClass(/\bdark\b/);
    expect(await scope.evaluate((element) => getComputedStyle(element).getPropertyValue("--stgm-radius").trim())).toBe("1rem");
    expect(await page.evaluate(() => (window as unknown as { marker?: string }).marker)).toBe("same document");
  });
});

test.describe("KIT-13 a message sent in a docs demo gets a scripted answer, never an error", () => {
  test("the popup answers a send, goes on when the reader approves, and stops on Stop", async ({ page }) => {
    await open(page, "chat-popup");
    const reply = page.getByRole("textbox", { name: "Reply…" });
    await reply.fill("What changed?");
    await page.getByRole("button", { name: "Send message" }).click();
    await page.getByRole("button", { name: "Approve", exact: true }).click({ timeout: 15_000 });
    await expect(page.getByText(/^Two changes this week/)).toBeVisible({ timeout: 15_000 });

    await reply.fill("And last week?");
    await page.getByRole("button", { name: "Send message" }).click();
    await page.getByRole("button", { name: "Stop generating" }).click();
    await expect(page.getByRole("button", { name: "Send message" })).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
    expect(await siteStorage(page)).toEqual({ "site:theme": "dark" });
  });

  test("the hooks guide's chat answers a send and goes on when the reader allows the command", async ({ page }) => {
    await open(page, "from-hooks");
    await page.getByRole("textbox", { name: "Message" }).fill("What changed?");
    await page.getByRole("button", { name: "Send" }).click();
    await page.getByRole("group", { name: /The agent asks to run git log/ }).getByRole("button", { name: "Allow" }).click({ timeout: 15_000 });
    await expect(page.getByText(/^Two changes this week/)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("alert")).toHaveCount(0);
  });
});
