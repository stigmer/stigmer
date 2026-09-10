#!/usr/bin/env node

/**
 * Verifies the PUBLISHED shape of a standalone @stigmer/* package — the
 * runner and the server, the two packages that live outside the root npm
 * workspaces with their own lockfiles. Packs the package, installs the
 * tarball into a fresh prefix exactly the way a consumer does
 * (`npm install <tarball> --omit=dev`), and proves the staged tree.
 *
 * Why this exists (stigmer/stigmer#786): every other gate — vitest,
 * verify:dist, conformance, the file:-linked extension-consumer typecheck —
 * runs against the REPO's lockfile-resolved node_modules, so none of them
 * can see what a consumer's fresh install resolves from the manifest's
 * version ranges. 3.11.0 added a direct `@temporalio/proto` dependency to
 * the runner; with mixed @temporalio ranges a fresh install resolved TWO
 * copies of the Temporal core-sdk proto tree, and the second registration
 * of the `coresdk` protobufjs namespace killed manager init with
 * "duplicate name 'ActivityHeartbeat'" — on every embedder, invisible to
 * CI. This script closes that class for both packages: any dependency
 * whose consumer-resolution breaks module loading fails here, in CI and
 * again in the release workflow right before `npm publish`.
 *
 * Hoisted from backend/services/runner/scripts (stigmer-cloud project
 * 20260910.04) when @stigmer/server became the second standalone package
 * to publish: one implementation, per-package facts declared in each
 * manifest under `stigmerPublish.consumerCheck`:
 *
 *   singleCopy        packages that must resolve to exactly ONE physical
 *                     copy in the staged tree (a second copy is a split
 *                     registry: the #786 coresdk crash for @temporalio/proto;
 *                     two proto registries for @bufbuild/protobuf; an inert
 *                     metrics emitter for @opentelemetry/api, the hazard
 *                     the cloud composition's rpc-metrics-composed.test.ts
 *                     was written against)
 *   boot              [script, ...flags], relative to the package: invoked
 *                     as `node <script> <staged main.js> ...flags` and must
 *                     exit 0 (the runner's sentinel-dial boot; the server's
 *                     verify-boot.mjs --require-workers against a Temporal
 *                     dev server)
 *   typecheckConsumer optional, relative to the repo root: a standalone
 *                     consumer package (test/extension-consumer) whose
 *                     @stigmer/* deps are re-pointed at the packed tarballs
 *                     and which must typecheck — the exports-map proof over
 *                     the PUBLISHED files, so a `files` omission or a
 *                     missing .d.ts fails here, not in the consumer's pin
 *                     bump
 *
 * Checks, cheapest first:
 *
 *   1. Manifest policy: every @temporalio/* dependency (dev included)
 *      must be pinned EXACT and IDENTICAL. Temporal pins its own siblings
 *      exactly (worker@X requires proto@X), so any range mix lets npm
 *      resolve a split tree; and because the published package ships no
 *      lockfile, loose ranges also mean consumers run Temporal versions
 *      our CI never tested.
 *   2. Tree shape: one physical copy of each `singleCopy` package.
 *   3. Boot: the staged dist/main.js completes module loading and its
 *      lifecycle under the package's own boot script.
 *   4. Consumer typecheck (when declared).
 *
 * The dev-tree `file:` links to the workspace libs (@stigmer/protos,
 * @stigmer/temporal-codecs, @stigmer/zip-structure) cannot resolve from
 * inside a packed tarball, so when the manifest still carries them (every
 * context except the release workflow, where publish-standalone.mjs pins
 * the published versions before this runs) the script packs each local lib
 * too and points its spec at that tarball — everything else still resolves
 * live from the registry, which is exactly the consumer reality under test.
 *
 * Usage (from the package directory, via its `verify:consumer` script):
 *   node ../../../scripts/verify-consumer-install.mjs
 * or explicitly:
 *   node scripts/verify-consumer-install.mjs --package backend/services/runner
 *
 * Needs network (registry install) and a prior `npm run build` of the
 * package and of every file:-linked lib. Runs in a few minutes.
 */

import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

function fail(message) {
  console.error(`verify-consumer-install: FAIL — ${message}`);
  process.exit(1);
}

