// Every published Stigmer package states a Node floor its own @stigmer/*
// dependencies accept, and every page that states a package's floor says the
// one its manifest declares.
// Run via `node --test scripts/package-node-floors.test.mjs` (wired into root
// `npm run test:root`).
//
// `engines.node` is each package's only statement of the Node it needs: no
// published package checks `process.version`, and `scripts/publish-libs.mjs`
// copies `engines` into the published manifest as declared. npm warns
// (`EBADENGINE`) when the running Node is outside a package's range, and
// refuses under `engine-strict`. A package that declares a looser floor than a
// @stigmer/* package it installs tells its user "fine" on a Node its own
// dependency calls unsupported: `@stigmer/client` said `>=22` while
// `@stigmer/session-log`, which it installs, says `^22.13.0 || >=23.4.0`.
//
// Rule 1. For every non-private @stigmer/* manifest, each @stigmer/* package it
// installs (a runtime dependency, or a peer not marked optional) that declares
// `engines.node` must accept no fewer Nodes than the package does:
// `semver.subset(package, dependency)`. A package with no floor while such a
// dependency has one is refused too. Pairwise is enough: `subset` is
// transitive, so a package within its dependencies' floors is within theirs.
//
// Rule 2. The pages in STATED_FLOORS state a package's floor in prose, and
// `docs/AGENTS.md` gives a version literal one owner. Each page must hold
// `floorWords` of that package's `engines.node`, the house wording the CLI's
// floor already uses ("Node.js 22 (22.19 or newer) or Node.js 24 or newer"),
// compared with whitespace collapsed because the docs formatter rewraps prose.
//
// Each rule is a pure function over a file list and a reader, run here over the
// tracked tree and over fixtures of each refusal, so a rule that stopped
// refusing would fail its fixture rather than pass on nothing.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import semver from "semver";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const SCOPE = "@stigmer/";

/** The pages that state a package's Node floor in prose, and the package each states. */
export const STATED_FLOORS = [
  { page: "docs/sdk/ink/cli-integration.mdx", pkg: "@stigmer/ink-ui" },
  { page: "sdk/typescript/README.md", pkg: "@stigmer/client" },
];

/** Every tracked @stigmer/* manifest, by package name: name -> { path, manifest }. */
export function stigmerManifests(files, read) {
  const byName = new Map();
  for (const path of files) {
    if (path !== "package.json" && !path.endsWith("/package.json")) continue;
    let manifest;
    try {
      manifest = JSON.parse(read(path));
    } catch {
      continue;
    }
    if (typeof manifest.name !== "string" || !manifest.name.startsWith(SCOPE)) continue;
    const seen = byName.get(manifest.name);
    if (seen) throw new Error(`${manifest.name} is named by both ${seen.path} and ${path}`);
    byName.set(manifest.name, { path, manifest });
  }
  return byName;
}

/** The @stigmer/* packages a manifest installs: runtime dependencies and required peers. */
export function installedStigmerPackages(manifest) {
  const optionalPeer = (name) => manifest.peerDependenciesMeta?.[name]?.optional === true;
  const names = [
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}).filter((name) => !optionalPeer(name)),
  ];
  return [...new Set(names.filter((name) => name.startsWith(SCOPE)))].sort();
}

/** Rule 1. `files` are repository paths, `read` returns a file's text. */
export function floorsBelowDependencies(files, read) {
  const manifests = stigmerManifests(files, read);
  const problems = [];
  for (const [name, { path, manifest }] of manifests) {
    if (manifest.private === true) continue;
    const mine = manifest.engines?.node;
    for (const dep of installedStigmerPackages(manifest)) {
      const found = manifests.get(dep);
      if (!found) {
        problems.push(`${name} (${path}) installs ${dep}, which no tracked manifest names, so its floor cannot be read`);
        continue;
      }
      const theirs = found.manifest.engines?.node;
      if (theirs === undefined) continue;
      if (mine === undefined) {
        problems.push(`${name} (${path}) declares no engines.node, but installs ${dep}, which needs '${theirs}'`);
      } else if (!semver.subset(mine, theirs)) {
        problems.push(`${name} (${path}) declares engines.node '${mine}', below ${dep}'s '${theirs}', which it installs`);
      }
    }
  }
  return problems;
}

/** The comparator `<(M+1).0.0-0` that semver writes as the top of a range inside major M. */
function isNextMajorCeiling(comparator, major) {
  const v = comparator.semver;
  return (
    comparator.operator === "<" &&
    v.major === major + 1 &&
    v.minor === 0 &&
    v.patch === 0 &&
    v.prerelease.length === 1 &&
    v.prerelease[0] === 0
  );
}

