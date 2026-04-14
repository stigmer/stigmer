/**
 * Demo Validation Script for Stigmer Documentation Demos
 *
 * Checks all playback demo scenarios for common quality issues:
 *
 * 1. Token compliance — flags hardcoded pixel font sizes and inline
 *    zoom values in scenario index.tsx files.
 * 2. Manifest alignment — checks that manifest.json step counts match
 *    steps.ts step counts for each scenario.
 * 3. Shell height tokens — verifies that view files use DEMO_SHELL_HEIGHT
 *    (not DEMO_VIDEO_SHELL_HEIGHT or DEMO_SHELL_HEIGHT_MAX) as the
 *    clamp ceiling in their height expressions.
 * 4. AppShell stgm scope — verifies that AppShell's root element
 *    includes the `stgm` class for consistent compact rendering.
 *
 * Interaction coverage (scroll-to visibility, cursor targets) is
 * validated by the Playwright demo test suite in e2e/demos/ which
 * checks real browser rendering instead of heuristic text matching.
 *
 * Usage: tsx scripts/validate-demos.ts
 */

import * as fs from "fs/promises";
import * as path from "path";

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
// Check 2: Manifest alignment
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
// Check 3: Shell height token usage in view files
// ============================================================================

const VIEWS_DIR = path.join(
  process.cwd(),
  "src/components/docs/demos/views",
);

const SHELL_HEIGHT_VIEW_FILES = [
  "AppShell.tsx",
  "TerminalView.tsx",
  "ManagementShell.tsx",
  "CodeEditorView.tsx",
  "APIExchangeView.tsx",
];

const VIDEO_ONLY_HEIGHT_TOKENS = [
  "DEMO_VIDEO_SHELL_HEIGHT",
  "DEMO_SHELL_HEIGHT_MAX",
];

async function checkShellHeightTokens(
  violations: Violation[],
): Promise<void> {
  for (const fileName of SHELL_HEIGHT_VIEW_FILES) {
    const filePath = path.join(VIEWS_DIR, fileName);
    const content = await readFileIfExists(filePath);
    if (!content) continue;

    if (!content.includes("--demo-shell-height")) continue;

    for (const badToken of VIDEO_ONLY_HEIGHT_TOKENS) {
      if (content.includes(badToken)) {
        violations.push({
          scenario: `views/${fileName}`,
          check: "shell-height-tokens",
          message:
            `References ${badToken} which is for video export only. ` +
            `Use DEMO_SHELL_HEIGHT as the clamp ceiling for the docs site.`,
        });
      }
    }
  }
}

// ============================================================================
// Check 4: AppShell must include the `stgm` CSS scope
//
// The `stgm` class applies line-height: 1.5, font smoothing, and a
// border reset that gives the demo sidebar its compact, polished look.
// Without it, the sidebar renders in the docs page's default CSS
// context with looser line-height and inconsistent borders.
// ============================================================================

async function checkAppShellStgmScope(
  violations: Violation[],
): Promise<void> {
  const filePath = path.join(VIEWS_DIR, "AppShell.tsx");
  const content = await readFileIfExists(filePath);
  if (!content) return;

  const hasStgmOnRoot =
    /className="[^"]*\bstgm\b[^"]*"/.test(content) ||
    /className=\{[^}]*\bstgm\b/.test(content);

  if (!hasStgmOnRoot) {
    violations.push({
      scenario: "views/AppShell.tsx",
      check: "appshell-stgm-scope",
      message:
        `AppShell root element is missing the "stgm" CSS class. ` +
        `Add it to ensure consistent compact rendering across all demo steps.`,
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
    await checkManifestAlignment(scenario, violations);
  }

  await checkShellHeightTokens(violations);
  await checkAppShellStgmScope(violations);

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
