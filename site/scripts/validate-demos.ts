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
 * 6. Auto-derived visibility contracts — parses INTERACTIONS and
 *    cursorTargetFor from each scenario's index.tsx to automatically
 *    generate visibility contracts. These are merged with manual
 *    visibility.json files (manual entries take precedence).
 *
 * Usage: tsx scripts/validate-demos.ts
 */

import * as fs from "fs/promises";
import * as path from "path";

const SCENARIOS_DIR = path.join(
  process.cwd(),
  "src/components/docs/demos/scenarios",
);
const MANIFESTS_DIR = path.join(
  process.cwd(),
  "src/components/docs/demos/scenarios",
);

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
  const manifestPath = path.join(MANIFESTS_DIR, scenario, "narration", "manifest.json");
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

// Only files that exist under views/ belong here — checkShellHeightTokens
// silently no-ops on missing files, so a stale entry is a check that can
// never fire (TerminalView/CodeEditorView were removed 2026-07-27; those
// shells live in @scenar/react now).
const SHELL_HEIGHT_VIEW_FILES = [
  "AppShell.tsx",
  "ManagementShell.tsx",
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

interface StepContract {
  targets: string[];
  scrollContainer?: string;
  cursorMustAlign?: string;
  mustBeCentered?: string;
}

interface VisibilityContract {
  [stepIndex: string]: StepContract;
}

interface DemoManifestEntry {
  scenarioId: string;
  pagePath: string;
  demoIndex: number;
  visibilityContract?: VisibilityContract;
}

/**
 * Parse src/components/docs/index.ts to build a map from MDX component
 * name (e.g. "DemoOAuthConnectFlow") to scenario directory name
 * (e.g. "oauth-connect-flow"). This avoids fragile PascalCase-to-kebab
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

// ============================================================================
// Check 6: Auto-derive visibility contracts from scenario source code
//
// Parses INTERACTIONS and cursorTargetFor from each scenario's index.tsx
// to build visibility contracts automatically. Merged with manual
// visibility.json (manual entries take precedence per step).
// ============================================================================

interface DerivedTarget {
  id: string;
  type: "scroll-target" | "cursor-target";
}

interface _DerivedStepContract {
  targets: DerivedTarget[];
  cursorMustAlign?: string;
}

/**
 * Extract the INTERACTIONS object literal from index.tsx source.
 * Returns a map of step index to derived targets.
 */
/**
 * Extract the INTERACTIONS object literal from index.tsx source.
 * Only extracts `scroll-to` targets (which must be visible for
 * scrolling to work). `set-cursor` targets are excluded because
 * they fire mid-step and the target element may be conditionally
 * rendered or only relevant at a specific point in the step.
 */
function parseInteractions(source: string): Map<number, DerivedTarget[]> {
  const result = new Map<number, DerivedTarget[]>();

  const blockMatch = source.match(
    /const\s+INTERACTIONS\s*:\s*StepInteractions\s*=\s*\{([\s\S]*?)\n\};/,
  );
  if (!blockMatch) return result;

  const block = blockMatch[1];

  const stepRe = /(\d+)\s*:\s*\[([\s\S]*?)\]/g;
  let stepMatch: RegExpExecArray | null;
  while ((stepMatch = stepRe.exec(block)) !== null) {
    const stepIndex = Number(stepMatch[1]);
    const actionsBlock = stepMatch[2];
    const targets: DerivedTarget[] = [];

    const actionRe = /type:\s*"(scroll-to)"[\s\S]*?target:\s*"([^"]+)"/g;
    let actionMatch: RegExpExecArray | null;
    while ((actionMatch = actionRe.exec(actionsBlock)) !== null) {
      targets.push({
        id: actionMatch[2],
        type: "scroll-target",
      });
    }

    if (targets.length > 0) {
      result.set(stepIndex, targets);
    }
  }

  return result;
}

/**
 * Extract view-name → cursor-target mappings from cursorTargetFor.
 * Returns a map from view name to target ID.
 */
