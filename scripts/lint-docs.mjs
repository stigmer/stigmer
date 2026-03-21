#!/usr/bin/env node

// Stigmer documentation linter — enforces project-specific rules that
// markdownlint cannot express: terminology, frontmatter schema, H1-title
// consistency, and relative link resolution.
//
// Usage:
//   node scripts/lint-docs.mjs "docs/**/*.mdx"
//   node scripts/lint-docs.mjs "docs/**/*.{md,mdx}"

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import matter from "gray-matter";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const REPO_ROOT = resolve(import.meta.dirname, "..");
const TERMINOLOGY_PATH = join(
  REPO_ROOT,
  "docs/standards/terminology.json"
);
const MAX_DESCRIPTION_LENGTH = 160;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadTerminology() {
  const raw = readFileSync(TERMINOLOGY_PATH, "utf-8");
  const dict = JSON.parse(raw);
  return dict.terms.flatMap((t) => {
    // Only enforce multi-word prohibited terms (2+ words) automatically.
    // Single-word generic terms ("server", "token", "module") have broad
    // contextual exceptions that a line-level linter cannot resolve reliably.
    // Those are enforced by the Cursor auto-apply rule which has full context.
    const multiWord = t.prohibited.filter((p) => p.includes(" "));
    if (multiWord.length === 0) return [];
    return [
      {
        canonical: t.canonical,
        prohibited: multiWord,
        exceptions: t.exceptions || [],
        patterns: multiWord.map(
          (p) => new RegExp(`\\b${escapeRegex(p)}\\b`, "gi")
        ),
      },
    ];
  });
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Strip YAML frontmatter and fenced code blocks, returning only prose lines
 *  with their original 1-based line numbers preserved as nulls for skipped lines. */
function extractProse(content) {
  const lines = content.split("\n");
  const prose = new Array(lines.length).fill(null);
  let inFrontmatter = false;
  let frontmatterDone = false;
  let inCodeBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (!frontmatterDone && i === 0 && line.trim() === "---") {
      inFrontmatter = true;
      continue;
    }
    if (inFrontmatter) {
      if (line.trim() === "---") {
        inFrontmatter = false;
        frontmatterDone = true;
      }
      continue;
    }
    frontmatterDone = true;

    if (/^```/.test(line.trim())) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    prose[i] = line;
  }

  return prose;
}

// ---------------------------------------------------------------------------
// Check: Terminology
// ---------------------------------------------------------------------------

function checkTerminology(filePath, content, terms) {
  const errors = [];
  const prose = extractProse(content);

  for (const term of terms) {
    for (const pattern of term.patterns) {
      for (let i = 0; i < prose.length; i++) {
        const line = prose[i];
        if (line === null) continue;

        let match;
        pattern.lastIndex = 0;
        while ((match = pattern.exec(line)) !== null) {
          const col = match.index;
          if (isInsideInlineCode(line, col, col + match[0].length)) continue;

          errors.push({
            file: filePath,
            line: i + 1,
            column: col + 1,
            message: `Prohibited term "${match[0]}" — use "${term.canonical}" instead`,
          });
        }
      }
    }
  }

  return errors;
}

function isInsideInlineCode(line, start, end) {
  // Find all backtick-delimited spans and check if [start, end) falls inside one
  const spans = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === "`") {
      const open = i;
      i++;
      while (i < line.length && line[i] !== "`") i++;
      if (i < line.length) {
        spans.push([open, i + 1]);
        i++;
      }
    } else {
      i++;
    }
  }
  return spans.some(([s, e]) => start >= s && end <= e);
}

// ---------------------------------------------------------------------------
// Check: Frontmatter
// ---------------------------------------------------------------------------

function checkFrontmatter(filePath, content) {
  const errors = [];

  let parsed;
  try {
    parsed = matter(content);
  } catch {
    errors.push({
      file: filePath,
      line: 1,
      column: 1,
      message: "Invalid YAML frontmatter",
    });
    return { errors, data: {} };
  }

  const { data } = parsed;

  if (!data.title || typeof data.title !== "string" || !data.title.trim()) {
    errors.push({
      file: filePath,
      line: 1,
      column: 1,
      message: 'Missing required frontmatter field "title"',
    });
  }

  if (
    !data.description ||
    typeof data.description !== "string" ||
    !data.description.trim()
  ) {
    errors.push({
      file: filePath,
      line: 1,
      column: 1,
      message: 'Missing required frontmatter field "description"',
    });
  } else if (data.description.length > MAX_DESCRIPTION_LENGTH) {
    errors.push({
      file: filePath,
      line: 1,
      column: 1,
      message: `Description exceeds ${MAX_DESCRIPTION_LENGTH} characters (${data.description.length})`,
    });
  }

  return { errors, data };
}

// ---------------------------------------------------------------------------
// Check: H1-title match
// ---------------------------------------------------------------------------

