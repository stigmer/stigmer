#!/usr/bin/env node

/**
 * Verifies the PUBLISHED shape of @stigmer/runner: packs this package,
 * installs the tarball into a fresh prefix exactly the way an embedder
 * does (`npm install <pkg> --omit=dev`), and boots the staged dist in
 * manager mode via verify-dist-boot.mjs.
 *
 * Why this exists (stigmer/stigmer#786): every other gate — vitest,
 * verify:dist, conformance — runs against the REPO's lockfile-resolved
 * node_modules, so none of them can see what a consumer's fresh install
 * resolves from the manifest's version ranges. 3.11.0 added a direct
 * `@temporalio/proto` dependency (the encryption payload codec's eager
 * import); with mixed @temporalio ranges a fresh install resolved TWO
 * copies of the Temporal core-sdk proto tree (proto@1.16.x hoisted at the
 * root next to worker@1.22.x with its own nested proto@1.22.x), and the
 * second registration of the `coresdk` protobufjs namespace killed
 * manager init with "duplicate name 'ActivityHeartbeat'" — on every
 * embedder, invisible to CI. This script closes that class: any future
 * dependency whose consumer-resolution breaks module loading fails here,
 * in CI and again in the release workflow right before `npm publish`.
 *
 * Three checks, cheapest first:
 *
 *   1. Manifest policy: every @temporalio/* dependency (dev included)
 *      must be pinned EXACT and IDENTICAL. Temporal pins its own
 *      siblings exactly (worker@X requires proto@X), so any range mix
 *      lets npm resolve a split tree; and because the published package
 *      ships no lockfile, loose ranges also mean consumers run Temporal
 *      versions our CI never tested. Exact pins make the consumer tree
 *      byte-identical (in the dimension that matters) to the lockfile
 *      tree CI verifies; upgrades are deliberate manifest+lockfile moves.
 *   2. Tree shape: the staged install must contain exactly ONE physical
 *      copy of @temporalio/proto (a second copy is the #786 crash even
 *      when versions LOOK consistent).
 *   3. Boot: the staged dist/main.js must complete all module loading
 *      (verify-dist-boot.mjs's sentinel-dial technique — no Temporal
 *      server needed).
 *
 * The dev-tree `file:` link to @stigmer/protos cannot resolve from
 * inside a packed tarball, so when the manifest still carries it (every
 * context except the release workflow, which pins the published version
 * before packing) the script packs the local stubs too and points the
 * spec at that tarball — @temporalio and friends still resolve live
 * from the registry, which is exactly the consumer reality under test.
 *
 * Needs network (registry install) and a prior `npm run build` (and
 * built stub dist). Runs in ~1–2 minutes; wired into ci.runner and the
 * npm release workflows.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const runnerDir = fileURLToPath(new URL("..", import.meta.url));
const protosDir = join(runnerDir, "..", "..", "..", "apis", "stubs", "ts");
const bootCheck = join(runnerDir, "scripts", "verify-dist-boot.mjs");

function fail(message) {
  console.error(`verify-consumer-install: FAIL — ${message}`);
  process.exit(1);
}

function npm(args, cwd) {
  return execFileSync("npm", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
}

// ─── Check 1: @temporalio manifest policy ────────────────────────────────────

const manifestPath = join(runnerDir, "package.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

const temporalSpecs = Object.entries({
  ...manifest.dependencies,
  ...manifest.devDependencies,
}).filter(([name]) => name.startsWith("@temporalio/"));

const exactVersions = new Set(temporalSpecs.map(([, spec]) => spec));
const inexact = temporalSpecs.filter(([, spec]) => !/^\d+\.\d+\.\d+$/.test(spec));
if (inexact.length > 0 || exactVersions.size !== 1) {
  fail(
    `@temporalio/* dependencies must be pinned exact and identical ` +
      `(Temporal pins its siblings exactly, so mixed ranges resolve a split ` +
      `tree in consumer installs — the #786 crash). Found: ` +
      temporalSpecs.map(([name, spec]) => `${name}@${spec}`).join(", "),
  );
}
console.log(
  `verify-consumer-install: @temporalio family pinned at ${[...exactVersions][0]}`,
);

// ─── Pack the runner (and the local proto stubs when still file:-linked) ────

if (!existsSync(join(runnerDir, "dist", "main.js"))) {
  fail("dist/main.js not found — run `npm run build` first");
}

const workDir = mkdtempSync(join(tmpdir(), "stigmer-consumer-install-"));
process.on("exit", () => rmSync(workDir, { recursive: true, force: true }));

const protosSpec = manifest.dependencies["@stigmer/protos"];
const needsProtosRewrite = typeof protosSpec === "string" && protosSpec.startsWith("file:");

let runnerTarball;
const originalManifest = readFileSync(manifestPath, "utf8");
try {
  if (needsProtosRewrite) {
    if (!existsSync(join(protosDir, "dist"))) {
      fail("@stigmer/protos dist not built — run `npm run build -w @stigmer/protos` at the repo root first");
    }
    const [protosPack] = JSON.parse(npm(["pack", "--json", "--pack-destination", workDir], protosDir));
    manifest.dependencies["@stigmer/protos"] = `file:${join(workDir, protosPack.filename)}`;
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
    console.log("verify-consumer-install: packed local @stigmer/protos (dev file: link rewritten for the tarball)");
  }
  const [runnerPack] = JSON.parse(npm(["pack", "--json", "--pack-destination", workDir], runnerDir));
  runnerTarball = join(workDir, runnerPack.filename);
} finally {
  writeFileSync(manifestPath, originalManifest);
}

// ─── Install the tarball the way an embedder does ────────────────────────────

const stagingDir = join(workDir, "staging");
console.log("verify-consumer-install: fresh consumer install (registry resolution, --omit=dev)...");
npm(
  ["install", runnerTarball, "--prefix", stagingDir, "--omit=dev", "--no-audit", "--no-fund", "--loglevel=error"],
  workDir,
);

// ─── Check 2: exactly one physical copy of @temporalio/proto ────────────────

// `npm ls --parseable --all` prints the resolved filesystem path for every
// dependency edge; deduped edges repeat the same path, so the set of unique
// paths is the set of physical copies.
const protoCopies = [
  ...new Set(
    npm(["ls", "@temporalio/proto", "--parseable", "--all"], stagingDir)
      .split("\n")
      .filter((line) => line.includes(join("@temporalio", "proto"))),
  ),
];

if (protoCopies.length !== 1) {
  fail(
    `expected exactly one installed copy of @temporalio/proto, found ${protoCopies.length}:\n` +
      protoCopies.map((p) => `  ${p}`).join("\n") +
      `\nA second copy registers the coresdk protobufjs namespace twice and kills ` +
      `manager init (#786). Check the @temporalio version pins.`,
  );
}
console.log(`verify-consumer-install: single @temporalio/proto copy at ${protoCopies[0]}`);

// ─── Check 3: boot the staged install ────────────────────────────────────────

const stagedMain = join(stagingDir, "node_modules", "@stigmer", "runner", "dist", "main.js");
console.log("verify-consumer-install: booting the staged install...");
execFileSync(process.execPath, [bootCheck, stagedMain], { stdio: "inherit" });

console.log("verify-consumer-install: PASS — consumer-style install resolves one Temporal tree and boots");