function parseCursorTargetFor(source: string): Map<string, string> {
  const result = new Map<string, string>();

  const fnMatch = source.match(
    /function\s+cursorTargetFor[\s\S]*?\{([\s\S]*?)\n\}/,
  );
  if (!fnMatch) return result;

  const body = fnMatch[1];
  const caseRe = /case\s+"([^"]+)":\s*\n?\s*return\s+"([^"]+)"/g;
  let caseMatch: RegExpExecArray | null;
  while ((caseMatch = caseRe.exec(body)) !== null) {
    result.set(caseMatch[1], caseMatch[2]);
  }

  return result;
}

/**
 * Extract the ordered view names from steps.ts by finding
 * all `view: "..."` assignments in the steps array.
 * Returns an array of view names indexed by step index.
 */
function parseStepViews(stepsSource: string): string[] {
  const views: string[] = [];
  const viewRe = /view:\s*"([^"]+)"/g;

  const stepsStart = stepsSource.match(
    /:\s*ScenarioStep<[^>]+>\[\]\s*=\s*\[/,
  );
  if (!stepsStart) return views;

  const afterStart = stepsSource.slice(
    stepsSource.indexOf(stepsStart[0]),
  );

  let viewMatch: RegExpExecArray | null;
  while ((viewMatch = viewRe.exec(afterStart)) !== null) {
    views.push(viewMatch[1]);
  }

  return views;
}

/**
 * Build auto-derived visibility contract for a single scenario.
 */
async function deriveVisibilityContract(
  scenario: string,
): Promise<VisibilityContract | null> {
  const indexPath = path.join(SCENARIOS_DIR, scenario, "index.tsx");
  const stepsPath = path.join(SCENARIOS_DIR, scenario, "steps.ts");

  const indexSource = await readFileIfExists(indexPath);
  const stepsSource = await readFileIfExists(stepsPath);
  if (!indexSource || !stepsSource) return null;

  const interactions = parseInteractions(indexSource);
  const cursorTargets = parseCursorTargetFor(indexSource);
  const stepViews = parseStepViews(stepsSource);

  if (interactions.size === 0 && cursorTargets.size === 0) return null;

  const contract: VisibilityContract = {};

  for (const [stepIndex, targets] of interactions) {
    if (!contract[stepIndex]) {
      contract[stepIndex] = { targets: [] };
    }
    for (const t of targets) {
      contract[stepIndex].targets.push(t.id);
    }
  }

  for (const [viewName, targetId] of cursorTargets) {
    const stepIndex = stepViews.indexOf(viewName);
    if (stepIndex === -1) continue;

    if (!contract[stepIndex]) {
      contract[stepIndex] = { targets: [] };
    }
    if (!contract[stepIndex].targets.includes(targetId)) {
      contract[stepIndex].targets.push(targetId);
    }
    contract[stepIndex].cursorMustAlign = targetId;
  }

  return Object.keys(contract).length > 0 ? contract : null;
}

/**
 * Merge auto-derived and manual visibility contracts.
 * Manual entries take precedence per step.
 */
function mergeContracts(
  autoDerived: VisibilityContract | null,
  manual: VisibilityContract | undefined,
): VisibilityContract | undefined {
  if (!autoDerived && !manual) return undefined;
  if (!autoDerived) return manual;
  if (!manual) return autoDerived;

  const merged: VisibilityContract = { ...autoDerived };

  for (const [step, manualEntry] of Object.entries(manual)) {
    if (!merged[step]) {
      merged[step] = { ...manualEntry };
    } else {
      const combined = new Set([
        ...merged[step].targets,
        ...manualEntry.targets,
      ]);
      merged[step] = {
        ...merged[step],
        ...manualEntry,
        targets: [...combined],
      };
    }
  }

  return merged;
}

async function generateTestManifest(
  violations: Violation[],
): Promise<void> {
  const componentMap = await buildComponentToScenarioMap();
  const manualContracts = await loadVisibilityContracts();

  const derivedContracts = new Map<string, VisibilityContract | null>();
  const scenarios = await getScenarioDirs();
  for (const scenario of scenarios) {
    derivedContracts.set(scenario, await deriveVisibilityContract(scenario));
  }
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
      const manual = manualContracts.get(scenarioId);
      const derived = demoIndex === 0
        ? derivedContracts.get(scenarioId) ?? null
        : null;
      const merged = mergeContracts(derived, manual);
      if (merged) {
        entry.visibilityContract = merged;
      }

      manifest.push(entry);
      scenariosInDocs.add(scenarioId);
      demoIndex++;
    }
  }

  // Flag scenarios in the registry that aren't embedded in any docs page
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
  const withManual = manifest.filter(
    (e) => manualContracts.has(e.scenarioId),
  ).length;
  const withDerived = manifest.filter(
    (e) => derivedContracts.get(e.scenarioId) != null,
  ).length;
  console.log(
    `Generated test manifest: ${manifest.length} demo(s) across ` +
      `${new Set(manifest.map((e) => e.pagePath)).size} page(s)` +
      ` (${withContracts} with visibility contracts: ` +
      `${withDerived} auto-derived, ${withManual} manual)\n`,
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
