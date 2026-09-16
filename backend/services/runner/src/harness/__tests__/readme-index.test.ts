/**
 * Pins that `src/harness/README.md` resolves: every path it names exists and
 * every symbol it names occurs in a file the same passage cites.
 *
 * Why it matters: the README is an index for someone adding a harness, not a
 * restatement of the headers. An index earns its keep only while its entries
 * point somewhere. A module renamed, a test moved, an export renamed — each
 * turns a line of the guide into a false trail, and nothing in CI reads a
 * `src/**` README (the docs link checker walks `docs/` only). This fence is
 * the guide's one mechanical check; it is what lets the README carry file
 * paths and export names at all.
 *
 * Two rules, both about resolution, neither about prose:
 *
 *  1. A backticked token that reads as a path (ends in a `/`, or is a file
 *     name with an extension, with or without a directory part) exists,
 *     resolved against `src/` (the base the runner's own headers cite each
 *     other from) or against the repository root (the base for everything
 *     outside the runner).
 *  2. A backticked identifier occurs in the text of at least one FILE the
 *     same passage resolved under rule 1. A passage that names a symbol and
 *     cites no file is an offence: the index rule ("say where it lives") made
 *     mechanical. Hyphenated literals (`deep-agent`, `deny-and-retry`) count
 *     as identifiers so the wire words are checked too.
 *
 * A "passage" is a markdown block — one paragraph, one list item with its
 * wrapped continuation lines, or one table row — because the repository's
 * prettier wraps prose at 80 columns, so a line is not a unit of meaning.
 * Fenced code blocks are blanked before the scan (they hold shell commands
 * and search patterns, not references). Two token classes are exempt with
 * a reason: a template (`activities/<harness>/adapter.ts`, contains `<`)
 * names a shape, not a file; a package specifier (`@cursor/sdk`, starts
 * with `@`) is resolved by npm, not by this tree.
 *
 * Hand-rolled over three regular expressions rather than a markdown parser:
 * the README has three shapes and the runner has no markdown dependency.
 * The fence shape is `import-direction.test.ts`'s: a sweep that reports what
 * it visited beside what it found, a liveness guard that fails when the
 * sweep saw nothing, and every offence named with its block's first line.
 * What it never asserts: wording, section order, or that a header agrees
 * with the README — the header wins that by rule, not by test.
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const README_PATH = join(HERE, "..", "README.md");
/** `src/`: the base the runner's headers cite each other from. */
const SRC_ROOT = resolve(HERE, "../..");
/** The repository root: `src/` → `runner/` → `services/` → `backend/` → root. */
const REPO_ROOT = resolve(SRC_ROOT, "../../../..");

// ── The scanner ──────────────────────────────────────────────────────────────

/** One passage of the README: a paragraph, a list item with its continuation, or a table row. */
interface Block {
  /** 1-based line of the block's first line in the README, for the offence message. */
  readonly line: number;
  readonly text: string;
}

/**
 * Blank every fenced code block, keeping the line count so block line
 * numbers still point into the real file.
 */
function stripFencedCode(markdown: string): string {
  let inFence = false;
  return markdown
    .split("\n")
    .map((line) => {
      if (line.trimStart().startsWith("```")) {
        inFence = !inFence;
        return "";
      }
      return inFence ? "" : line;
    })
    .join("\n");
}

