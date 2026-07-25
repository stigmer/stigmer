/**
 * LLM-Friendly Output Generator
 *
 * Post-build script generating documentation files optimized for LLM consumption:
 *   out/llms.txt       — Curated index following the llms.txt standard
 *   out/llms-full.txt  — All documentation concatenated into one file
 *   out/docs/**\/*.md  — Per-page markdown variants
 *
 * Page collection lives in src/lib/llms-pages.ts (unit-tested); it walks the
 * docs/ meta.json tree with the same semantics as Fumadocs, so llms.txt
 * sections mirror the sidebar's capability groups. A coverage check fails the
 * build if any docs page is silently missing from the collection.
 *
 * Follows the llms.txt standard: https://llmstxt.org
 *
 * Usage: tsx scripts/generate-llms-txt.ts
 * Runs as part of: yarn build (after next build)
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  collectDocsPages,
  findUncollectedPages,
  type DocsPageEntry as Page,
} from "../src/lib/llms-pages";

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

/** Subdirectory paths (relative to docs/) whose non-index pages are optional. */
const OPTIONAL_SUBSECTIONS = new Set(["cli/commands"]);

/**
 * Pages that exist on disk but are intentionally absent from the collection.
 * Every entry needs a reason — anything not listed here that fails the
 * coverage check breaks the build.
 */
const KNOWN_UNCOLLECTED: readonly string[] = [];

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

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

function isOptionalPage(page: Page): boolean {
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

  const pages = await collectDocsPages(DOCS_DIR, SITE_URL);
  if (pages.length === 0) {
    console.error("[llms] Error: no documentation pages found.");
    process.exit(1);
  }

  const uncollected = await findUncollectedPages(DOCS_DIR, pages, KNOWN_UNCOLLECTED);
  if (uncollected.length > 0) {
    console.error(
      "[llms] Error: pages exist in docs/ but were not collected — they would " +
        "silently vanish from llms.txt and the per-page .md exports (used by " +
        "the Copy-page button). Fix the meta.json tree or, if intentional, " +
        "add them to KNOWN_UNCOLLECTED with a reason:",
    );
    for (const rel of uncollected) console.error(`  - ${rel}`);
    process.exit(1);
  }

  await writeOutputs(pages);
  console.log("[llms] Done.");
}

main().catch((err: unknown) => {
  console.error("[llms] Fatal error:", err);
  process.exit(1);
});