/** A lower bound as the house writes it: "22", "22.13", "22.13.1". */
function bound(v) {
  if (v.minor === 0 && v.patch === 0) return `${v.major}`;
  if (v.patch === 0) return `${v.major}.${v.minor}`;
  return `${v.major}.${v.minor}.${v.patch}`;
}

/**
 * A Node range in the house's words. Each `||` part is a lower bound, open
 * ("Node.js 23.4 or newer") or held inside its major ("Node.js 22 (22.13 or
 * newer)"); parts join with "or". Any other shape throws, naming the range, so
 * a new kind of floor fails loudly instead of being worded wrong.
 */
export function floorWords(range) {
  const parsed = new semver.Range(range);
  return parsed.set
    .map((part) => {
      const [low, high, ...rest] = part;
      const shapeless = () => new Error(`engines.node '${range}' has a part ('${part.join(" ")}') floorWords cannot word`);
      if (rest.length > 0 || low === undefined || low.operator !== ">=" || low.semver.prerelease.length > 0) throw shapeless();
      const v = low.semver;
      if (high === undefined) return `Node.js ${bound(v)} or newer`;
      if (!isNextMajorCeiling(high, v.major)) throw shapeless();
      return v.minor === 0 && v.patch === 0 ? `Node.js ${v.major}` : `Node.js ${v.major} (${bound(v)} or newer)`;
    })
    .join(" or ");
}

const collapse = (text) => text.replace(/\s+/g, " ");

/** Rule 2. Each page in `stated` holds the words of its package's `engines.node`. */
export function statedFloorsDrift(files, read, stated = STATED_FLOORS) {
  const manifests = stigmerManifests(files, read);
  const problems = [];
  for (const { page, pkg } of stated) {
    const found = manifests.get(pkg);
    const range = found?.manifest.engines?.node;
    if (range === undefined) {
      problems.push(`${page} states ${pkg}'s floor, but ${pkg} declares no engines.node`);
      continue;
    }
    const words = floorWords(range);
    if (!files.includes(page)) {
      problems.push(`${page} is listed as stating ${pkg}'s floor, but is not tracked`);
    } else if (!collapse(read(page)).includes(words)) {
      problems.push(`${page} does not state ${pkg}'s floor '${range}' as "${words}"`);
    }
  }
  return problems;
}

const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" })
  .split("\0")
  .filter(Boolean);
const readTracked = (path) => readFileSync(join(root, path), "utf8");

test("every published @stigmer/* package declares a Node floor its @stigmer/* dependencies accept", () => {
  assert.deepEqual(floorsBelowDependencies(tracked, readTracked), []);
});

test("every page that states a package's Node floor states the one its manifest declares", () => {
  assert.deepEqual(statedFloorsDrift(tracked, readTracked), []);
});

test("the guard still reads the packages it exists for", () => {
  // If the manifest walk broke, rule 1 would pass on nothing.
  const manifests = stigmerManifests(tracked, readTracked);
  for (const name of ["@stigmer/client", "@stigmer/react-core", "@stigmer/react-sdk", "@stigmer/ink-ui", "@stigmer/mcp-server"]) {
    const found = manifests.get(name);
    assert.ok(found, `${name} is found`);
    assert.notEqual(found.manifest.private, true, `${name} is published`);
    assert.equal(typeof found.manifest.engines?.node, "string", `${name} declares a floor`);
    assert.ok(installedStigmerPackages(found.manifest).length > 0, `${name} installs a @stigmer/* package`);
  }
  assert.deepEqual(installedStigmerPackages(manifests.get("@stigmer/client").manifest), ["@stigmer/apis", "@stigmer/session-log"]);
});

/** A fixture tree: path -> text. */
function fixture(files) {
  return {
    files: Object.keys(files),
    read: (path) => {
      if (!(path in files)) throw new Error(`no fixture file ${path}`);
      return files[path];
    },
  };
}

const lib = (node) => JSON.stringify({ name: "@stigmer/lib", engines: node === undefined ? undefined : { node } });

