// The shape the Enterprise package's public promises rest on.
// Run via `node --test scripts/ee-package.test.mjs` (wired into root
// `npm run test:root`).
//
// ee/ holds Stigmer Enterprise, under the Stigmer Enterprise License
// (ee/LICENSE); everything else is Apache 2.0. Two facts about the tree are
// what keep that split true, and nothing else holds them:
//
// 1. Nothing outside ee/ reaches into it. ee/README.md promises it ("Nothing
//    outside this directory imports from it"), and it is why the open-source
//    server, its libraries and its images carry no Enterprise code. So no
//    tracked source file outside ee/ may import a path under ee/ or name
//    @stigmer/enterprise, and no manifest outside ee/ may depend on it.
//
// 2. The package shares the server's runtime dependencies at the server's own
//    specs. ee/server links @stigmer/server with `file:` and runs inside the
//    same process, so a shared dependency at a different spec (pg, a protobuf
//    runtime) installs a second copy beside the server's: two registries, two
//    connection pools, an `instanceof` that fails across them. The
//    consumer-install check proves one copy only of the server's `singleCopy`
//    list. So every runtime dependency of ee/server/package.json outside
//    @stigmer/* must carry the server's spec exactly, and every @stigmer/* one
//    must be a `file:` link to the package of that name in this repository,
//    which the release stamps to the version it publishes.
//
// Each rule is a pure function over a file list and a reader, run here over
// the tracked tree and over fixtures of each refusal, so a rule that stopped
// refusing would fail its fixture rather than pass on nothing.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const EE = "ee";
const PACKAGE_NAME = "@stigmer/enterprise";
const PACKAGE_DIR = "ee/server";
const SERVER_DIR = "backend/services/stigmer-server";

/** This file: its fixtures spell out the imports it refuses. */
const SELF = "scripts/ee-package.test.mjs";

