// Every package that imports `@stigmer/outbound/dial` declares undici itself.
// Run via `node --test scripts/outbound-dial-consumers.test.mjs` (wired into
// root `npm run test:root`).
//
// `@stigmer/outbound` names undici as an optional peer: its `/dial` entry is
// the only module that loads it, and the runner, which takes the library's
// other entries on Node 22.13, must not install undici or meet its higher
// Node floor (stigmer/stigmer#2975). An optional peer is installed only when
// something else in the tree asks for it, so a package that imports `/dial`
// and does not declare undici installs without it and fails at boot with
// "Cannot find package 'undici'". The library cannot see its consumers, so the
// rule is held here, over the tree: every package whose tracked sources import
// `@stigmer/outbound/dial` must list `undici` in `dependencies` at exactly the
// spec outbound's `peerDependencies` names, so the copy `/dial` loads is the
// one outbound was tested with. A consumer is found by what it imports, so a
// new one is held without editing this file.
//
// Each rule is a pure function over a file list and a reader, run here over
// the tracked tree and over fixtures of each refusal, so a rule that stopped
// refusing would fail its fixture rather than pass on nothing.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ts = createRequire(import.meta.url)("typescript");

const ENTRY = "@stigmer/outbound/dial";
const OUTBOUND_DIR = "backend/libs/ts/outbound";
const PEER = "undici";

const SOURCE = /\.(?:[cm]?[jt]s|[jt]sx)$/;

/** The specifiers a source file loads (static, re-export, dynamic `import()`, `require`), comments ignored. */
const specifiersOf = (text) => ts.preProcessFile(text, true, true).importedFiles.map((f) => f.fileName);

/** The directory of the package that owns `path`: its nearest ancestor with a manifest in `manifests`. */
function owningPackage(path, manifests) {
  for (let dir = dirname(path); ; dir = dirname(dir)) {
    const key = dir === "." ? "" : dir;
    if (manifests.has(key)) return key;
    if (key === "") return undefined;
  }
}

/**
 * The packages whose sources import the dial entry, each with the files that do.
 * `files` are repository paths, `read` returns a file's text.
 */
function dialConsumers(files, read) {
  const manifests = new Set(
    files.filter((f) => f === "package.json" || f.endsWith("/package.json")).map((f) => (f === "package.json" ? "" : dirname(f))),
  );
  const consumers = new Map();
  for (const file of files) {
    if (!SOURCE.test(file) || file.endsWith(".d.ts")) continue;
    const text = read(file);
    if (!text.includes(ENTRY) || !specifiersOf(text).includes(ENTRY)) continue;
    const pkg = owningPackage(file, manifests);
    if (pkg === undefined || pkg === OUTBOUND_DIR) continue;
    consumers.set(pkg, [...(consumers.get(pkg) ?? []), file]);
  }
  return consumers;
}

/** The rule: one problem per consumer that does not declare undici at outbound's peer spec. */
function undeclaredUndici(files, read) {
  const outbound = JSON.parse(read(`${OUTBOUND_DIR}/package.json`));
  const wanted = outbound.peerDependencies?.[PEER];
  if (!wanted) return [`${OUTBOUND_DIR}/package.json names no ${PEER} peer: this guard has nothing to hold consumers to`];
  const problems = [];
  for (const [pkg, importers] of dialConsumers(files, read)) {
    const manifest = `${pkg === "" ? "" : `${pkg}/`}package.json`;
    const declared = JSON.parse(read(manifest)).dependencies?.[PEER];
    if (declared === undefined) {
      problems.push(
        `${manifest} does not list ${PEER} in dependencies, though ${importers[0]} imports ${ENTRY}: add "${PEER}": "${wanted}"`,
      );
    } else if (declared !== wanted) {
      problems.push(`${manifest} lists ${PEER} at '${declared}', ${ENTRY} is tested at '${wanted}' (${OUTBOUND_DIR}/package.json)`);
    }
  }
  return problems;
}

const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" })
  .split("\0")
  .filter(Boolean);
const readTracked = (path) => readFileSync(join(root, path), "utf8");

test("every package that imports @stigmer/outbound/dial declares undici at outbound's peer spec", () => {
  assert.deepEqual(undeclaredUndici(tracked, readTracked), []);
});

test("the guard still finds the consumers it exists for", () => {
  // If the walk were rooted wrong or the scan broke, the rule above would
  // pass on nothing.
  assert.deepEqual([...dialConsumers(tracked, readTracked).keys()].sort(), ["backend/services/stigmer-server", "ee/server"]);
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

const outboundManifest = JSON.stringify({
  name: "@stigmer/outbound",
  peerDependencies: { undici: "8.12.3" },
  peerDependenciesMeta: { undici: { optional: true } },
});

test("the rule refuses a consumer that omits undici and one that names another spec, and passes the rest", () => {
  const tree = fixture({
    [`${OUTBOUND_DIR}/package.json`]: outboundManifest,
    [`${OUTBOUND_DIR}/src/dial/index.ts`]: 'export { pinnedFetch } from "./pinned-fetch.js";\n',
    // Declares it: passes.
    "server/package.json": JSON.stringify({ dependencies: { undici: "8.12.3" } }),
    "server/src/boot.ts": 'import { nodeGuardedFetch } from "@stigmer/outbound/dial";\n',
    // A dynamic import with no declaration: refused.
    "edition/package.json": JSON.stringify({ dependencies: {} }),
    "edition/src/deep/compose.ts": 'const { nodeGuardedFetch } = await import("@stigmer/outbound/dial");\n',
    // A range where the exact spec is wanted: refused.
    "tool/package.json": JSON.stringify({ dependencies: { undici: "^8.12.3" } }),
    "tool/main.mjs": 'export { pinnedFetch } from "@stigmer/outbound/dial";\n',
    // Only a devDependency: refused, a consumer's install skips it.
    "dev-only/package.json": JSON.stringify({ devDependencies: { undici: "8.12.3" } }),
    "dev-only/src/a.ts": 'import "@stigmer/outbound/dial";\n',
    // Another entry, a comment and a string: not consumers.
    "runner/package.json": JSON.stringify({ dependencies: {} }),
    "runner/src/guard.ts": [
      'import { checkEgress } from "@stigmer/outbound/egress";',
      "// the server closes that gap with @stigmer/outbound/dial",
      'const LOADERS = ["undici", "@stigmer/outbound/dial"];',
    ].join("\n"),
  });
  assert.deepEqual([...dialConsumers(tree.files, tree.read).keys()].sort(), ["dev-only", "edition", "server", "tool"]);
  const problems = undeclaredUndici(tree.files, tree.read);
  assert.equal(problems.length, 3, problems.join("\n"));
  assert.match(problems.find((p) => p.startsWith("edition/")) ?? "", /does not list undici in dependencies, though edition\/src\/deep\/compose\.ts imports/);
  assert.match(problems.find((p) => p.startsWith("tool/")) ?? "", /lists undici at '\^8\.12\.3', @stigmer\/outbound\/dial is tested at '8\.12\.3'/);
  assert.match(problems.find((p) => p.startsWith("dev-only/")) ?? "", /does not list undici in dependencies/);
});

test("the rule refuses to pass when outbound names no undici peer", () => {
  const tree = fixture({ [`${OUTBOUND_DIR}/package.json`]: JSON.stringify({ name: "@stigmer/outbound" }) });
  const problems = undeclaredUndici(tree.files, tree.read);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /names no undici peer/);
});
