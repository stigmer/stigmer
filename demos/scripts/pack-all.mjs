#!/usr/bin/env node
/**
 * Pack every tour under demos/tours into a static embed bundle.
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
 */
import { execFileSync } from "node:child_process";
import { readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
