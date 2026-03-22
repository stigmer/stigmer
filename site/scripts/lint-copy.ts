/**
 * Copy Quality Lint for Stigmer Sales Website
 *
 * Scans site/src/**\/*.{tsx,ts} files against copy-guidelines.json to enforce:
 * - Banned phrases (16 entries)
 * - Prohibited terminology from sales_terminology (6 entries)
 * - Passive voice patterns (the one voice rule marked enforced_by: "lint")
 *
 * Exit code: 0 if clean, 1 if any violations found.
 *
 * Usage: tsx scripts/lint-copy.ts
 */

import * as fs from "node:fs";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BannedPhrase {
  phrase: string;
  reason: string;
  replacement: string;
}

interface SalesTerminology {
  canonical: string;
  prohibited: string[];
  context: string;
  exceptions?: string[];
}

interface CopyGuidelines {
  banned_phrases: BannedPhrase[];
  sales_terminology: SalesTerminology[];
}

interface Violation {
  file: string;
  line: number;
  column: number;
  kind: "banned-phrase" | "prohibited-term" | "passive-voice";
  match: string;
  message: string;
  suggestion: string;
}

// ---------------------------------------------------------------------------
// File discovery
// ---------------------------------------------------------------------------

function findFiles(dir: string, extensions: string[]): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findFiles(full, extensions));
    } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
      results.push(full);
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Pattern builders
// ---------------------------------------------------------------------------

function buildWordBoundaryRegex(phrase: string): RegExp {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "gi");
}

const PASSIVE_PATTERNS = [
  /\b(?:is|are|was|were|be|been|being)\s+\w+ed\b/gi,
  /\b(?:is|are|was|were|be|been|being)\s+\w+en\b/gi,
];

// ---------------------------------------------------------------------------
// Checkers
// ---------------------------------------------------------------------------

function checkBannedPhrases(
  lines: string[],
  filePath: string,
  bannedPhrases: BannedPhrase[],
): Violation[] {
  const violations: Violation[] = [];

  for (const bp of bannedPhrases) {
    const regex = buildWordBoundaryRegex(bp.phrase);

    for (let i = 0; i < lines.length; i++) {
      let match: RegExpExecArray | null;
      regex.lastIndex = 0;
      while ((match = regex.exec(lines[i])) !== null) {
        violations.push({
          file: filePath,
          line: i + 1,
          column: match.index + 1,
          kind: "banned-phrase",
          match: match[0],
          message: `Banned phrase: "${bp.phrase}" — ${bp.reason}`,
          suggestion: bp.replacement,
        });
      }
    }
  }

  return violations;
}

function checkProhibitedTerminology(
  lines: string[],
  filePath: string,
  terminology: SalesTerminology[],
): Violation[] {
  const violations: Violation[] = [];

  for (const term of terminology) {
    // Terms with exceptions require human judgment to determine context.
    // Leave these to the @review-website-content rule.
    if (term.exceptions && term.exceptions.length > 0) continue;

    for (const prohibited of term.prohibited) {
      const regex = buildWordBoundaryRegex(prohibited);

      for (let i = 0; i < lines.length; i++) {
        let match: RegExpExecArray | null;
        regex.lastIndex = 0;
        while ((match = regex.exec(lines[i])) !== null) {
          violations.push({
            file: filePath,
            line: i + 1,
            column: match.index + 1,
            kind: "prohibited-term",
            match: match[0],
            message: `Prohibited term: "${prohibited}" — use "${term.canonical}" instead. ${term.context}`,
            suggestion: `Use "${term.canonical}"`,
          });
        }
      }
    }
  }

  return violations;
}

function checkPassiveVoice(
  lines: string[],
  filePath: string,
): Violation[] {
  const violations: Violation[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!looksLikeContent(line)) continue;

    for (const pattern of PASSIVE_PATTERNS) {
      let match: RegExpExecArray | null;
      pattern.lastIndex = 0;
      while ((match = pattern.exec(line)) !== null) {
        if (isPassiveFalsePositive(match[0])) continue;
        violations.push({
          file: filePath,
          line: i + 1,
          column: match.index + 1,
          kind: "passive-voice",
          match: match[0],
          message: `Possible passive voice: "${match[0]}"`,
          suggestion: "Rewrite in active voice (e.g., 'Stigmer runs your agent' instead of 'Your agent is run by Stigmer')",
        });
      }
    }
  }

  return violations;
}

/**
 * Heuristic: only flag passive voice in lines that look like user-facing
 * content (JSX text, string literals, template literals, comments), not
 * in code-heavy lines like import statements or variable declarations.
 */
