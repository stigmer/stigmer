/**
 * Docs page collection for the LLM-friendly outputs (llms.txt, llms-full.txt,
 * and the per-page .md exports served to the "Copy page as Markdown" button).
 *
 * The walk follows the same meta.json tree semantics as Fumadocs' page-tree
 * builder, so the collected set mirrors the published sidebar:
 *
 *   - `---Group---` separators in the ROOT meta.json define capability groups.
 *     Page refs and folder refs listed after a separator belong to that group,
 *     and the group label becomes the llms.txt section title — the sidebar IA
 *     and llms.txt share one source of truth.
 *   - Root folders (`"root": true` in meta.json — rendered as layout tabs, not
 *     sidebar entries) always form their own sections titled from their
 *     meta.json, regardless of any preceding separator.
 *   - Cross-folder page refs ("concepts/agents"), file+folder hybrids
 *     ("runners.mdx" beside "runners/"), and folder indexes omitted from
 *     a `pages` allowlist are resolved the way Fumadocs resolves them.
 *   - `[Label](url)` link entries carry a custom sidebar label for a page
 *     (e.g. "[Welcome](/docs)", "[Overview](/docs/guides/runners)"). When
 *     the internal target is not collected through any other entry, the walk
 *     resolves and collects it; already-collected targets and external URLs
 *     are skipped.
 *
 * `findUncollectedPages` backstops the walk: every .mdx under docs/ (minus
 * documented exclusions) must be collected, so a silent drop fails the build
 * instead of shipping incomplete llms outputs.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import matter from "gray-matter";
import { SHOWN_SCALE, screenPath, shownScreen } from "./screens";

export interface SectionMeta {
  title?: string;
  root?: boolean;
  pages?: string[];
}

export interface DocsPageEntry {
  /** Path relative to docs/, with .mdx and /index stripped (e.g. "concepts/agents"). */
  relativePath: string;
  title: string;
  description: string;
  /** Cleaned markdown content (frontmatter, imports, comments removed). */
  content: string;
  /** Absolute URL on the live site. */
  url: string;
  /** Section slug (e.g. "agents", "sdk"). Empty for the root index page. */
  topSection: string;
  /** Section display title (e.g. "Agents", "SDK"). */
  topSectionTitle: string;
}

// ---------------------------------------------------------------------------
// Filesystem helpers
// ---------------------------------------------------------------------------

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function isDirectory(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isDirectory();
  } catch {
    return false;
  }
}

async function readJson<T>(p: string): Promise<T> {
  return JSON.parse(await fs.readFile(p, "utf-8")) as T;
}

// ---------------------------------------------------------------------------
// Content cleaning
// ---------------------------------------------------------------------------

/**
 * Strips MDX/JSX authoring noise while preserving semantically useful
 * component tags that LLMs can interpret (Callout, Tabs, Term, etc.).
 * A `<Screen>` becomes the markdown image it stands for, linked on
 * `siteUrl` (see `screensToMarkdown`).
 */