function checkH1TitleMatch(filePath, content, title) {
  const errors = [];
  if (!title) return errors;

  const prose = extractProse(content);
  const h1Lines = [];

  for (let i = 0; i < prose.length; i++) {
    const line = prose[i];
    if (line === null) continue;
    const h1Match = line.match(/^#\s+(.+)$/);
    if (h1Match) {
      h1Lines.push({ lineNum: i + 1, text: h1Match[1].trim() });
    }
  }

  if (h1Lines.length === 0) {
    errors.push({
      file: filePath,
      line: 1,
      column: 1,
      message: "No H1 heading found in document body",
    });
  } else if (h1Lines.length > 1) {
    for (const h1 of h1Lines.slice(1)) {
      errors.push({
        file: filePath,
        line: h1.lineNum,
        column: 1,
        message: `Multiple H1 headings — only one is allowed (found "${h1.text}")`,
      });
    }
  }

  if (h1Lines.length >= 1 && h1Lines[0].text !== title) {
    errors.push({
      file: filePath,
      line: h1Lines[0].lineNum,
      column: 1,
      message: `H1 "${h1Lines[0].text}" does not match frontmatter title "${title}"`,
    });
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Check: Relative links
// ---------------------------------------------------------------------------

function checkRelativeLinks(filePath, content) {
  const errors = [];
  const lines = content.split("\n");
  const fileDir = dirname(filePath);

  // Match markdown links: [text](url)
  const linkPattern = /\[([^\]]*)\]\(([^)]+)\)/g;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let match;
    linkPattern.lastIndex = 0;

    while ((match = linkPattern.exec(line)) !== null) {
      const url = match[2].trim();

      // Skip external URLs
      if (url.startsWith("http://") || url.startsWith("https://")) continue;
      // Skip anchor-only links
      if (url.startsWith("#")) continue;
      // Skip absolute site paths (handled by the framework router)
      if (url.startsWith("/")) continue;
      // Skip mailto
      if (url.startsWith("mailto:")) continue;

      // Strip anchor fragment
      const pathPart = url.split("#")[0];
      if (!pathPart) continue;

      const resolved = resolve(fileDir, pathPart);

      // Check if target exists (as file or directory)
      if (!existsSync(resolved)) {
        // Try common extensions
        const withExtensions = [
          resolved,
          resolved + ".md",
          resolved + ".mdx",
          join(resolved, "index.md"),
          join(resolved, "index.mdx"),
        ];
        const found = withExtensions.some(
          (p) => existsSync(p)
        );
        if (!found) {
          errors.push({
            file: filePath,
            line: i + 1,
            column: match.index + 1,
            message: `Broken relative link: "${url}" → ${resolved} does not exist`,
          });
        }
      }
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// File discovery
// ---------------------------------------------------------------------------

function findFilesRecursive(dir, extensions) {
  const results = [];

  function walk(d) {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules") continue;
        walk(full);
      } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
        results.push(full);
      }
    }
  }

  walk(dir);
  return results.sort();
}

function findFiles(patterns) {
  const allFiles = new Set();

  for (const pattern of patterns) {
    // Parse "docs/**/*.mdx" or "docs/**/*.{md,mdx}" patterns
    // Extract the root directory and extensions
    const slashIdx = pattern.indexOf("/");
    const rootDir = slashIdx !== -1 ? pattern.substring(0, slashIdx) : pattern;
    const absRoot = join(REPO_ROOT, rootDir);

    // Extract extensions from the pattern
    let extensions = [];
    const braceMatch = pattern.match(/\.\{([^}]+)\}$/);
    if (braceMatch) {
      extensions = braceMatch[1].split(",").map((e) => "." + e.trim());
    } else {
      const extMatch = pattern.match(/\*(\.[a-z]+)$/);
      if (extMatch) {
        extensions = [extMatch[1]];
      }
    }

    if (extensions.length === 0) continue;

    const files = findFilesRecursive(absRoot, extensions);
    for (const f of files) {
      if (f.includes("docs/standards/templates/")) continue;
      allFiles.add(f);
    }
  }

  return [...allFiles].sort();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const patterns = args.length > 0 ? args : ["docs/**/*.mdx"];

  const files = findFiles(patterns);

  if (files.length === 0) {
    console.log("lint-docs: no files matched the pattern(s):", patterns.join(", "));
    process.exit(0);
  }

  const terms = loadTerminology();
  let allErrors = [];

  for (const filePath of files) {
    const content = readFileSync(filePath, "utf-8");

    // Frontmatter
    const { errors: fmErrors, data } = checkFrontmatter(filePath, content);
    allErrors.push(...fmErrors);

    // H1-title match
    const h1Errors = checkH1TitleMatch(filePath, content, data.title);
    allErrors.push(...h1Errors);

    // Terminology
    const termErrors = checkTerminology(filePath, content, terms);
    allErrors.push(...termErrors);

    // Relative links
    const linkErrors = checkRelativeLinks(filePath, content);
    allErrors.push(...linkErrors);
  }

  // Print results
  if (allErrors.length === 0) {
    console.log(`lint-docs: ${files.length} file(s) checked, no issues found`);
    process.exit(0);
  }

  // Group errors by file
  const byFile = new Map();
  for (const err of allErrors) {
    const rel = err.file.replace(REPO_ROOT + "/", "");
    if (!byFile.has(rel)) byFile.set(rel, []);
    byFile.get(rel).push(err);
  }

  for (const [file, errors] of byFile) {
    for (const err of errors) {
      const rel = err.file.replace(REPO_ROOT + "/", "");
      console.log(`${rel}:${err.line}:${err.column}: ${err.message}`);
    }
  }

  console.log(
    `\nlint-docs: ${allErrors.length} issue(s) in ${byFile.size} file(s)`
  );
  process.exit(1);
}

main().catch((err) => {
  console.error("lint-docs: fatal error:", err);
  process.exit(2);
});
