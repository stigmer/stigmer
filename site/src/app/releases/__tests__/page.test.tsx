/**
 * The `/releases` route: its metadata, and the page drawn from a saved copy
 * of GitHub's releases list (lib/__tests__/__fixtures__/releases.json, named
 * through `STIGMER_RELEASES_FILE` as the website's build names its own), so
 * the test reads what the build reads and never reaches the network.
 *
 * Pinned: every published release is listed newest first under its tag's
 * anchor, only the newest is marked "Latest", a release that opens a minor
 * line is set larger than a patch, the upgrade notes sit folded under a line
 * that counts them, each release links its full notes, and a list with
 * nothing published fails the page instead of drawing it empty. The layout
 * frames the page with the site's header and footer.
 */
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, within } from "@testing-library/react";
import { FOOTER_LINKS, NAV_RESOURCES } from "@/lib/constants";
import { RELEASES_FILE_ENV } from "@/lib/releases";
import ReleasesLayout from "../layout";
import ReleasesPage, { metadata } from "../page";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(HERE, "../../../lib/__tests__/__fixtures__/releases.json");

/** The visible words, with runs of whitespace as one space. */
const words = (element: Element | null) => element?.textContent?.replace(/\s+/g, " ").trim();

async function page(): Promise<HTMLElement> {
  return render(await ReleasesPage()).container;
}

const release = (container: HTMLElement, tag: string): HTMLElement => {
  const article = container.querySelector<HTMLElement>(`article[id="${tag}"]`);
  if (!article) throw new Error(`no release ${tag} on the page`);
  return article;
};