test("rule 1 refuses a dependency or a required peer above the package's floor, and a missing floor", () => {
  const family = "^22.13.0 || >=23.4.0";
  const tree = fixture({
    "lib/package.json": lib(family),
    "loose-dep/package.json": JSON.stringify({ name: "@stigmer/loose-dep", engines: { node: ">=22" }, dependencies: { "@stigmer/lib": "1.0.0" } }),
    "loose-peer/package.json": JSON.stringify({ name: "@stigmer/loose-peer", engines: { node: ">=18" }, peerDependencies: { "@stigmer/lib": "1.0.0" } }),
    "no-floor/package.json": JSON.stringify({ name: "@stigmer/no-floor", dependencies: { "@stigmer/lib": "1.0.0" } }),
    "dangling/package.json": JSON.stringify({ name: "@stigmer/dangling", engines: { node: family }, dependencies: { "@stigmer/gone": "1.0.0" } }),
    // Accepted: an optional peer, a matching floor, a stricter one, a dev-only
    // dependency, a private package, and a dependency outside the scope.
    "optional-peer/package.json": JSON.stringify({
      name: "@stigmer/optional-peer",
      engines: { node: ">=18" },
      peerDependencies: { "@stigmer/lib": "1.0.0" },
      peerDependenciesMeta: { "@stigmer/lib": { optional: true } },
    }),
    "matching/package.json": JSON.stringify({ name: "@stigmer/matching", engines: { node: family }, dependencies: { "@stigmer/lib": "1.0.0" } }),
    "stricter/package.json": JSON.stringify({ name: "@stigmer/stricter", engines: { node: ">=22.19.0 <23 || >=24" }, dependencies: { "@stigmer/lib": "1.0.0" } }),
    "dev-only/package.json": JSON.stringify({ name: "@stigmer/dev-only", engines: { node: ">=18" }, devDependencies: { "@stigmer/lib": "1.0.0" } }),
    "private/package.json": JSON.stringify({ name: "@stigmer/private", private: true, engines: { node: ">=18" }, dependencies: { "@stigmer/lib": "1.0.0" } }),
    "outside/package.json": JSON.stringify({ name: "outside", engines: { node: ">=18" }, dependencies: { "@stigmer/lib": "1.0.0" } }),
  });
  const problems = floorsBelowDependencies(tree.files, tree.read);
  assert.equal(problems.length, 4, problems.join("\n"));
  for (const says of [
    /^@stigmer\/loose-dep \(loose-dep\/package\.json\) declares engines\.node '>=22', below @stigmer\/lib's '\^22\.13\.0 \|\| >=23\.4\.0'/,
    /^@stigmer\/loose-peer .* '>=18', below @stigmer\/lib's/,
    /^@stigmer\/no-floor .* declares no engines\.node, but installs @stigmer\/lib/,
    /^@stigmer\/dangling .* installs @stigmer\/gone, which no tracked manifest names/,
  ]) {
    assert.ok(problems.some((p) => says.test(p)), `refused: ${says}`);
  }
});

test("rule 1 refuses two manifests that claim one name", () => {
  const tree = fixture({ "a/package.json": lib(">=18"), "b/package.json": lib(">=18") });
  assert.throws(() => floorsBelowDependencies(tree.files, tree.read), /@stigmer\/lib is named by both a\/package\.json and b\/package\.json/);
});

test("floorWords writes each range shape the house uses, and throws on any other", () => {
  assert.equal(floorWords("^22.13.0 || >=23.4.0"), "Node.js 22 (22.13 or newer) or Node.js 23.4 or newer");
  assert.equal(floorWords(">=22.19.0 <23 || >=24"), "Node.js 22 (22.19 or newer) or Node.js 24 or newer");
  assert.equal(floorWords(">=18"), "Node.js 18 or newer");
  assert.equal(floorWords("^22.13.1"), "Node.js 22 (22.13.1 or newer)");
  assert.equal(floorWords("22.x"), "Node.js 22");
  for (const shapeless of ["<23", "*", ">=22 <24", "^22.13.0-rc.1", "22.13.0"]) {
    assert.throws(
      () => floorWords(shapeless),
      (err) => err instanceof Error && err.message.startsWith(`engines.node '${shapeless}' has a part`),
      shapeless,
    );
  }
});

test("rule 2 refuses a page that states another floor, and accepts the words across a line break", () => {
  const manifest = JSON.stringify({ name: "@stigmer/kit", engines: { node: "^22.13.0 || >=23.4.0" } });
  const stated = [{ page: "docs/kit.mdx", pkg: "@stigmer/kit" }];
  const run = (files) => {
    const tree = fixture(files);
    return statedFloorsDrift(tree.files, tree.read, stated);
  };
  assert.deepEqual(
    run({
      "kit/package.json": manifest,
      "docs/kit.mdx": "**Prerequisites**: Node.js 22 (22.13 or newer) or Node.js\n23.4 or newer on the machine that runs your tool.\n",
    }),
    [],
  );
  const stale = run({ "kit/package.json": manifest, "docs/kit.mdx": "**Prerequisites**: Node.js 18 or later.\n" });
  assert.deepEqual(stale, [`docs/kit.mdx does not state @stigmer/kit's floor '^22.13.0 || >=23.4.0' as "Node.js 22 (22.13 or newer) or Node.js 23.4 or newer"`]);
  assert.match(run({ "kit/package.json": manifest })[0], /docs\/kit\.mdx is listed .* but is not tracked/);
  assert.match(
    run({ "kit/package.json": JSON.stringify({ name: "@stigmer/kit" }), "docs/kit.mdx": "" })[0],
    /declares no engines\.node/,
  );
});
