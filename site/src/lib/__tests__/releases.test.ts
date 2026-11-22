/**
 * The releases the Releases page lists (lib/releases.ts): which entries of
 * GitHub's list are shown and in what order, which words of each release's
 * notes are shown, and that a read with nothing to show throws instead of
 * handing the page an empty list.
 *
 * The fixture is GitHub's "list releases" answer cut down to trimmed notes of
 * real releases, out of order, with a draft and a pre-release among them; one
 * entry's notes use CRLF line endings, as GitHub stores notes edited in the
 * browser. The network is never reached: `fetch` is replaced where the read
 * from GitHub is tested.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  loadReleases,
  parseReleases,
  releaseSection,
  RELEASES_FILE_ENV,
  upgradeNoteCount,
  withoutPullRequestRefs,
} from "@/lib/releases";

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), "__fixtures__/releases.json");
const LIST: unknown[] = JSON.parse(fs.readFileSync(FIXTURE, "utf8"));

const API = "https://api.github.com/repos/stigmer/stigmer/releases";

/** One published entry of GitHub's list, with the given fields changed. */
const entry = (fields: Record<string, unknown> = {}) => ({
  tag_name: "v1.2.3",
  draft: false,
  prerelease: false,
  published_at: "2026-11-22T08:00:00Z",
  html_url: "https://github.com/stigmer/stigmer/releases/tag/v1.2.3",
  body: "## Highlights\n\nWords.\n",
  ...fields,
});