export function cleanContent(raw: string, siteUrl: string): string {
  const cleaned = raw
    // Lines starting with import or export are build-time directives, not content.
    .replace(/^import\s+.*$/gm, "")
    .replace(/^export\s+.*$/gm, "")
    // MDX comments add no value for readers.
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
  return (
    screensToMarkdown(cleaned, siteUrl)
      // Collapse runs of blank lines left by the above removals.
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

/** Where a `<Screen>` tag starts; `SCREEN_TAG` then reads the whole tag from there. */
const SCREEN_START = /<Screen(?![\w.])/g;

/** A whole `<Screen>` tag: attributes, each bare or with a quoted or `{…}` value, then its end. */
const SCREEN_TAG = /<Screen((?:\s+[\w-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|\{[^{}]*\}))?)*)\s*(\/?)>/y;

/** One attribute of a `<Screen>` tag: its name, then a double- or single-quoted value, or an `{expression}`. */
const SCREEN_ATTRIBUTE = /([\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|(\{[^{}]*\})))?/g;

/** An inline code span: a run of backticks, then anything up to a run of the same length. */
const CODE_SPAN = /(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)/g;

/**
 * Rewrites every `<Screen name="…" alt="…" />` outside code into
 * `![<alt>](<siteUrl>/screens/<name>-2x.webp)`: the per-page `.md`,
 * llms-full.txt, the "Copy page" button and Ask AI read the alt text where
 * the page shows the picture, and the link resolves off the site. A tag in a
 * fenced block or an inline code span is the component's own syntax shown as
 * code, and stays as written.
 *
 * A tag this cannot turn into an image throws, so the export fails the
 * build instead of shipping a dangling tag: one that is not self-closing,
 * has no `name` or `alt`, gives either as an `{expression}`, has blank alt
 * text, or names a screen the visual suite does not show.
 */
export function screensToMarkdown(text: string, siteUrl: string): string {
  const out: string[] = [];
  let prose: string[] = [];
  let fence: RegExp | null = null;
  const flush = () => {
    if (prose.length > 0) out.push(rewriteScreens(prose.join("\n"), siteUrl));
    prose = [];
  };
  for (const line of text.split("\n")) {
    if (fence) {
      out.push(line);
      if (fence.test(line)) fence = null;
      continue;
    }
    const open = /^\s*(`{3,}|~{3,})/.exec(line);
    if (open) {
      flush();
      out.push(line);
      fence = new RegExp(`^\\s*\\${open[1][0]}{${open[1].length},}\\s*$`);
      continue;
    }
    prose.push(line);
  }
  flush();
  return out.join("\n");
}

function rewriteScreens(prose: string, siteUrl: string): string {
  const code = [...prose.matchAll(CODE_SPAN)].map((span) => [span.index, span.index + span[0].length] as const);
  let out = "";
  let from = 0;
  for (const start of prose.matchAll(SCREEN_START)) {
    if (code.some(([open, close]) => start.index > open && start.index < close)) continue;
    SCREEN_TAG.lastIndex = start.index;
    const tag = SCREEN_TAG.exec(prose);
    const written = () => prose.slice(start.index, start.index + 80).replace(/\s+/g, " ");
    if (!tag) throw new Error(`a <Screen> tag the markdown export cannot read: "${written()}"`);
    if (tag[2] !== "/") throw new Error(`a <Screen> tag must close itself (<Screen … />): "${written()}"`);
    const attributes = new Map<string, string | null>();
    for (const [, key, double, single, expression] of tag[1].matchAll(SCREEN_ATTRIBUTE)) {
      attributes.set(key, expression === undefined ? (double ?? single ?? "") : null);
    }
    const name = attributes.get("name");
    const alt = attributes.get("alt");
    if (typeof name !== "string" || typeof alt !== "string") {
      throw new Error(`a <Screen> tag needs name="…" and alt="…" as plain strings, which the export carries: "${written()}"`);
    }
    if (alt.trim() === "") throw new Error(`<Screen name="${name}">: alt text is required; the export carries it in the picture's place`);
    shownScreen(name);
    out += `${prose.slice(from, start.index)}![${markdownAlt(alt)}](${siteUrl}${screenPath(name, SHOWN_SCALE)})`;
    from = start.index + tag[0].length;
  }
  return out + prose.slice(from);
}

/** Alt text as a markdown image's label: on one line, with the brackets and backslashes that would break the label escaped. */
function markdownAlt(alt: string): string {
  return alt.replace(/\s+/g, " ").trim().replace(/[\\[\]]/g, "\\$&");
}

// ---------------------------------------------------------------------------
// meta.json entry classification
// ---------------------------------------------------------------------------

/** Returns true for separator entries like "---Agents---". */
export function isSeparator(entry: string): boolean {
  return entry.startsWith("---") && entry.endsWith("---");
}

/** Extracts the label from a "---Label---" separator entry. */
export function separatorLabel(entry: string): string {
  return entry.slice(3, -3).trim();
}

/** Returns true for Fumadocs link entries like "[Welcome](/docs)". */
export function isLinkEntry(entry: string): boolean {
  return /^(\[[^\]]*\])?\[[^\]]*\]\([^)]*\)$/.test(entry);
}

/**
 * Extracts the docs-relative path from an internal link entry
 * ("[Overview](/docs/guides/runners)" → "guides/runners"; "[Welcome](/docs)"
 * → ""). Returns null for external or non-docs URLs.
 */
export function linkTargetRelativePath(entry: string): string | null {
  const match = /\(([^)]*)\)$/.exec(entry);
  if (!match) return null;
  const url = match[1];
  if (url === "/docs") return "";
  if (url.startsWith("/docs/")) return url.slice("/docs/".length).replace(/\/$/, "");
  return null;
}

/**
 * Public URL of a page's markdown export, given its site-relative page URL.
 * Mirrors the write layout in scripts/generate-llms-txt.ts: every page
 * exports to `<url>.md`, except the docs root (relativePath "") which the
 * writer lands at `docs/index.md` — `/docs.md` does not exist.
 */
