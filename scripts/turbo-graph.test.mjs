// Turborepo must see every workspace edge the publishable packages declare.
// Run via `node --test scripts/turbo-graph.test.mjs` (wired into root `npm test`).
//
// The regression this guards: Turborepo builds its package graph from
// dependencies, devDependencies and optionalDependencies, never from
// peerDependencies (vercel/turborepo#13025). @stigmer/sdk, @stigmer/react and
// @stigmer/ink name @stigmer/protos (and @stigmer/sdk) as peers, and mirror
// them into devDependencies so the graph has the edge. Drop a mirror and
// `turbo run build --filter=@stigmer/sdk` schedules sdk without protos, which
// only fails once the two builds race. This test reads turbo's own dry run and
// asserts that for every publishable package, every @stigmer/* it names in any
// dependency field is a `#build` it waits on.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { PACKAGES } from "./publish-libs.mjs";
import { dryRun, libsSet } from "./turbo-set.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function manifestOf(relDir) {
  return JSON.parse(readFileSync(join(root, relDir, "package.json"), "utf8"));
}

/** Every @stigmer/* name a manifest mentions in any dependency field. */
function declaredStigmerDeps(manifest) {
  const fields = [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
  ];
  const names = new Set();
  for (const field of fields) {
    for (const name of Object.keys(manifest[field] ?? {})) {
      if (name.startsWith("@stigmer/")) names.add(name);
    }
  }
  return names;
}

const plan = dryRun("libs", ["build"]);
const byId = new Map(plan.tasks.map((t) => [t.taskId, t]));

test("the dry run schedules exactly one build per publishable package", () => {
  const scheduled = [...byId.keys()].sort();
  const expected = libsSet()
    .map((name) => `${name}#build`)
    .sort();
  assert.deepEqual(scheduled, expected);
});

test("every workspace @stigmer/* a publishable package declares is a build it depends on", () => {
  const workspaceNames = new Set(libsSet());
  for (const relDir of PACKAGES) {
    const manifest = manifestOf(relDir);
    const task = byId.get(`${manifest.name}#build`);
    assert.ok(task, `${manifest.name}#build is in the plan`);
    for (const dep of declaredStigmerDeps(manifest)) {
      if (!workspaceNames.has(dep)) continue; // a registry dependency, not an edge
      assert.ok(
        task.dependencies.includes(`${dep}#build`),
        `${manifest.name} declares ${dep} but ${manifest.name}#build does not wait on ${dep}#build ` +
          `(peer-only? mirror it into devDependencies; turbo ignores peers)`,
      );
    }
  }
});

test("the three peer-only packages of 2026-09-10 wait on protos", () => {
  // Named explicitly so the failure reads as the history it is.
  for (const name of ["@stigmer/sdk", "@stigmer/react", "@stigmer/ink"]) {
    assert.ok(
      byId.get(`${name}#build`).dependencies.includes("@stigmer/protos#build"),
      `${name}#build must wait on @stigmer/protos#build`,
    );
  }
});

test("every build task caches dist/** and runs in strict env mode", () => {
  for (const task of byId.values()) {
    assert.deepEqual(
      task.resolvedTaskDefinition.outputs,
      ["dist/**"],
      `${task.taskId} outputs`,
    );
    assert.equal(task.envMode, "strict", `${task.taskId} env mode`);
  }
});