const answer = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** A scratch file holding `content`, removed after the test. */
const scratch: string[] = [];
function fileHolding(content: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "releases-test-"));
  scratch.push(dir);
  const file = path.join(dir, "releases.json");
  fs.writeFileSync(file, content);
  return file;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  for (const dir of scratch.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("releaseSection", () => {
  const body = ["## Install", "", "npm", "", "## Highlights", "", "First.", "", "### A part", "", "Second.", "", "## Upgrading", "", "- One."].join("\n");

  it("takes a section up to the next second-level heading, keeping deeper headings", () => {
    expect(releaseSection(body, "Highlights")).toBe("First.\n\n### A part\n\nSecond.");
  });

  it("takes the last section to the end of the notes", () => {
    expect(releaseSection(body, "Upgrading")).toBe("- One.");
  });

  it("reads notes written with CRLF line endings", () => {
    expect(releaseSection(body.replaceAll("\n", "\r\n"), "Highlights")).toBe("First.\n\n### A part\n\nSecond.");
  });

  it.each([
    ["the notes have no such heading", "## Install\n\nnpm\n"],
    ["the heading only starts with the name", "## Upgrading from 0.1\n\n- One.\n"],
    ["the heading is at another level", "### Upgrading\n\n- One.\n"],
    ["nothing is written under it", "## Upgrading\n\n## What's Changed\n\n- x\n"],
    ["the notes are empty", ""],
  ])("is null when %s", (_why, notes) => {
    expect(releaseSection(notes, "Upgrading")).toBeNull();
  });
});

describe("withoutPullRequestRefs", () => {
  it.each([
    ["one number closing a line", "Backups work. (#3416)", "Backups work."],
    ["several numbers in one group", "Sleeps keep work. (#3356, #3362,#3367)", "Sleeps keep work."],
    ["a group on every line", "- One. (#1)\n  - Two. (#2, #3)\n- Three. (#4)", "- One.\n  - Two.\n- Three."],
    ["a group before a blank line", "First. (#1)\n\nSecond.", "First.\n\nSecond."],
  ])("drops %s", (_what, shown, expected) => {
    expect(withoutPullRequestRefs(shown)).toBe(expected);
  });

  it.each([
    ["words in brackets", "up to `WAIT` (900 by default)."],
    ["a path in brackets", "one resource (docs/guides/self-hosting/kubernetes.mdx)."],
    ["a number outside brackets", "tracked in #2001."],
    ["a bracket that holds more than numbers", "see (#12 and the guide)."],
  ])("keeps %s", (_what, shown) => {
    expect(withoutPullRequestRefs(shown)).toBe(shown);
  });
});

describe("withoutPullRequestRefs on a long run of spaces", () => {
  it("reads the run once: a release body's worth of spaces takes no noticeable time", () => {
    const spaces = " ".repeat(125_000);
    const started = performance.now();

    expect(withoutPullRequestRefs(`One.${spaces}(#1)\nTwo.${spaces}end`)).toBe(`One.\nTwo.${spaces}end`);
    // Read once per space it took 24 seconds; read once it takes milliseconds.
    expect(performance.now() - started).toBeLessThan(2_000);
  });
});

describe("upgradeNoteCount", () => {
  it("counts the top-level bullets, not the ones nested under them or wrapped lines", () => {
    expect(upgradeNoteCount("- One\n  wrapped - not a bullet\n  - nested\n  - nested\n- Two\n\n- Three")).toBe(3);
  });

  it("counts none in a section written as paragraphs", () => {
    expect(upgradeNoteCount("Nothing to do.\n\nReally - nothing.")).toBe(0);
  });
});

describe("parseReleases", () => {
  const releases = parseReleases(LIST, "the fixture");

  it("lists the published releases newest first, without drafts or pre-releases", () => {
    expect(releases.map((release) => release.tag)).toEqual(["v0.3.1", "v0.3.0", "v0.2.0", "v0.1.2", "v0.1.0"]);
  });

  it("gives each release its version, date and address", () => {
    expect(releases[0]).toMatchObject({
      tag: "v0.3.1",
      version: "0.3.1",
      publishedAt: "2026-11-22T01:32:30Z",
      url: "https://github.com/stigmer/stigmer/releases/tag/v0.3.1",
    });
  });

  it("marks only the releases that open a minor line", () => {
    expect(releases.filter((release) => release.minor).map((release) => release.version)).toEqual([
      "0.3.0",
      "0.2.0",
      "0.1.0",
    ]);
  });

  it.each([
    ["v1.0.0", true],
    ["v0.10.0", true],
    ["v0.3.10", false],
    ["v0.3.0-rc.1", false],
    ["nightly", false],
  ])("reads %s as a minor release: %s", (tag, minor) => {
    expect(parseReleases([entry({ tag_name: tag })], "a test")[0].minor).toBe(minor);
  });

  it("shows the Highlights and Upgrading sections and nothing of the rest", () => {
    const first = releases.find((release) => release.tag === "v0.1.0");

    expect(first?.highlights).toMatch(/^This is the first release of Stigmer/);
    expect(first?.highlights).toMatch(/quickstart$/);
    expect(first?.upgrading).toBe(
      "- 0.1.0 starts a new version line. The 3.x releases are deprecated, and 0.1.0 does not read their data, so start from a fresh install rather than upgrading one.",
    );
    expect(first?.highlights).not.toContain("npm install");
    expect(first?.upgrading).not.toContain("first release (#12)");
  });

  it("drops the pull request numbers from the shown sections", () => {
    const minor = releases.find((release) => release.tag === "v0.3.0");

    expect(minor?.highlights).toMatch(/one `Stigmer` resource\.\n\n/);
    expect(minor?.upgrading).toMatch(/`PLUGIN_LABEL`\.\n/);
    expect(`${minor?.highlights}${minor?.upgrading}`).not.toMatch(/#\d/);
  });

  it("has no Upgrading section for a release whose notes have none", () => {
    expect(releases[0].upgrading).toBeNull();
  });

  it("has neither section for a release with no notes", () => {
    expect(parseReleases([entry({ body: null })], "a test")[0]).toMatchObject({ highlights: null, upgrading: null });
  });

  it("orders by publish time, not by the order or the names in the list", () => {
    const list = [
      entry({ tag_name: "v0.9.0", published_at: "2026-01-01T00:00:00Z" }),
      entry({ tag_name: "v0.10.0", published_at: "2026-03-01T00:00:00Z" }),
      entry({ tag_name: "v0.9.1", published_at: "2026-02-01T00:00:00+05:30" }),
    ];

    expect(parseReleases(list, "a test").map((release) => release.tag)).toEqual(["v0.10.0", "v0.9.1", "v0.9.0"]);
  });

  it.each([
    ["an empty list", []],
    ["only drafts and pre-releases", [entry({ draft: true, published_at: null }), entry({ prerelease: true })]],
  ])("throws on %s, naming where it was read", (_what, list) => {
    expect(() => parseReleases(list, "/tmp/releases.json")).toThrow(
      "No published release in the list read from /tmp/releases.json, so the Releases page would be empty.",
    );
  });

  it.each([
    ["an error object, as GitHub answers a refused read", { message: "API rate limit exceeded" }, "expected a JSON array"],
    ["an entry that is not an object", [entry(), "v0.1.0"], "entry 1 is not an object"],
    ["an entry with no tag", [entry({ tag_name: undefined })], 'entry 0 has no "tag_name"'],
    ["a published entry with no date", [entry({ published_at: null })], 'entry 0 has no "published_at"'],
    ["a date that is not one", [entry({ published_at: "soon" })], 'v1.2.3 was published at "soon"'],
    ["an entry with no address", [entry({ html_url: "" })], 'entry 0 has no "html_url"'],
  ])("throws on %s", (_what, raw, message) => {
    expect(() => parseReleases(raw, "a test")).toThrow(`The releases read from a test are not GitHub's list: ${message}`);
  });
});

describe("loadReleases", () => {
  it("reads the file the variable names and never asks GitHub", async () => {
    const fetched = vi.fn();
    vi.stubGlobal("fetch", fetched);
    vi.stubEnv(RELEASES_FILE_ENV, FIXTURE);

    const releases = await loadReleases();

    expect(releases.map((release) => release.tag)).toEqual(["v0.3.1", "v0.3.0", "v0.2.0", "v0.1.2", "v0.1.0"]);
    expect(fetched).not.toHaveBeenCalled();
  });

  it("throws when the file holds no release", async () => {
    const file = fileHolding("[]");
    vi.stubEnv(RELEASES_FILE_ENV, file);

    await expect(loadReleases()).rejects.toThrow(`No published release in the list read from ${file}`);
  });

  it("throws when the file is missing, naming it and the variable", async () => {
    const file = path.join(os.tmpdir(), "releases-test-missing", "releases.json");
    vi.stubEnv(RELEASES_FILE_ENV, file);

    await expect(loadReleases()).rejects.toThrow(`Could not read the releases file ${file} (STIGMER_RELEASES_FILE): ENOENT`);
  });

  it("throws when the file is not JSON", async () => {
    const file = fileHolding("[{]");
    vi.stubEnv(RELEASES_FILE_ENV, file);

    await expect(loadReleases()).rejects.toThrow(`The releases file ${file} (STIGMER_RELEASES_FILE) is not JSON: `);
  });

  it("asks GitHub for the repository's releases, with no token, when no file is named", async () => {
    const fetched = vi.fn(async () => answer(LIST));
    vi.stubGlobal("fetch", fetched);
    vi.stubEnv(RELEASES_FILE_ENV, "");

    const releases = await loadReleases();

    expect(releases.map((release) => release.tag)).toEqual(["v0.3.1", "v0.3.0", "v0.2.0", "v0.1.2", "v0.1.0"]);
    expect(fetched.mock.calls).toEqual([
      [`${API}?per_page=100&page=1`, { headers: { Accept: "application/vnd.github.v3+json" } }],
    ]);
  });

  it("reads on while GitHub answers with full pages", async () => {
    const full = Array.from({ length: 100 }, (_, index) =>
      entry({ tag_name: `v0.0.${index}`, published_at: new Date(Date.UTC(2026, 0, 1 + index)).toISOString() }),
    );
    const fetched = vi.fn(async (url: string) => answer(url.endsWith("page=1") ? full : [entry()]));
    vi.stubGlobal("fetch", fetched);
    vi.stubEnv(RELEASES_FILE_ENV, "");

    const releases = await loadReleases();

    expect(releases).toHaveLength(101);
    expect(releases[0].tag).toBe("v1.2.3");
    expect(fetched.mock.calls.map(([url]) => url)).toEqual([`${API}?per_page=100&page=1`, `${API}?per_page=100&page=2`]);
  });

  it("throws when GitHub refuses the read, with the status and the way to build without it", async () => {
    vi.stubGlobal("fetch", async () => answer({ message: "API rate limit exceeded" }, 403));
    vi.stubEnv(RELEASES_FILE_ENV, "");

    await expect(loadReleases()).rejects.toThrow(
      `Could not read the releases from ${API}?per_page=100&page=1: GitHub answered 403. To build without this read, save the list to a file and name it in STIGMER_RELEASES_FILE.`,
    );
  });

  it("throws when GitHub cannot be reached", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("fetch failed");
    });
    vi.stubEnv(RELEASES_FILE_ENV, "");

    await expect(loadReleases()).rejects.toThrow(
      `Could not read the releases from ${API}?per_page=100&page=1: fetch failed. To build without this read`,
    );
  });

  it("throws when the answer is not JSON, naming the address and the way to build without it", async () => {
    vi.stubGlobal("fetch", async () => new Response("<html>Sign in to the network</html>", { status: 200 }));
    vi.stubEnv(RELEASES_FILE_ENV, "");

    await expect(loadReleases()).rejects.toThrow(
      new RegExp(
        `^Could not read the releases from ${API.replaceAll(".", "\\.")}\\?per_page=100&page=1: the answer is not JSON \\(.+\\)\\. To build without this read, save the list to a file and name it in STIGMER_RELEASES_FILE\\.$`,
      ),
    );
  });

  it("throws when GitHub answers with something that is not a list", async () => {
    vi.stubGlobal("fetch", async () => answer({ message: "Moved" }));
    vi.stubEnv(RELEASES_FILE_ENV, "");

    await expect(loadReleases()).rejects.toThrow(`The releases read from ${API} are not GitHub's list: expected a JSON array.`);
  });

  it("throws when GitHub lists no published release", async () => {
    vi.stubGlobal("fetch", async () => answer([]));
    vi.stubEnv(RELEASES_FILE_ENV, "");

    await expect(loadReleases()).rejects.toThrow(`No published release in the list read from ${API}`);
  });
});
