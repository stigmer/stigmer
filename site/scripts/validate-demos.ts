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
 * 5. Test manifest generation — scans docs MDX files for <Demo*>
 *    component usage, maps each to its scenario ID and page URL,
 *    and writes e2e/demos/demo-manifest.json for Playwright.
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
  severity?: "error" | "warning";
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
// Check 5: Generate test manifest for Playwright
//
// Scans docs/**/*.mdx for <Demo*> component tags, maps each to a
// scenario ID (via the export map in src/components/docs/index.ts),
// and writes e2e/demos/demo-manifest.json. The Playwright specs read
// this file instead of hardcoding fixture arrays.
// ============================================================================

const DOCS_DIR = path.join(process.cwd(), "..", "docs");
const DEMO_EXPORTS_FILE = path.join(
  process.cwd(),
  "src/components/docs/index.ts",
);
const MANIFEST_OUTPUT = path.join(
  process.cwd(),
  "e2e/demos/demo-manifest.json",
);

interface VisibilityContract {
  [stepIndex: string]: { targets: string[]; scrollContainer?: string };
}

interface DemoManifestEntry {
  scenarioId: string;
  pagePath: string;
  demoIndex: number;
  visibilityContract?: VisibilityContract;
}

/**
 * Parse src/components/docs/index.ts to build a map from MDX component
 * name (e.g. "DemoQuickstartTour") to scenario directory name
 * (e.g. "quickstart-tour"). This avoids fragile PascalCase-to-kebab
 * conversion for acronyms like MCP, OAuth, SSO, API.
 */
async function buildComponentToScenarioMap(): Promise<Map<string, string>> {
  const content = await fs.readFile(DEMO_EXPORTS_FILE, "utf-8");
  const map = new Map<string, string>();

  const re = /as\s+(Demo\w+)\s*\}\s*from\s*"\.\/demos\/scenarios\/([^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) {
    map.set(match[1], match[2]);
  }

  return map;
}

/**
 * Recursively find all .mdx files under a directory.
 */
async function findMdxFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith("_")) continue;
      results.push(...(await findMdxFiles(fullPath)));
    } else if (entry.name.endsWith(".mdx")) {
      results.push(fullPath);
    }
  }

  return results;
}

/**
 * Load co-located visibility.json files from scenario directories.
 * Returns a map from scenarioId to the parsed contract object.
 */
async function loadVisibilityContracts(): Promise<Map<string, VisibilityContract>> {
  const contracts = new Map<string, VisibilityContract>();
  const scenarios = await getScenarioDirs();

  for (const scenario of scenarios) {
    const visPath = path.join(SCENARIOS_DIR, scenario, "visibility.json");
    const content = await readFileIfExists(visPath);
    if (!content) continue;

    try {
      const parsed = JSON.parse(content);
      if (parsed.contract) {
        contracts.set(scenario, parsed.contract);
      }
    } catch {
      // Will be reported as a violation below
    }
  }

  return contracts;
}

async function generateTestManifest(
  violations: Violation[],
): Promise<void> {
  const componentMap = await buildComponentToScenarioMap();
  const visibilityContracts = await loadVisibilityContracts();
  const mdxFiles = await findMdxFiles(DOCS_DIR);
  const manifest: DemoManifestEntry[] = [];
  const scenariosInDocs = new Set<string>();

  const demoTagRe = /<(Demo\w+)\s*\/>/g;

  for (const mdxPath of mdxFiles.sort()) {
    const content = await fs.readFile(mdxPath, "utf-8");
    const relativePath = path.relative(DOCS_DIR, mdxPath);
    const pagePath = "/docs/" + relativePath.replace(/\.mdx$/, "");

    let demoIndex = 0;
    let tagMatch: RegExpExecArray | null;
    while ((tagMatch = demoTagRe.exec(content)) !== null) {
      const componentName = tagMatch[1];
      const scenarioId = componentMap.get(componentName);

      if (!scenarioId) {
        violations.push({
          scenario: relativePath,
          check: "test-manifest",
          message: `Unknown demo component <${componentName} /> — not found in docs/index.ts exports.`,
        });
        demoIndex++;
        continue;
      }

      const entry: DemoManifestEntry = { scenarioId, pagePath, demoIndex };
      const contract = visibilityContracts.get(scenarioId);
      if (contract) {
        entry.visibilityContract = contract;
      }

      manifest.push(entry);
      scenariosInDocs.add(scenarioId);
      demoIndex++;
    }
  }

  // Flag scenarios in the registry that aren't embedded in any docs page
  const scenarios = await getScenarioDirs();
  for (const scenario of scenarios) {
    const hasSteps = await fileExists(
      path.join(SCENARIOS_DIR, scenario, "steps.ts"),
    );
    if (hasSteps && !scenariosInDocs.has(scenario)) {
      violations.push({
        scenario,
        check: "test-manifest",
        severity: "warning",
        message:
          "Playback scenario has steps.ts but is not embedded in any docs page. " +
          "Orphaned demo will not be tested by Playwright.",
      });
    }
  }

  await fs.mkdir(path.dirname(MANIFEST_OUTPUT), { recursive: true });
  await fs.writeFile(
    MANIFEST_OUTPUT,
    JSON.stringify(manifest, null, 2) + "\n",
  );

  const withContracts = manifest.filter((e) => e.visibilityContract).length;
  console.log(
    `Generated test manifest: ${manifest.length} demo(s) across ` +
      `${new Set(manifest.map((e) => e.pagePath)).size} page(s)` +
      ` (${withContracts} with visibility contracts)\n`,
  );
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
  await generateTestManifest(violations);

  const errors = violations.filter((v) => v.severity !== "warning");
  const warnings = violations.filter((v) => v.severity === "warning");

  if (warnings.length > 0) {
    console.log(`${warnings.length} warning(s):\n`);
    for (const w of warnings) {
      console.log(`  ${w.scenario}/`);
      console.log(`    [${w.check}] ${w.message}\n`);
    }
  }

  if (errors.length === 0) {
    console.log("All demos pass validation checks.\n");
    process.exit(0);
  }

  console.log(`Found ${errors.length} error(s):\n`);

  const byScenario = new Map<string, Violation[]>();
  for (const v of errors) {
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