const SOURCE = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)(["'`])([^"'`\n]+)\1/g;
const DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];

const insideEe = (path) => path === EE || path.startsWith(`${EE}/`);
const namesPackage = (spec) => spec === PACKAGE_NAME || spec.startsWith(`${PACKAGE_NAME}/`);

/** The repository path a relative specifier or `file:` target names, from the file or manifest at `from`. */
function target(from, spec) {
  return normalize(join(dirname(from), spec)).replace(/\\/g, "/");
}

/**
 * Rule 1. `files` are repository paths, `read` returns a file's text.
 * Returns one sentence per reach into ee/ from outside it.
 */
export function reachesIntoEe(files, read) {
  const problems = [];
  for (const file of files) {
    if (insideEe(file) || file === SELF) continue;
    if (SOURCE.test(file)) {
      for (const [, , spec] of read(file).matchAll(SPECIFIER)) {
        if (namesPackage(spec)) {
          problems.push(`${file} imports ${spec}: nothing outside ee/ may depend on Stigmer Enterprise`);
        } else if (spec.startsWith(".") && insideEe(target(file, spec))) {
          problems.push(`${file} imports ${spec}, which is under ee/: nothing outside ee/ may import from it`);
        }
      }
    } else if (file === "package.json" || file.endsWith("/package.json")) {
      const manifest = JSON.parse(read(file));
      for (const field of DEPENDENCY_FIELDS) {
        for (const [name, spec] of Object.entries(manifest[field] ?? {})) {
          const linked = typeof spec === "string" && spec.startsWith("file:") && insideEe(target(file, spec.slice(5)));
          if (namesPackage(name) || linked) {
            problems.push(`${file} ${field} names ${name} (${spec}): nothing outside ee/ may depend on Stigmer Enterprise`);
          }
        }
      }
    }
  }
  return problems;
}

/**
 * Rule 2. `read` returns a manifest's text by repository path. Returns one
 * sentence per runtime dependency of the package that leaves the server's
 * specs or is not a link to this repository's package of that name.
 */
export function driftsFromServer(read) {
  const pkg = JSON.parse(read(`${PACKAGE_DIR}/package.json`));
  const server = JSON.parse(read(`${SERVER_DIR}/package.json`));
  const problems = [];
  for (const [name, spec] of Object.entries(pkg.dependencies ?? {})) {
    if (name.startsWith("@stigmer/")) {
      if (!spec.startsWith("file:")) {
        problems.push(`${PACKAGE_DIR} depends on ${name} at '${spec}': a @stigmer/* dependency is a file: link, which the release stamps`);
        continue;
      }
      const dir = target(`${PACKAGE_DIR}/package.json`, spec.slice(5));
      let linked;
      try {
        linked = JSON.parse(read(`${dir}/package.json`)).name;
      } catch {
        linked = undefined;
      }
      if (linked !== name) {
        problems.push(`${PACKAGE_DIR} links ${name} to ${dir}, which is not that package`);
      }
      continue;
    }
    const expected = server.dependencies?.[name];
    if (expected === undefined) {
      problems.push(`${PACKAGE_DIR} depends on ${name}, which the server does not: it would resolve a copy the server does not share`);
    } else if (spec !== expected) {
      problems.push(`${PACKAGE_DIR} depends on ${name} at '${spec}', the server at '${expected}': two specs install two copies`);
    }
  }
  return problems;
}

const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" })
  .split("\0")
  .filter(Boolean);
const readTracked = (path) => readFileSync(join(root, path), "utf8");

test("nothing outside ee/ imports from it or depends on it", () => {
  assert.deepEqual(reachesIntoEe(tracked, readTracked), []);
});

test("ee/server's runtime dependencies are the server's own specs, and its @stigmer/* ones links to those packages", () => {
  assert.deepEqual(driftsFromServer(readTracked), []);
});

test("the guard still finds the package and the links it exists for", () => {
  // If the manifest read broke, the rule above would pass on nothing.
  const pkg = JSON.parse(readTracked(`${PACKAGE_DIR}/package.json`));
  assert.equal(pkg.name, PACKAGE_NAME);
  assert.deepEqual(
    Object.keys(pkg.dependencies).filter((name) => name.startsWith("@stigmer/")).sort(),
    ["@stigmer/outbound", "@stigmer/apis", "@stigmer/server"],
  );
  assert.ok(Object.keys(pkg.dependencies).some((name) => !name.startsWith("@stigmer/")));
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

test("rule 1 refuses an import into ee/, the package by name, and a manifest that depends on it", () => {
  const tree = fixture({
    "backend/services/stigmer-server/src/main.ts": 'import { x } from "../../../../ee/server/src/index.js";\n',
    "scripts/tool.mjs": 'const m = await import("@stigmer/enterprise");\n',
    "site/src/page.tsx": 'export * from "@stigmer/enterprise/package.json";\n',
    "test/extension-consumer/package.json": JSON.stringify({ dependencies: { "@stigmer/enterprise": "1.0.0" } }),
    "client-apps/web/package.json": JSON.stringify({ devDependencies: { anything: "file:../../ee/server" } }),
    // Inside ee/, and mentions that are not imports: allowed.
    "ee/server/src/a.ts": 'import { b } from "./b.js";\n',
    "scripts/lanes.mjs": 'const paths = ["ee/**", "@stigmer/enterprise"];\n',
    "README.md": 'import x from "../ee/server";\n',
  });
  const problems = reachesIntoEe(tree.files, tree.read);
  assert.equal(problems.length, 5, problems.join("\n"));
  for (const file of [
    "backend/services/stigmer-server/src/main.ts",
    "scripts/tool.mjs",
    "site/src/page.tsx",
    "test/extension-consumer/package.json",
    "client-apps/web/package.json",
  ]) {
    assert.ok(problems.some((p) => p.startsWith(`${file} `)), `${file} is refused`);
  }
});

test("rule 2 refuses a spec that leaves the server's, a dependency the server lacks, and a @stigmer/* that is not a link to its package", () => {
  const server = { name: "@stigmer/server", dependencies: { pg: "8.23.0", "@bufbuild/protobuf": "2.12.0" } };
  const manifests = (dependencies) =>
    fixture({
      "ee/server/package.json": JSON.stringify({ name: PACKAGE_NAME, dependencies }),
      "backend/services/stigmer-server/package.json": JSON.stringify(server),
      "backend/libs/ts/outbound/package.json": JSON.stringify({ name: "@stigmer/outbound" }),
    });
  const clean = { pg: "8.23.0", "@stigmer/server": "file:../../backend/services/stigmer-server", "@stigmer/outbound": "file:../../backend/libs/ts/outbound" };
  assert.deepEqual(driftsFromServer(manifests(clean).read), []);
  for (const [dependencies, says] of [
    [{ ...clean, pg: "^8.23.0" }, /pg at '\^8\.23\.0', the server at '8\.23\.0'/],
    [{ ...clean, ulidx: "2.4.1" }, /ulidx, which the server does not/],
    [{ ...clean, "@stigmer/outbound": "3.41.1" }, /@stigmer\/outbound at '3\.41\.1': a @stigmer\/\* dependency is a file: link/],
    [{ ...clean, "@stigmer/outbound": "file:../../backend/services/stigmer-server" }, /links @stigmer\/outbound to backend\/services\/stigmer-server, which is not that package/],
  ]) {
    const problems = driftsFromServer(manifests(dependencies).read);
    assert.equal(problems.length, 1, problems.join("\n"));
    assert.match(problems[0], says);
  }
});
