/**
 * The releases the Releases page lists, read from GitHub Releases when the
 * site builds, so a release's notes stay the one copy of its news.
 *
 * Where the list comes from: the file `STIGMER_RELEASES_FILE` names (the
 * GitHub REST "list releases" array, saved as JSON; a relative path is read
 * from the directory the build runs in), or else GitHub's public API, read
 * with no token. The website's CI saves the file with its own read token in a
 * step of its own (.github/workflows/build.website.yaml), because a runner
 * shares its address's small unauthenticated allowance with every other job
 * on it, and that keeps the token out of the step that runs the site's
 * dependencies.
 *
 * A read that fails, answers with an error, or holds no published release
 * throws, naming what failed: a build stops instead of shipping an empty
 * page. That is the opposite of `fetchDesktopRelease` (constants.ts), which
 * runs in a visitor's browser and falls back to a link.
 *
 * Each release shows two sections of its notes, `## Highlights` and
 * `## Upgrading`, as Markdown (release-notes.tsx renders them). The pull
 * request numbers that close a line are dropped from the shown text; they
 * stay in the full notes the page links.
 */
import { readFile } from "node:fs/promises";
import { SITE_CONFIG } from "@/lib/constants";

/** One published release, as the Releases page shows it. */
export interface Release {
  /** The git tag ("v0.3.0"): the entry's anchor on the page. */
  tag: string;
  /** The tag without its leading "v". */
  version: string;
  /** Whether the release opens a minor line (x.y.0), which the page sets larger. */
  minor: boolean;
  /** When it was published, as GitHub's ISO 8601 timestamp. */
  publishedAt: string;
  /** The release's page on GitHub, with the full notes. */
  url: string;
  /** The Highlights section's Markdown, or null when the notes have none. */
  highlights: string | null;
  /** The Upgrading section's Markdown, or null when the notes have none. */
  upgrading: string | null;
}

/** The variable that names a saved copy of the releases list. */
export const RELEASES_FILE_ENV = "STIGMER_RELEASES_FILE";

/** GitHub's largest page; a shorter answer is the last one. */
const PAGE_SIZE = 100;

const RELEASES_API = `https://api.github.com/repos/${SITE_CONFIG.githubOrg}/${SITE_CONFIG.githubRepo}/releases`;

/**
 * A closing group of pull request numbers with the space before it:
 * " (#3394)", " (#3356, #3362)". The look-behind starts a match only where a
 * run of spaces begins, so a long run is read once, not once per space.
 */
const PULL_REQUEST_REFS = /(?<![ \t])[ \t]*\((?:#\d+(?:,\s*)?)+\)/g;

/** The shown text of a section: its Markdown without the pull request numbers. */
export function withoutPullRequestRefs(markdown: string): string {
  return markdown.replace(PULL_REQUEST_REFS, "");
}

/**
 * One `## <name>` section of a release's notes: everything under the heading
 * up to the next `## ` heading or the end, trimmed. Null when the notes have
 * no such heading or nothing under it.
 */
export function releaseSection(body: string, name: string): string | null {
  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  const start = lines.findIndex((line) => line.trimEnd() === `## ${name}`);
  if (start === -1) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("## "));
  const section = (end === -1 ? rest : rest.slice(0, end)).join("\n").trim();
  return section === "" ? null : section;
}

/** How many notes an Upgrading section holds: its top-level bullets. */
export function upgradeNoteCount(upgrading: string): number {
  return upgrading.split("\n").filter((line) => line.startsWith("- ")).length;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A field every published release carries; `source` names where the list was read. */
function text(entry: Record<string, unknown>, field: string, index: number, source: string): string {
  const value = entry[field];
  if (typeof value !== "string" || value === "") {
    throw new Error(`The releases read from ${source} are not GitHub's list: entry ${index} has no "${field}".`);
  }
  return value;
}

/**
 * The published releases in GitHub's "list releases" answer, newest first.
 * Drafts and pre-releases are left out. Throws when the answer is not that
 * list or holds no published release; `source` names where it was read.
 */
export function parseReleases(raw: unknown, source: string): Release[] {
  if (!Array.isArray(raw)) {
    throw new Error(`The releases read from ${source} are not GitHub's list: expected a JSON array.`);
  }

  const releases = raw.flatMap((entry: unknown, index): Release[] => {
    if (!isRecord(entry)) {
      throw new Error(`The releases read from ${source} are not GitHub's list: entry ${index} is not an object.`);
    }
    if (entry.draft === true || entry.prerelease === true) return [];

    const tag = text(entry, "tag_name", index, source);
    const publishedAt = text(entry, "published_at", index, source);
    if (Number.isNaN(Date.parse(publishedAt))) {
      throw new Error(`The releases read from ${source} are not GitHub's list: ${tag} was published at "${publishedAt}".`);
    }
    const version = tag.replace(/^v/, "");
    const body = typeof entry.body === "string" ? entry.body : "";
    const section = (name: string) => {
      const found = releaseSection(body, name);
      return found === null ? null : withoutPullRequestRefs(found);
    };

    return [
      {
        tag,
        version,
        minor: /^\d+\.\d+\.0$/.test(version),
        publishedAt,
        url: text(entry, "html_url", index, source),
        highlights: section("Highlights"),
        upgrading: section("Upgrading"),
      },
    ];
  });

  if (releases.length === 0) {
    throw new Error(`No published release in the list read from ${source}, so the Releases page would be empty.`);
  }
  return releases.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function readReleasesFile(file: string): Promise<unknown> {
  let content: string;
  try {
    content = await readFile(file, "utf8");
  } catch (error) {
    throw new Error(`Could not read the releases file ${file} (${RELEASES_FILE_ENV}): ${reason(error)}`);
  }
  try {
    return JSON.parse(content);
  } catch (error) {
    throw new Error(`The releases file ${file} (${RELEASES_FILE_ENV}) is not JSON: ${reason(error)}`);
  }
}

/** Every page of GitHub's list, read with no token. */
async function fetchReleases(): Promise<unknown> {
  const hint = `To build without this read, save the list to a file and name it in ${RELEASES_FILE_ENV}.`;
  const all: unknown[] = [];
  for (let page = 1; ; page += 1) {
    const url = `${RELEASES_API}?per_page=${PAGE_SIZE}&page=${page}`;
    let response: Response;
    try {
      response = await fetch(url, { headers: { Accept: "application/vnd.github.v3+json" } });
    } catch (error) {
      throw new Error(`Could not read the releases from ${url}: ${reason(error)}. ${hint}`);
    }
    if (!response.ok) {
      throw new Error(`Could not read the releases from ${url}: GitHub answered ${response.status}. ${hint}`);
    }
    let releases: unknown;
    try {
      releases = await response.json();
    } catch (error) {
      throw new Error(`Could not read the releases from ${url}: the answer is not JSON (${reason(error)}). ${hint}`);
    }
    // Anything but a list is handed on as it is, for parseReleases to refuse.
    if (!Array.isArray(releases)) return releases;
    all.push(...releases);
    if (releases.length < PAGE_SIZE) return all;
  }
}

/**
 * The published releases, newest first: from the file `STIGMER_RELEASES_FILE`
 * names when it is set, else from GitHub. Throws when the read fails or finds
 * no published release.
 */
export async function loadReleases(): Promise<Release[]> {
  const file = process.env[RELEASES_FILE_ENV];
  if (file) return parseReleases(await readReleasesFile(file), file);
  return parseReleases(await fetchReleases(), RELEASES_API);
}