function npm(args, cwd) {
  return execFileSync("npm", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
}

function readManifest(dir) {
  return JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
}

// ─── Resolve the package under test and its declared checks ─────────────────

const args = process.argv.slice(2);
const packageArg = args.includes("--package")
  ? args[args.indexOf("--package") + 1]
  : undefined;
const packageDir = packageArg
  ? isAbsolute(packageArg)
    ? packageArg
    : resolve(repoRoot, packageArg)
  : process.cwd();

const manifestPath = join(packageDir, "package.json");
if (!existsSync(manifestPath)) {
  fail(
    `no package.json at ${packageDir} (run from the package dir or pass --package <dir>)`,
  );
}
const manifest = readManifest(packageDir);
const check = manifest.stigmerPublish?.consumerCheck;
if (!check || !Array.isArray(check.singleCopy) || !Array.isArray(check.boot)) {
  fail(
    `${manifest.name} declares no stigmerPublish.consumerCheck ` +
      `({ singleCopy: string[], boot: string[], typecheckConsumer?: string }) — ` +
      `the checks are per-package facts and live in the manifest`,
  );
}
console.log(`verify-consumer-install: ${manifest.name} (${packageDir})`);

// ─── Check 1: @temporalio manifest policy ────────────────────────────────────

const temporalSpecs = Object.entries({
  ...manifest.dependencies,
  ...manifest.devDependencies,
}).filter(([name]) => name.startsWith("@temporalio/"));

const exactVersions = new Set(temporalSpecs.map(([, spec]) => spec));
const inexact = temporalSpecs.filter(
  ([, spec]) => !/^\d+\.\d+\.\d+$/.test(spec),
);
if (
  temporalSpecs.length > 0 &&
  (inexact.length > 0 || exactVersions.size !== 1)
) {
  fail(
    `@temporalio/* dependencies must be pinned exact and identical ` +
      `(Temporal pins its siblings exactly, so mixed ranges resolve a split ` +
      `tree in consumer installs — the #786 crash). Found: ` +
      temporalSpecs.map(([name, spec]) => `${name}@${spec}`).join(", "),
  );
}
if (temporalSpecs.length > 0) {
  console.log(
    `verify-consumer-install: @temporalio family pinned at ${[...exactVersions][0]}`,
  );
}

// ─── Pack the package (and the local workspace libs when still file:-linked) ─

if (!existsSync(join(packageDir, "dist", "main.js"))) {
  fail("dist/main.js not found — run `npm run build` first");
}

const workDir = mkdtempSync(join(tmpdir(), "stigmer-consumer-install-"));
process.on("exit", () => rmSync(workDir, { recursive: true, force: true }));

/**
 * Packs a directory and returns the tarball path. Memoised per directory so
 * a lib the package AND the consumer both link is packed once.
 */
const packed = new Map();
function packDir(dir) {
  const key = resolve(dir);
  if (!packed.has(key)) {
    if (!existsSync(join(key, "dist"))) {
      fail(
        `${key} has no dist — build the file:-linked libs first (npm run build:runner-deps at the repo root)`,
      );
    }
    const [result] = JSON.parse(
      npm(["pack", "--json", "--pack-destination", workDir], key),
    );
    packed.set(key, join(workDir, result.filename));
  }
  return packed.get(key);
}

/**
 * For a manifest's @stigmer/* dependencies, returns the spec a consumer
 * install can resolve: a packed tarball for each dev-tree `file:` link,
 * the spec itself otherwise (a version the release lane already pinned).
 */
function consumerResolvableSpecs(deps, baseDir) {
  const out = {};
  for (const [name, spec] of Object.entries(deps ?? {})) {
    if (!name.startsWith("@stigmer/")) continue;
    out[name] = spec.startsWith("file:")
      ? `file:${packDir(resolve(baseDir, spec.slice("file:".length)))}`
      : spec;
  }
  return out;
}

let tarball;
const originalManifest = readFileSync(manifestPath, "utf8");
try {
  const rewritten = consumerResolvableSpecs(manifest.dependencies, packageDir);
  const changed = Object.entries(rewritten).filter(
    ([name, spec]) => manifest.dependencies[name] !== spec,
  );
  if (changed.length > 0) {
    for (const [name, spec] of changed) {
      manifest.dependencies[name] = spec;
      console.log(
        `verify-consumer-install: packed local ${name} (dev file: link rewritten for the tarball)`,
      );
    }
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  }
  const [result] = JSON.parse(
    npm(["pack", "--json", "--pack-destination", workDir], packageDir),
  );
  tarball = join(workDir, result.filename);
} finally {
  writeFileSync(manifestPath, originalManifest);
}

// ─── Install the tarball the way a consumer does ─────────────────────────────

const stagingDir = join(workDir, "staging");
console.log(
  "verify-consumer-install: fresh consumer install (registry resolution, --omit=dev)...",
);
npm(
  [
    "install",
    tarball,
    "--prefix",
    stagingDir,
    "--omit=dev",
    "--no-audit",
    "--no-fund",
    "--loglevel=error",
  ],
  workDir,
);

// ─── Check 2: exactly one physical copy of each singleCopy package ──────────

// `npm ls --parseable --all` prints the resolved filesystem path for every
// dependency edge; deduped edges repeat the same path, so the set of unique
// paths is the set of physical copies.
for (const name of check.singleCopy) {
  const copies = [
    ...new Set(
      npm(["ls", name, "--parseable", "--all"], stagingDir)
        .split("\n")
        .filter((line) =>
          line.includes(join("node_modules", ...name.split("/"))),
        ),
    ),
  ];
  if (copies.length !== 1) {
    fail(
      `expected exactly one installed copy of ${name}, found ${copies.length}:\n` +
        copies.map((p) => `  ${p}`).join("\n") +
        `\nA second copy splits its registry (the #786 class). Check the version pins ` +
        `of ${manifest.name} against the libs it depends on.`,
    );
  }
  console.log(`verify-consumer-install: single ${name} copy at ${copies[0]}`);
}

// ─── Check 3: boot the staged install ────────────────────────────────────────

const stagedMain = join(
  stagingDir,
  "node_modules",
  ...manifest.name.split("/"),
  "dist",
  "main.js",
);
const [bootScript, ...bootFlags] = check.boot;
console.log(
  `verify-consumer-install: booting the staged install (${bootScript} ${bootFlags.join(" ")})...`,
);
execFileSync(
  process.execPath,
  [join(packageDir, bootScript), stagedMain, ...bootFlags],
  {
    stdio: "inherit",
  },
);

// ─── Check 4: a consumer typechecks against the published files ─────────────

if (check.typecheckConsumer) {
  const consumerSrc = resolve(repoRoot, check.typecheckConsumer);
  const consumerManifest = readManifest(consumerSrc);
  const consumerDir = join(workDir, "consumer");
  // The consumer's sources and config, never its node_modules or lockfile:
  // the install below must resolve from the tarballs and the registry alone.
  cpSync(consumerSrc, consumerDir, {
    recursive: true,
    filter: (src) =>
      !src.includes(`${join(consumerSrc, "node_modules")}`) &&
      !src.endsWith("package-lock.json"),
  });
  // The package under test resolves to ITS tarball; its own @stigmer/* deps
  // resolve exactly as the tarball's manifest says (so the consumer and the
  // package share one @stigmer/protos); anything else the consumer links
  // locally is packed from its own file: path.
  const packageSpecs = consumerResolvableSpecs(
    readManifest(packageDir).dependencies,
    packageDir,
  );
  for (const [name, spec] of Object.entries(
    consumerManifest.dependencies ?? {},
  )) {
    if (!name.startsWith("@stigmer/")) continue;
    if (name === manifest.name) {
      consumerManifest.dependencies[name] = `file:${tarball}`;
    } else if (packageSpecs[name]) {
      consumerManifest.dependencies[name] = packageSpecs[name];
    } else if (spec.startsWith("file:")) {
      consumerManifest.dependencies[name] =
        `file:${packDir(resolve(consumerSrc, spec.slice("file:".length)))}`;
    }
  }
  writeFileSync(
    join(consumerDir, "package.json"),
    JSON.stringify(consumerManifest, null, 2) + "\n",
  );
  console.log(
    `verify-consumer-install: typechecking ${consumerManifest.name} against the packed ${manifest.name}...`,
  );
  npm(["install", "--no-audit", "--no-fund", "--loglevel=error"], consumerDir);
  execFileSync("npm", ["run", "typecheck"], {
    cwd: consumerDir,
    stdio: "inherit",
  });
}

console.log(
  `verify-consumer-install: PASS — ${manifest.name} installs as a consumer sees it, resolves one copy of each guarded package, boots` +
    (check.typecheckConsumer
      ? ", and its consumer typechecks against the published files"
      : ""),
);
