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
 *     ("task-types.mdx" beside "task-types/"), and folder indexes omitted from
 *     a `pages` allowlist are resolved the way Fumadocs resolves them.
 *   - `[Label](url)` link entries carry a custom sidebar label for a page
 *     (e.g. "[Welcome](/docs)", "[Overview](/docs/guides/workflows)"). When
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
 */
export function cleanContent(raw: string): string {
  return (
    raw
      // Lines starting with import or export are build-time directives, not content.
      .replace(/^import\s+.*$/gm, "")
      .replace(/^export\s+.*$/gm, "")
      // MDX comments add no value for readers.
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
      // Collapse runs of blank lines left by the above removals.
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
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
 * ("[Overview](/docs/guides/workflows)" → "guides/workflows"; "[Welcome](/docs)"
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
    content: cleanContent(content),
    url: toUrl(ctx, relativePath),
    topSection,
    topSectionTitle,
  };
}

/**
 * Resolves a single meta.json `pages` entry to its pages, mirroring Fumadocs:
 * a name can be a page file, a folder, or BOTH at once (e.g. "task-types.mdx"
 * beside "task-types/" — the file is the folder's index page and the folder's
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

  return pages;
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