beforeEach(() => {
  vi.stubEnv(RELEASES_FILE_ENV, FIXTURE);
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("/releases route", () => {
  it("is titled Releases and says what the page holds", () => {
    expect(metadata.title).toBe("Releases");
    expect(metadata.description).toBe("What's new in each version of Stigmer, and what to know before you upgrade.");
    expect(metadata.openGraph?.url).toBe("https://stigmer.ai/releases");
  });

  it("is linked from the footer's product column and the header's Resources menu", () => {
    const link = { label: "Releases", href: "/releases" };

    expect(FOOTER_LINKS.product).toContainEqual(link);
    expect(NAV_RESOURCES.items).toContainEqual(link);
  });

  it("names itself in the display face and says how to move to the latest release", async () => {
    const container = await page();
    const titles = [...container.querySelectorAll("h1")];

    expect(titles.map(words)).toEqual(["Releases"]);
    expect(titles[0].classList.contains("font-display")).toBe(true);
    expect(words(container)).toContain(
      "On an earlier version? Run npm install -g @stigmer/cli again, or brew upgrade stigmer (Homebrew follows about a day after a release), then stigmer up. The latest is 0.3.1.",
    );
  });

  it("lists every published release newest first, each under its tag's anchor", async () => {
    const container = await page();
    const articles = [...container.querySelectorAll("article")];

    expect(articles.map((article) => article.id)).toEqual(["v0.3.1", "v0.3.0", "v0.2.0", "v0.1.2", "v0.1.0"]);
    expect(articles.map((article) => words(article.querySelector("h2 a")))).toEqual([
      "0.3.1",
      "0.3.0",
      "0.2.0",
      "0.1.2",
      "0.1.0",
    ]);
    expect(articles.map((article) => article.querySelector("h2 a")?.getAttribute("href"))).toEqual([
      "#v0.3.1",
      "#v0.3.0",
      "#v0.2.0",
      "#v0.1.2",
      "#v0.1.0",
    ]);
    expect(words(container)).not.toMatch(/release candidate|A draft/);
  });

  it("marks only the newest release as the latest", async () => {
    const container = await page();

    expect(within(container).getAllByText("Latest")).toHaveLength(1);
    expect(within(release(container, "v0.3.1")).getByText("Latest").closest("h2")).not.toBeNull();
  });

  it("dates each release by its publish day in UTC, wherever the build runs", async () => {
    // 01:32 UTC on the 22nd is still the 21st in Los Angeles.
    vi.stubEnv("TZ", "America/Los_Angeles");
    expect(new Date("2026-11-22T01:32:30Z").getDate(), "the test's own zone took effect").toBe(21);

    const container = await page();
    const time = release(container, "v0.3.1").querySelector("time");

    expect(time?.textContent).toBe("November 22, 2026");
    expect(time?.getAttribute("datetime")).toBe("2026-11-22T01:32:30Z");
  });

  it("sets a release that opens a minor line larger than a patch", async () => {
    const container = await page();
    const heading = (tag: string) => release(container, tag).querySelector("h2")?.className ?? "";

    expect(heading("v0.3.0")).toContain("text-[1.75rem]");
    expect(heading("v0.3.0")).not.toContain("text-muted-foreground");
    expect(heading("v0.3.1")).toContain("text-xl");
    expect(heading("v0.3.1")).toContain("text-muted-foreground");
  });

  it("shows a release's Highlights as written, without its pull request numbers", async () => {
    const container = await page();
    const minor = release(container, "v0.3.0");

    expect(words(minor.querySelector("strong"))).toBe("Kubernetes has one install: the Stigmer operator.");
    expect(words(minor)).toContain("then declare one Stigmer resource. Agent Substrate sandboxes keep their work");
    expect(words(minor)).not.toMatch(/#\d|\*\*|`/);
    expect(words(minor)).not.toContain("feat(operator)");
  });

  it("folds the upgrade notes under a line that counts the top-level ones", async () => {
    const container = await page();
    const summary = (tag: string) => words(release(container, tag).querySelector("details > summary"));

    expect(summary("v0.3.0")).toBe("3 things to know before you upgrade");
    expect(summary("v0.2.0")).toBe("3 things to know before you upgrade");
    expect(summary("v0.1.2")).toBe("2 things to know before you upgrade");
    expect(summary("v0.1.0")).toBe("1 thing to know before you upgrade");
    expect(release(container, "v0.3.0").querySelector("details")?.hasAttribute("open")).toBe(false);
    expect(release(container, "v0.3.0").querySelectorAll("details ul > li")).toHaveLength(5);
    expect(release(container, "v0.3.0").querySelectorAll("details ul ul > li")).toHaveLength(2);
  });

  it("draws no upgrade notes for a release whose notes have none", async () => {
    const container = await page();

    expect(release(container, "v0.3.1").querySelector("details")).toBeNull();
  });

  it("links each release's full notes on GitHub", async () => {
    const container = await page();
    const links = [...container.querySelectorAll("article")].map((article) =>
      within(article).getByText(/^Full release notes on GitHub/).closest("a")?.getAttribute("href"),
    );

    expect(links).toEqual(
      ["v0.3.1", "v0.3.0", "v0.2.0", "v0.1.2", "v0.1.0"].map(
        (tag) => `https://github.com/stigmer/stigmer/releases/tag/${tag}`,
      ),
    );
  });

  it("heads upgrade notes written without bullets by a line with no count", async () => {
    const file = path.resolve(HERE, "__fixtures__/upgrading-in-words.json");
    vi.stubEnv(RELEASES_FILE_ENV, file);

    const container = await page();
    const only = release(container, "v9.9.9");

    expect(words(only.querySelector("details > summary"))).toBe("What to know before you upgrade");
    expect(words(only.querySelector("details"))).toContain("Nothing to change.");
    expect(only.querySelectorAll("p, ul")).toHaveLength(1);
  });

  it("fails instead of drawing an empty page when no release is published", async () => {
    vi.stubEnv(RELEASES_FILE_ENV, path.resolve(HERE, "__fixtures__/none-published.json"));

    await expect(ReleasesPage()).rejects.toThrow("No published release in the list read from");
  });
});

describe("/releases layout", () => {
  it("frames the page with the site's header and footer", () => {
    const { container } = render(
      <ReleasesLayout>
        <p>The page.</p>
      </ReleasesLayout>,
    );

    expect(words(container.querySelector("main"))).toBe("The page.");
    expect(container.querySelector("header")).not.toBeNull();
    expect(within(container.querySelector<HTMLElement>("footer")!).getByText("Releases").getAttribute("href")).toBe(
      "/releases",
    );
  });
});