const BLOCK_START = /^(#{1,6}\s|[-*]\s|\d+\.\s|\|)/;

/**
 * Split markdown into blocks. A blank line ends a block; a heading, a list
 * marker or a table row starts one; any other non-blank line continues the
 * current block (prettier indents a list item's wrapped lines, and a
 * paragraph's lines are simply consecutive).
 */
function splitBlocks(markdown: string): Block[] {
  const blocks: Block[] = [];
  let current: { line: number; parts: string[] } | undefined;
  const flush = (): void => {
    if (current !== undefined) {
      blocks.push({ line: current.line, text: current.parts.join(" ") });
      current = undefined;
    }
  };
  markdown.split("\n").forEach((raw, index) => {
    const line = raw.trim();
    if (line === "") {
      flush();
      return;
    }
    if (BLOCK_START.test(line) || current === undefined) {
      flush();
      current = { line: index + 1, parts: [line] };
      return;
    }
    current.parts.push(line);
  });
  flush();
  return blocks;
}

/** Every backticked token in a block, in order, backticks removed. */
function backtickedTokens(text: string): string[] {
  return [...text.matchAll(/`([^`\n]+)`/g)].map((m) => m[1] ?? "");
}

type TokenClass = "template" | "package" | "path" | "identifier" | "other";

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$-]{3,}$/;
/** A directory (`activities/execute-cursor/`) or a file with an extension, with or without a directory part (`harness-adapters.ts` sits at the `src/` root). */
const DIRECTORY = /\/$/;
const FILE_WITH_EXTENSION = /^[^.\s][^\s]*\.[A-Za-z0-9]{1,5}$/;

/** Which rule a token falls under; `other` is prose in backticks and is ignored. */
function classify(token: string): TokenClass {
  if (token.includes("<")) return "template";
  if (token.startsWith("@")) return "package";
  if (DIRECTORY.test(token) || FILE_WITH_EXTENSION.test(token)) return "path";
  if (IDENTIFIER.test(token)) return "identifier";
  return "other";
}

/** The first base under which `token` exists, or `undefined`. */
function resolvePath(token: string, bases: readonly string[]): string | undefined {
  for (const base of bases) {
    const candidate = join(base, token);
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

interface Offence {
  readonly line: number;
  readonly token: string;
  readonly rule: "path" | "symbol" | "no-file-cited";
}

interface Sweep {
  /** What the sweep saw; the liveness guards read these. */
  readonly blocks: number;
  readonly paths: number;
  readonly identifiers: number;
  readonly offences: Offence[];
}

/** Run both rules over `markdown`, resolving paths against `bases` in order. */
function sweep(markdown: string, bases: readonly string[]): Sweep {
  const offences: Offence[] = [];
  let paths = 0;
  let identifiers = 0;
  const blocks = splitBlocks(stripFencedCode(markdown));
  for (const block of blocks) {
    const files: string[] = [];
    const symbols: string[] = [];
    for (const token of backtickedTokens(block.text)) {
      const kind = classify(token);
      switch (kind) {
        case "path": {
          paths += 1;
          const resolved = resolvePath(token, bases);
          if (resolved === undefined) {
            offences.push({ line: block.line, token, rule: "path" });
          } else if (statSync(resolved).isFile()) {
            files.push(resolved);
          }
          break;
        }
        case "identifier":
          identifiers += 1;
          symbols.push(token);
          break;
        case "template":
        case "package":
        case "other":
          break;
        default: {
          const exhaustive: never = kind;
          throw new Error(`unhandled token class ${String(exhaustive)}`);
        }
      }
    }
    if (symbols.length === 0) continue;
    if (files.length === 0) {
      for (const token of symbols) offences.push({ line: block.line, token, rule: "no-file-cited" });
      continue;
    }
    const corpus = files.map((f) => readFileSync(f, "utf-8"));
    for (const token of symbols) {
      if (!corpus.some((text) => text.includes(token))) {
        offences.push({ line: block.line, token, rule: "symbol" });
      }
    }
  }
  return { blocks: blocks.length, paths, identifiers, offences };
}

function describeOffences(offences: readonly Offence[]): string {
  const words: Record<Offence["rule"], string> = {
    path: "does not exist under src/ or the repository root",
    symbol: "does not occur in any file this passage cites",
    "no-file-cited": "is named in a passage that cites no file",
  };
  return offences.map((o) => `  README.md:${o.line}  \`${o.token}\` ${words[o.rule]}`).join("\n");
}

// ── The checker itself ───────────────────────────────────────────────────────

