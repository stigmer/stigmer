#!/usr/bin/env node
/**
 * Pack every tour under demos/tours into a static embed bundle, then shoot
 * stills for the tours that declare them.
 *
 * Used by the website release workflow (and locally via `npm run pack-all -w
 * @stigmer/demos`) to produce the bundles served at
 * https://stigmer.ai/demos/<tour>/. Output goes to demos/.bundles/<tour>/ —
 * a derived artifact, never committed (see demos/.gitignore).
 *
 * The compiled @stigmer/react stylesheet is a pack prerequisite (the tours
 * import sdk/react/dist/styles.css — see tours/_shared/stigmer-preview.tsx),
 * so this script always rebuilds it first: a stale stylesheet would silently
 * drift the tours from the components they depict.
 *
 * Stills: a tour that declares `shot` names on its steps gets `scenar shoot`
 * run on its packed bundle, landing stills/<shot>.<theme>.png inside the
 * bundle and rebuilding the pack manifest — so the existing deploy copy
 * ships them with zero pipeline changes, and docs `<Still>` tags resolve at
 * stigmer.ai/demos/<tour>/stills/. Only shot-declaring tours are shot: a
 * browser launch for the others would be pure deploy time and pure failure
 * surface. Shot discovery shares scripts/tour-shots.mjs with the CI gate
 * (verify-scenar-tours invariant 8), so the pipeline can never disagree
 * with the gate about what a tour declares. Shooting requires Playwright
 * Chromium (see release.website.yaml; locally: npx playwright install
 * chromium). No --verify here: the determinism gate is an authoring-loop
 * tool and within-machine by design — it does not belong in a deploy.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { collectShotNames, findStepsArray } from "../../scripts/tour-shots.mjs";

const require = createRequire(import.meta.url);

const demosDir = dirname(dirname(fileURLToPath(import.meta.url)));
const repoRoot = dirname(demosDir);
const toursDir = join(demosDir, "tours");
const bundlesDir = join(demosDir, ".bundles");

/**
 * The workspace's own `@scenar/cli` bin, resolved through Node rather than
 * PATH.
 *
 * `npx scenar` resolves against PATH, which finds a globally-installed
 * `scenar` before the workspace copy whenever the CLI hoists to the root
 * `node_modules/.bin` — a stale global fails with "unknown command 'pack'"
 * or, worse, silently packs with the wrong engine. Resolving the package's
 * own entry point and running its bin under the current Node makes the
 * version we pack with exactly the version this workspace declares, on any
 * machine. (Resolved via the package's `.` export, since its `exports` map
 * deliberately does not expose `package.json`.)
 */
const scenarCliDir = dirname(dirname(require.resolve("@scenar/cli")));
const scenarCli = join(scenarCliDir, "bin", "scenar.js");

/** Tour directories: every child of tours/ except the shared library. */
const tours = readdirSync(toursDir, { withFileTypes: true })
  .filter((e) => e.isDirectory() && e.name !== "_shared")
  .map((e) => e.name)
  .sort();

if (tours.length === 0) {
  console.error("No tours found under demos/tours — nothing to pack.");
  process.exit(1);
}

/**
 * Which tours declare shots, read from each steps.ts the way the verify
 * gate (and `scenar narrate`) reads it: a dynamic import under the tsx
 * loader — runtime truth, so a shot name built from a constant is seen. An
 * import failure is fatal, never a silent skip: skipping would deploy a
 * docs page whose <Still> 404s, and a steps.ts that cannot import under
 * plain Node is already a defect the CI gate reports with more context.
 */
async function collectShotsByTour() {
  const { register } = await import("tsx/esm/api");
  register();
  const shotsByTour = new Map();
  for (const tour of tours) {
    const stepsPath = join(toursDir, tour, "steps.ts");
    const mod = await import(pathToFileURL(stepsPath).href);
    const steps = findStepsArray(mod);
    const shots = steps === null ? [] : collectShotNames(steps);
    if (shots.length > 0) shotsByTour.set(tour, shots);
  }
  return shotsByTour;
}

const shotsByTour = await collectShotsByTour();

console.log("Building @stigmer/react stylesheet (pack prerequisite)...");
execFileSync("npm", ["run", "build:css", "-w", "@stigmer/react"], {
  cwd: repoRoot,
  stdio: "inherit",
});

rmSync(bundlesDir, { recursive: true, force: true });

/**
 * The tours' canonical viewport — an explicit choice, never the CLI default.
 *
 * 1280x800: a real 16:10 desktop browser-window size, above the console's
 * own `lg` breakpoint (1024) and its layout minimum (280px sidebar + 48px
 * main padding + 896px `max-w-4xl` content cap = 1224px — the narrowest
 * window at which the console renders its content column at full design
 * width). Tours author at the console's real metrics and this single scale
 * factor at the viewport boundary does all the fitting (DD-008).
 *
 * `--stage` floats each beat on the backdrop with a window shadow — the
 * screen-recording framing (DD-009).
 */
const PACK_FLAGS = ["--width", "1280", "--shell-height", "800", "--stage"];

for (const tour of tours) {
  console.log(`\nPacking ${tour}...`);
  execFileSync(
    process.execPath,
    [
      scenarCli,
      "pack",
      join("tours", tour),
      "--out",
      resolve(bundlesDir, tour),
      ...PACK_FLAGS,
    ],
    { cwd: demosDir, stdio: "inherit" },
  );
}

console.log(`\nPacked ${tours.length} tour(s) into ${bundlesDir}`);

for (const [tour, shots] of shotsByTour) {
  console.log(`\nShooting ${tour} (${shots.length} shot(s): ${shots.join(", ")})...`);
  execFileSync(process.execPath, [scenarCli, "shoot", resolve(bundlesDir, tour)], {
    cwd: demosDir,
    stdio: "inherit",
  });
}

if (shotsByTour.size > 0) {
  console.log(`\nShot stills for ${shotsByTour.size} tour(s).`);
}