export function markdownExportUrl(pageUrl: string): string {
  return pageUrl === "/docs" ? "/docs/index.md" : `${pageUrl}.md`;
}

/** Turns a section label into a stable slug (e.g. "Tools & MCP" → "tools-mcp"). */
function sectionSlug(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// ---------------------------------------------------------------------------
// Page collection
// ---------------------------------------------------------------------------

interface CollectContext {
  docsDir: string;
  siteUrl: string;
}

function toUrl(ctx: CollectContext, relativePath: string): string {
  return relativePath ? `${ctx.siteUrl}/docs/${relativePath}` : `${ctx.siteUrl}/docs`;
}

/** `cleanContent` for one page, naming the page when its content cannot be exported. */
function cleanPage(mdxRelPath: string, content: string, siteUrl: string): string {
  try {
    return cleanContent(content, siteUrl);
  } catch (error) {
    throw new Error(`docs/${mdxRelPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function readPage(
  ctx: CollectContext,
  mdxRelPath: string,
  topSection: string,
  topSectionTitle: string,
): Promise<DocsPageEntry | null> {
  const absPath = path.join(ctx.docsDir, mdxRelPath);
  if (!(await pathExists(absPath))) return null;

  const raw = await fs.readFile(absPath, "utf-8");
  const { data, content } = matter(raw);

  const relativePath = mdxRelPath.replace(/\.mdx$/, "").replace(/(^|\/)index$/, "");

  return {
    relativePath,
    title: (data.title as string) || path.basename(relativePath),
    description: typeof data.description === "string" ? data.description.trim() : "",
    content: cleanPage(mdxRelPath, content, ctx.siteUrl),
    url: toUrl(ctx, relativePath),
    topSection,
    topSectionTitle,
  };
}

/**
 * Resolves a single meta.json `pages` entry to its pages, mirroring Fumadocs:
 * a name can be a page file, a folder, or BOTH at once (e.g. "runners.mdx"
 * beside "runners/" — the file is the folder's index page and the folder's
 * children still belong to the tree).
 */
async function resolveEntry(
  ctx: CollectContext,
  parentDir: string,
  entry: string,
  topSection: string,
  topSectionTitle: string,
): Promise<DocsPageEntry[]> {
  if (entry === "index") {
    const page = await readPage(
      ctx,
      path.join(parentDir, "index.mdx"),
      topSection,
      topSectionTitle,
    );
    return page ? [page] : [];
  }

  const pages: DocsPageEntry[] = [];

  const asFile = path.join(ctx.docsDir, parentDir, `${entry}.mdx`);
  if (await pathExists(asFile)) {
    const page = await readPage(
      ctx,
      path.join(parentDir, `${entry}.mdx`),
      topSection,
      topSectionTitle,
    );
    if (page) pages.push(page);
  }

  const asDir = path.join(ctx.docsDir, parentDir, entry);
  if (await isDirectory(asDir)) {
    const dirRelative = path.join(parentDir, entry);
    if (await pathExists(path.join(asDir, "meta.json"))) {
      pages.push(...(await collectDir(ctx, dirRelative, topSection, topSectionTitle)));
    } else {
      // Folder without meta.json: only its index page participates.
      const page = await readPage(
        ctx,
        path.join(dirRelative, "index.mdx"),
        topSection,
        topSectionTitle,
      );
      if (page) pages.push(page);
    }
  }

  return pages;
}

async function collectDir(
  ctx: CollectContext,
  dirRelative: string,
  topSection: string,
  topSectionTitle: string,
): Promise<DocsPageEntry[]> {
  const meta = await readJson<SectionMeta>(
    path.join(ctx.docsDir, dirRelative, "meta.json"),
  );
  const entries = meta.pages ?? [];
  const pages: DocsPageEntry[] = [];

  // Fumadocs includes a folder's index page even when the `pages` allowlist
  // omits it (`setIndexIfUnused` in the page-tree builder). Mirror that, or
  // folders like sdk/react (generator-owned meta.json without "index") lose
  // their landing page from the llms outputs.
  if (!entries.includes("index")) {
    const indexPage = await readPage(
      ctx,
      path.join(dirRelative, "index.mdx"),
      topSection,
      topSectionTitle,
    );
    if (indexPage) pages.push(indexPage);
  }

  for (const entry of entries) {
    if (isSeparator(entry) || isLinkEntry(entry)) continue;
    pages.push(...(await resolveEntry(ctx, dirRelative, entry, topSection, topSectionTitle)));
  }
  return pages;
}

/**
 * Collects every docs page reachable from the root meta.json, in sidebar
 * order, assigning each page its llms.txt section (see module docs for the
 * sectioning rules).
 */
export async function collectDocsPages(
  docsDir: string,
  siteUrl: string,
): Promise<DocsPageEntry[]> {
  const ctx: CollectContext = { docsDir, siteUrl };
  const rootMeta = await readJson<SectionMeta>(path.join(docsDir, "meta.json"));
  const pages: DocsPageEntry[] = [];

  // The root index page belongs to no section: llms.txt links it in the
  // header, not under a section heading.
  const rootPage = await readPage(ctx, "index.mdx", "", "");
  if (rootPage) pages.push(rootPage);

  const collectedPaths = () => new Set(pages.map((p) => p.relativePath));
  let group: string | null = null;

  for (const entry of rootMeta.pages ?? []) {
    if (isSeparator(entry)) {
      group = separatorLabel(entry);
      continue;
    }
    // Link entries relabel a page in the sidebar. Collect the internal target
    // unless another entry already covers it (e.g. "[Welcome](/docs)" points
    // at the root index collected above).
    if (isLinkEntry(entry)) {
      const target = linkTargetRelativePath(entry);
      if (target !== null && target !== "" && !collectedPaths().has(target)) {
        const topSection = group !== null ? sectionSlug(group) : "docs";
        const topTitle = group ?? "Docs";
        const page =
          (await readPage(ctx, `${target}.mdx`, topSection, topTitle)) ??
          (await readPage(ctx, path.join(target, "index.mdx"), topSection, topTitle));
        if (page) pages.push(page);
      }
      continue;
    }

    // Root folders (SDK, CLI) are layout tabs: always their own section, even
    // when listed after a separator.
    const entryMetaPath = path.join(docsDir, entry, "meta.json");
    if (await pathExists(entryMetaPath)) {
      const entryMeta = await readJson<SectionMeta>(entryMetaPath);
      if (entryMeta.root === true || group === null) {
        const title = entryMeta.title ?? entry;
        pages.push(...(await collectDir(ctx, entry, entry, title)));
        continue;
      }
    }

    if (group !== null) {
      pages.push(...(await resolveEntry(ctx, "", entry, sectionSlug(group), group)));
      continue;
    }

    // Pre-separator page ref without a folder meta.json. No current meta.json
    // shape produces this; resolve it into a generic section so content is
    // never silently dropped.
    pages.push(...(await resolveEntry(ctx, "", entry, "docs", "Docs")));
  }

  // A link entry that names a page before its folder is listed (the Get
  // Started group's link to the self-hosting overview) collects it first; the
  // folder then reaches it again. Each page is listed once, where the sidebar
  // first shows it.
  const seen = new Set<string>();
  return pages.filter((page) => {
    if (seen.has(page.relativePath)) return false;
    seen.add(page.relativePath);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Coverage check
// ---------------------------------------------------------------------------

/**
 * Returns the relativePaths of .mdx files under docsDir that the collector
 * did not pick up, minus the explicit exclusions. A non-empty result means
 * pages would silently vanish from llms.txt and the per-page .md exports —
 * callers should fail the build.
 *
 * `_archive/**` is skipped to mirror the Fumadocs content collection
 * (`!_archive/**` in source.config.ts).
 */
export async function findUncollectedPages(
  docsDir: string,
  collected: DocsPageEntry[],
  exclusions: readonly string[],
): Promise<string[]> {
  const collectedPaths = new Set(collected.map((p) => p.relativePath));
  const excluded = new Set(exclusions);
  const missing: string[] = [];

  async function walk(dirRelative: string): Promise<void> {
    const dirents = await fs.readdir(path.join(docsDir, dirRelative), {
      withFileTypes: true,
    });
    for (const dirent of dirents) {
      const rel = dirRelative ? `${dirRelative}/${dirent.name}` : dirent.name;
      if (dirent.isDirectory()) {
        if (rel === "_archive") continue;
        await walk(rel);
      } else if (dirent.name.endsWith(".mdx")) {
        const relativePath = rel.replace(/\.mdx$/, "").replace(/(^|\/)index$/, "");
        if (!collectedPaths.has(relativePath) && !excluded.has(relativePath)) {
          missing.push(relativePath);
        }
      }
    }
  }

  await walk("");
  return missing.sort();
}