describe("the scanner (the checker itself)", () => {
  it("blanks fenced code and keeps the line count", () => {
    const text = ["before", "```bash", "rg -l 'x/y.ts'", "```", "after"].join("\n");
    const stripped = stripFencedCode(text);
    expect(stripped.split("\n")).toHaveLength(5);
    expect(stripped).not.toContain("x/y.ts");
    expect(stripped).toContain("after");
  });

  it("splits paragraphs, wrapped list items, table rows and headings into blocks with their first line", () => {
    const text = [
      "# Title",
      "",
      "A paragraph that",
      "wraps onto two lines.",
      "",
      "- `a/b.ts` — a bullet whose",
      "  continuation is indented.",
      "- a second bullet",
      "",
      "| `c/d.ts` | row one |",
      "| `e/f.ts` | row two |",
    ].join("\n");
    expect(splitBlocks(text)).toEqual([
      { line: 1, text: "# Title" },
      { line: 3, text: "A paragraph that wraps onto two lines." },
      { line: 6, text: "- `a/b.ts` — a bullet whose continuation is indented." },
      { line: 8, text: "- a second bullet" },
      { line: 10, text: "| `c/d.ts` | row one |" },
      { line: 11, text: "| `e/f.ts` | row two |" },
    ]);
  });

  it.each<[string, TokenClass]>([
    ["harness/types.ts", "path"],
    ["harness-adapters.ts", "path"],
    ["activities/execute-cursor/", "path"],
    ["apis/", "path"],
    ["apis/ai/stigmer/agentic/session/v1/enum.proto", "path"],
    ["activities/<harness>/adapter.ts", "template"],
    ["@cursor/sdk", "package"],
    ["@temporalio/*", "package"],
    ["HarnessAdapter", "identifier"],
    ["deep-agent", "identifier"],
    ["deny-and-retry", "identifier"],
    ["boot", "identifier"],
    ["src", "other"],
    ["make codegen", "other"],
    ["--harness", "other"],
    [".ts", "other"],
    ["f25d15131", "identifier"],
  ])("classifies %s as %s", (token, expected) => {
    expect(classify(token)).toBe(expected);
  });

  it("resolves a path against the bases in order and reports a miss", () => {
    expect(resolvePath("harness/types.ts", [SRC_ROOT, REPO_ROOT])).toBe(join(SRC_ROOT, "harness/types.ts"));
    expect(resolvePath("apis/", [SRC_ROOT, REPO_ROOT])).toBe(join(REPO_ROOT, "apis/"));
    expect(resolvePath("harness/no-such-module.ts", [SRC_ROOT, REPO_ROOT])).toBeUndefined();
  });

  it("flags a missing path, a symbol absent from the cited file, and a symbol with no file cited", () => {
    const text = [
      "- `harness/no-such-module.ts` — a moved module.",
      "- `harness/registry.ts` — `NoSuchExport` was renamed.",
      "- `HarnessName` is named here with no file beside it.",
      "- `harness/registry.ts` — `HarnessName` is fine.",
    ].join("\n");
    expect(sweep(text, [SRC_ROOT, REPO_ROOT]).offences).toEqual([
      { line: 1, token: "harness/no-such-module.ts", rule: "path" },
      { line: 2, token: "NoSuchExport", rule: "symbol" },
      { line: 3, token: "HarnessName", rule: "no-file-cited" },
    ]);
  });

  it("ignores templates, package specifiers, prose in backticks and anything inside a code fence", () => {
    const text = [
      "- `activities/<harness>/adapter.ts` loads `@cursor/sdk` inside `boot`; see `harness/types.ts`.",
      "",
      "```bash",
      "rg -l 'x/y.ts' `NoSuchExport`",
      "```",
    ].join("\n");
    const result = sweep(text, [SRC_ROOT, REPO_ROOT]);
    expect(result.offences).toEqual([]);
    expect(result.paths).toBe(1);
    expect(result.identifiers).toBe(1);
  });
});

// ── The README ───────────────────────────────────────────────────────────────

describe("src/harness/README.md resolves", () => {
  const readme = readFileSync(README_PATH, "utf-8");
  const result = sweep(readme, [SRC_ROOT, REPO_ROOT]);

  it("is rooted where it claims (the repository root holds apis/ and backend/)", () => {
    expect(existsSync(join(REPO_ROOT, "apis")), `expected ${REPO_ROOT} to contain apis/`).toBe(true);
    expect(existsSync(join(REPO_ROOT, "backend")), `expected ${REPO_ROOT} to contain backend/`).toBe(true);
  });

  it("saw the guide (the sweep visited blocks, paths and identifiers)", () => {
    expect(result.blocks).toBeGreaterThan(20);
    expect(result.paths).toBeGreaterThan(40);
    expect(result.identifiers).toBeGreaterThan(20);
  });

  it("names no path that does not exist", () => {
    const misses = result.offences.filter((o) => o.rule === "path");
    expect(misses, `paths in the README that resolve nowhere:\n${describeOffences(misses)}`).toEqual([]);
  });

  it("names no symbol outside a file the same passage cites", () => {
    const misses = result.offences.filter((o) => o.rule !== "path");
    expect(misses, `symbols in the README without a home:\n${describeOffences(misses)}`).toEqual([]);
  });
});
