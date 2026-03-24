/**
 * LLM-Friendly Output Generator
 *
 * Post-build script generating documentation files optimized for LLM consumption:
 *   out/llms.txt       — Curated index following the llms.txt standard
 *   out/llms-full.txt  — All documentation concatenated into one file
 *   out/docs/**\/*.md  — Per-page markdown variants
 *
 * Follows the llms.txt standard: https://llmstxt.org
 *
 * Usage: tsx scripts/generate-llms-txt.ts
 * Runs as part of: yarn build (after next build)
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import matter from "gray-matter";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const SITE_URL = "https://stigmer.ai";
const DOCS_DIR = path.resolve(process.cwd(), "..", "docs");
const OUT_DIR = path.resolve(process.cwd(), "out");

const PROJECT_NAME = "Stigmer";
const PROJECT_DESCRIPTION =
  "Open source platform for building AI agents. Stigmer handles sandboxing, " +
  "orchestration, and MCP security. You write YAML or Go. Agents run " +
  "locally with zero cloud dependency or scale to production.";

/** Top-level sections whose pages belong in the "Optional" llms.txt section. */
const OPTIONAL_SECTIONS = new Set(["contributing"]);

/** Subdirectory paths (relative to docs/) whose non-index pages are optional. */
const OPTIONAL_SUBSECTIONS = new Set(["cli/commands"]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SectionMeta {
  title?: string;
  pages?: string[];
}

interface Page {
  /** Path relative to docs/, with .mdx and /index stripped (e.g. "concepts/agents"). */
  relativePath: string;
  title: string;
  description: string;
  /** Cleaned markdown content (frontmatter, imports, comments removed). */
  content: string;
  /** Absolute URL on the live site. */
  url: string;
  /** Top-level section slug (e.g. "concepts"). Empty for root index. */
  topSection: string;
  /** Display title of the top-level section (e.g. "Core Concepts"). */
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
  return JSON.parse(await fs.readFile(p, "utf-8"));
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

// ---------------------------------------------------------------------------
// Content cleaning
// ---------------------------------------------------------------------------

/**
 * Strips MDX/JSX authoring noise while preserving semantically useful
 * component tags that LLMs can interpret (Callout, Tabs, Term, etc.).
 */
function cleanContent(raw: string): string {
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
// Page collection — walks docs/ respecting meta.json ordering
// ---------------------------------------------------------------------------

/** Returns true for meta.json separator entries like "---Core Commands---". */
function isSeparator(entry: string): boolean {
  return entry.startsWith("---") && entry.endsWith("---");
}

function toUrl(relativePath: string): string {
  return relativePath ? `${SITE_URL}/docs/${relativePath}` : `${SITE_URL}/docs`;
}

async function readPage(
  mdxRelPath: string,
  topSection: string,
  topSectionTitle: string,
): Promise<Page | null> {
  const absPath = path.join(DOCS_DIR, mdxRelPath);
  if (!(await pathExists(absPath))) return null;

  const raw = await fs.readFile(absPath, "utf-8");
  const { data, content } = matter(raw);

  const relativePath = mdxRelPath
    .replace(/\.mdx$/, "")
    .replace(/(^|\/)index$/, "");

  return {
    relativePath,
    title: (data.title as string) || path.basename(relativePath) || PROJECT_NAME,
    description: typeof data.description === "string" ? data.description.trim() : "",
    content: cleanContent(content),
    url: toUrl(relativePath),
    topSection,
    topSectionTitle,
  };
}

/**
 * Resolves a single entry from a meta.json `pages` array to one or more
 * Page objects. Handles direct .mdx files, directories with their own
 * meta.json, and directories with only an index.mdx.
 */
async function resolveEntry(
  parentDir: string,
  entry: string,
  topSection: string,
  topSectionTitle: string,
): Promise<Page[]> {
  if (entry === "index") {
    const page = await readPage(
      path.join(parentDir, "index.mdx"),
      topSection,
      topSectionTitle,
    );
    return page ? [page] : [];
  }

  const asFile = path.join(DOCS_DIR, parentDir, `${entry}.mdx`);
  if (await pathExists(asFile)) {
    const page = await readPage(
      path.join(parentDir, `${entry}.mdx`),
      topSection,
      topSectionTitle,
    );
    return page ? [page] : [];
  }

  const asDir = path.join(DOCS_DIR, parentDir, entry);
  if (await isDirectory(asDir)) {
    const nestedMeta = path.join(asDir, "meta.json");
    if (await pathExists(nestedMeta)) {
      return collectDir(path.join(parentDir, entry), topSection, topSectionTitle);
    }
    const page = await readPage(
      path.join(parentDir, entry, "index.mdx"),
      topSection,
      topSectionTitle,
    );
    return page ? [page] : [];
  }

  return [];
}

async function collectDir(
  dirRelative: string,
  topSection: string,
  topSectionTitle: string,
): Promise<Page[]> {
  const meta = await readJson<SectionMeta>(
    path.join(DOCS_DIR, dirRelative, "meta.json"),
  );
  const pages: Page[] = [];
  for (const entry of meta.pages ?? []) {
    if (isSeparator(entry)) continue;
    const resolved = await resolveEntry(dirRelative, entry, topSection, topSectionTitle);
    pages.push(...resolved);
  }
  return pages;
}

async function collectAllPages(): Promise<Page[]> {
  const rootMeta = await readJson<SectionMeta>(path.join(DOCS_DIR, "meta.json"));
  const pages: Page[] = [];

  const rootPage = await readPage("index.mdx", "", "");
  if (rootPage) pages.push(rootPage);

  for (const slug of rootMeta.pages ?? []) {
    const sectionMetaPath = path.join(DOCS_DIR, slug, "meta.json");
    if (!(await pathExists(sectionMetaPath))) continue;
    const sectionMeta = await readJson<SectionMeta>(sectionMetaPath);
    const sectionTitle = sectionMeta.title ?? slug;
    const sectionPages = await collectDir(slug, slug, sectionTitle);
    pages.push(...sectionPages);
  }

  return pages;
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

function isOptionalPage(page: Page): boolean {
  if (OPTIONAL_SECTIONS.has(page.topSection)) return true;
  for (const sub of OPTIONAL_SUBSECTIONS) {
    if (page.relativePath.startsWith(`${sub}/`)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Output: llms.txt
// ---------------------------------------------------------------------------

function generateLlmsTxt(pages: Page[]): string {
  const lines: string[] = [
    `# ${PROJECT_NAME}`,
    "",
    `> ${PROJECT_DESCRIPTION}`,
    "",
  ];

  const rootPage = pages.find((p) => p.relativePath === "");
  if (rootPage) {
    lines.push(`- [${rootPage.title}](${rootPage.url}): ${rootPage.description}`);
    lines.push("");
  }

  const sections = new Map<string, Page[]>();
  const optional: Page[] = [];

  for (const page of pages) {
    if (!page.topSection) continue;
    if (isOptionalPage(page)) {
      optional.push(page);
      continue;
    }
    const bucket = sections.get(page.topSectionTitle) ?? [];
    bucket.push(page);
    sections.set(page.topSectionTitle, bucket);
  }

  for (const [title, sectionPages] of sections) {
    lines.push(`## ${title}`);
    lines.push("");
    for (const page of sectionPages) {
      const desc = page.description ? `: ${page.description}` : "";
      lines.push(`- [${page.title}](${page.url})${desc}`);
    }
    lines.push("");
  }

  if (optional.length > 0) {
    lines.push("## Optional");
    lines.push("");
    for (const page of optional) {
      const desc = page.description ? `: ${page.description}` : "";
      lines.push(`- [${page.title}](${page.url})${desc}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Output: llms-full.txt
// ---------------------------------------------------------------------------

function generateLlmsFullTxt(pages: Page[]): string {
  const header = [
    `# ${PROJECT_NAME} Documentation`,
    "",
    `> Complete documentation for the ${PROJECT_NAME} platform.`,
    `> Source: ${SITE_URL}/docs`,
  ].join("\n");

  const blocks = pages.map(
    (page) => `Source: ${page.url}\n\n${page.content}`,
  );

  return `${header}\n\n---\n\n${blocks.join("\n\n---\n\n")}\n`;
}

// ---------------------------------------------------------------------------
// Output: per-page .md files
// ---------------------------------------------------------------------------

function generatePageMd(page: Page): string {
  const parts: string[] = [`Source: ${page.url}`, ""];
  if (page.description) {
    parts.push(`> ${page.description}`, "");
  }
  parts.push(page.content, "");
  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function writeOutputs(pages: Page[]): Promise<void> {
  const llmsTxt = generateLlmsTxt(pages);
  await fs.writeFile(path.join(OUT_DIR, "llms.txt"), llmsTxt, "utf-8");
  console.log(
    `  llms.txt — ${pages.length} pages, ` +
      `${new Set(pages.filter((p) => p.topSection).map((p) => p.topSectionTitle)).size} sections`,
  );

  const fullTxt = generateLlmsFullTxt(pages);
  await fs.writeFile(path.join(OUT_DIR, "llms-full.txt"), fullTxt, "utf-8");
  const sizeKb = (Buffer.byteLength(fullTxt, "utf-8") / 1024).toFixed(1);
  console.log(`  llms-full.txt — ${sizeKb} KB`);

  let mdCount = 0;
  for (const page of pages) {
    const mdPath = page.relativePath
      ? path.join(OUT_DIR, "docs", `${page.relativePath}.md`)
      : path.join(OUT_DIR, "docs", "index.md");
    await ensureDir(path.dirname(mdPath));
    await fs.writeFile(mdPath, generatePageMd(page), "utf-8");
    mdCount++;
  }
  console.log(`  ${mdCount} per-page .md files`);
}

async function main(): Promise<void> {
  console.log("[llms] Generating LLM-friendly documentation output...");

  if (!(await pathExists(OUT_DIR))) {
    console.error(`[llms] Error: ${OUT_DIR} does not exist. Run 'next build' first.`);
    process.exit(1);
  }

  if (!(await pathExists(DOCS_DIR))) {
    console.error(`[llms] Error: ${DOCS_DIR} does not exist.`);
    process.exit(1);
  }

  const pages = await collectAllPages();
  if (pages.length === 0) {
    console.error("[llms] Error: no documentation pages found.");
    process.exit(1);
  }

  await writeOutputs(pages);
  console.log("[llms] Done.");
}

main().catch((err: unknown) => {
  console.error("[llms] Fatal error:", err);
  process.exit(1);
});