function looksLikeContent(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.startsWith("import ")) return false;
  if (trimmed.startsWith("export ")) return false;
  if (trimmed.startsWith("const ") && !trimmed.includes('"') && !trimmed.includes("'") && !trimmed.includes("`")) return false;
  if (trimmed.startsWith("let ") && !trimmed.includes('"') && !trimmed.includes("'")) return false;
  if (trimmed.startsWith("type ") || trimmed.startsWith("interface ")) return false;
  return true;
}

/**
 * Common participial phrases that are technical state descriptions, not
 * marketing passive voice. These appear constantly in code comments,
 * JSDoc, CSS class references, and UI state descriptions.
 */
const PASSIVE_FALSE_POSITIVES = new Set([
  "is used",
  "is defined",
  "is required",
  "is called",
  "is named",
  "is provided",
  "is passed",
  "is expected",
  "is disabled",
  "is enabled",
  "is hidden",
  "is loaded",
  "is mounted",
  "is rendered",
  "is returned",
  "is set",
  "is sorted",
  "is wrapped",
  "is based",
  "is fixed",
  "is focused",
  "is handled",
  "is needed",
  "is assumed",
  "is connected",
  "is installed",
  "is configured",
  "is controlled",
  "is isolated",
  "is opened",
  "is closed",
  "is animated",
  "is supported",
  "is included",
  "is excluded",
  "is selected",
  "is checked",
  "is unchecked",
  "is expanded",
  "is collapsed",
  "is triggered",
  "is resolved",
  "is rejected",
  "is completed",
  "is updated",
  "is removed",
  "is added",
  "is initialized",
  "is attached",
  "is detected",
  "are used",
  "are defined",
  "are required",
  "are sorted",
  "are passed",
  "are disabled",
  "are enabled",
  "are hidden",
  "are loaded",
  "are rendered",
  "are isolated",
  "are controlled",
  "are included",
  "are excluded",
  "are supported",
  "are connected",
  "are configured",
  "are animated",
  "be used",
  "be added",
  "be removed",
  "be returned",
  "be called",
  "be passed",
  "be provided",
  "be set",
  "be handled",
  "be rendered",
  "be configured",
]);

function isPassiveFalsePositive(match: string): boolean {
  return PASSIVE_FALSE_POSITIVES.has(match.toLowerCase());
}

// ---------------------------------------------------------------------------
// Output formatting
// ---------------------------------------------------------------------------

function formatViolation(v: Violation): string {
  const location = `${v.file}:${v.line}:${v.column}`;
  return `${location} — ${v.message}\n  Replace with: ${v.suggestion}`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const siteRoot = path.resolve(process.cwd());
  const srcDir = path.join(siteRoot, "src");
  const guidelinesPath = path.join(siteRoot, "standards", "copy-guidelines.json");

  if (!fs.existsSync(guidelinesPath)) {
    console.error(`Error: copy-guidelines.json not found at ${guidelinesPath}`);
    process.exit(1);
  }

  const guidelines: CopyGuidelines = JSON.parse(
    fs.readFileSync(guidelinesPath, "utf-8"),
  );

  const files = findFiles(srcDir, [".tsx", ".ts"]);

  if (files.length === 0) {
    console.log("No .tsx/.ts files found in site/src/. Nothing to lint.");
    process.exit(0);
  }

  console.log(`\nLint Copy: scanning ${files.length} files against copy-guidelines.json\n`);

  const allViolations: Violation[] = [];

  for (const file of files) {
    const relativePath = path.relative(siteRoot, file);
    const content = fs.readFileSync(file, "utf-8");
    const lines = content.split("\n");

    allViolations.push(
      ...checkBannedPhrases(lines, relativePath, guidelines.banned_phrases),
      ...checkProhibitedTerminology(lines, relativePath, guidelines.sales_terminology),
      ...checkPassiveVoice(lines, relativePath),
    );
  }

  if (allViolations.length === 0) {
    console.log("All checks passed. No copy violations found.\n");
    process.exit(0);
  }

  const sorted = allViolations.sort((a, b) =>
    a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column,
  );

  for (const v of sorted) {
    console.log(formatViolation(v));
    console.log();
  }

  const bannedCount = sorted.filter((v) => v.kind === "banned-phrase").length;
  const termCount = sorted.filter((v) => v.kind === "prohibited-term").length;
  const passiveCount = sorted.filter((v) => v.kind === "passive-voice").length;

  console.log("---");
  console.log(`${sorted.length} violation(s) found:`);
  if (bannedCount > 0) console.log(`  ${bannedCount} banned phrase(s)`);
  if (termCount > 0) console.log(`  ${termCount} prohibited term(s)`);
  if (passiveCount > 0) console.log(`  ${passiveCount} passive voice instance(s)`);
  console.log("\nFix all violations before merge.\n");
  process.exit(1);
}

main();
