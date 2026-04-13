/**
 * Demo Validation Script for Stigmer Documentation Demos
 *
 * Checks all playback demo scenarios for common quality issues:
 *
 * 1. Token compliance — flags hardcoded pixel font sizes and inline
 *    zoom values in scenario index.tsx files.
 * 2. Step interaction coverage — flags scenarios with narration that
 *    do not wire useStepInteractions.
 * 3. Manifest alignment — checks that manifest.json step counts match
 *    steps.ts step counts for each scenario.
 *
 * Usage: tsx scripts/validate-demos.ts
 */

import * as fs from "fs/promises";
import * as path from "path";
import { pathToFileURL } from "url";

const SCENARIOS_DIR = path.join(
  process.cwd(),
  "src/components/docs/demos/scenarios",
);
const MANIFESTS_DIR = path.join(process.cwd(), "public/demos");

const PIXEL_FONT_RE = /text-\[\d+px\]/g;
const INLINE_ZOOM_RE = /zoom:\s*[\d.]+(?!\s*\*)/g;

interface Violation {
  scenario: string;
  check: string;
  message: string;
}

async function getScenarioDirs(): Promise<string[]> {
  const entries = await fs.readdir(SCENARIOS_DIR, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readFileIfExists(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch {
    return null;
  }
}

// ============================================================================
// Check 1: Token compliance
// ============================================================================

async function checkTokenCompliance(
  scenario: string,
  violations: Violation[],
): Promise<void> {
  const indexPath = path.join(SCENARIOS_DIR, scenario, "index.tsx");
  const content = await readFileIfExists(indexPath);
  if (!content) return;

  const pixelMatches = content.match(PIXEL_FONT_RE);
  if (pixelMatches) {
    const unique = [...new Set(pixelMatches)];
    violations.push({
      scenario,
      check: "token-compliance",
      message: `Hardcoded pixel font sizes: ${unique.join(", ")}. Use Tailwind scale (text-xs, text-sm) instead.`,
    });
  }

  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const zoomMatches = line.match(INLINE_ZOOM_RE);
    if (zoomMatches) {
      const usesToken =
        line.includes("DEMO_CONTENT_ZOOM") ||
        line.includes("DEMO_BROWSER_ZOOM") ||
        line.includes("DEMO_SIDEBAR_ZOOM");
      if (!usesToken) {
        violations.push({
          scenario,
          check: "token-compliance",
          message: `Inline zoom value at line ${i + 1}: "${line.trim()}". Import from tokens.ts.`,
        });
      }
    }
  }
}

// ============================================================================
// Check 2: Step interaction coverage
// ============================================================================

async function checkInteractionCoverage(
  scenario: string,
  violations: Violation[],
): Promise<void> {
  const indexPath = path.join(SCENARIOS_DIR, scenario, "index.tsx");
  const stepsPath = path.join(SCENARIOS_DIR, scenario, "steps.ts");
  const content = await readFileIfExists(indexPath);
  const stepsContent = await readFileIfExists(stepsPath);
  if (!content || !stepsContent) return;

  const hasNarration = stepsContent.includes("narration:");
  if (!hasNarration) return;

  const narrationCount = (stepsContent.match(/narration:/g) || []).length;
  const hasInteractions = content.includes("useStepInteractions");

  if (narrationCount > 4 && !hasInteractions) {
    violations.push({
      scenario,
      check: "interaction-coverage",
      message: `${narrationCount} narrated steps but useStepInteractions is not wired. Add mid-step interactions for off-screen content.`,
    });
  }
}

// ============================================================================
// Check 3: Manifest alignment
// ============================================================================

async function checkManifestAlignment(
  scenario: string,
  violations: Violation[],
): Promise<void> {
  const manifestPath = path.join(MANIFESTS_DIR, scenario, "manifest.json");
  const stepsPath = path.join(SCENARIOS_DIR, scenario, "steps.ts");

  if (!(await fileExists(manifestPath)) || !(await fileExists(stepsPath))) {
    return;
  }

  const manifestContent = await readFileIfExists(manifestPath);
  if (!manifestContent) return;

  let manifest: { steps: unknown[] };
  try {
    manifest = JSON.parse(manifestContent);
  } catch {
    violations.push({
      scenario,
      check: "manifest-alignment",
      message: "manifest.json is not valid JSON.",
    });
    return;
  }

  const stepsContent = await fs.readFile(stepsPath, "utf-8");
  const stepsExportMatch = stepsContent.match(
    /:\s*ScenarioStep<[^>]+>\[\]\s*=\s*\[/,
  );
  if (!stepsExportMatch) return;

  const stepsArrayStart = stepsContent.indexOf(stepsExportMatch[0]);
  const afterStart = stepsContent.slice(stepsArrayStart);
  const delayCount = (afterStart.match(/delayMs:/g) || []).length;

  const manifestSteps = manifest.steps.length;
  if (delayCount !== manifestSteps) {
    violations.push({
      scenario,
      check: "manifest-alignment",
      message: `Step count mismatch: steps.ts has ${delayCount} steps, manifest.json has ${manifestSteps}. Regenerate narration.`,
    });
  }
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const scenarios = await getScenarioDirs();
  const violations: Violation[] = [];

  console.log(`Validating ${scenarios.length} demo scenarios...\n`);

  for (const scenario of scenarios) {
    await checkTokenCompliance(scenario, violations);
    await checkInteractionCoverage(scenario, violations);
    await checkManifestAlignment(scenario, violations);
  }

  if (violations.length === 0) {
    console.log("All demos pass validation checks.\n");
    process.exit(0);
  }

  console.log(`Found ${violations.length} violation(s):\n`);

  const byScenario = new Map<string, Violation[]>();
  for (const v of violations) {
    const list = byScenario.get(v.scenario) || [];
    list.push(v);
    byScenario.set(v.scenario, list);
  }

  for (const [scenario, items] of byScenario) {
    console.log(`  ${scenario}/`);
    for (const v of items) {
      console.log(`    [${v.check}] ${v.message}`);
    }
    console.log();
  }

  process.exit(1);
}

main().catch((err) => {
  console.error("Validation script failed:", err);
  process.exit(2);
});
