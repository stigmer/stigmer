// Tests for how publish-libs.mjs stages each package's dist/: the generated
// dist/package.json, the publish set and its closures, and the staged sources
// and source maps. Run via `node --test scripts/publish-libs.test.mjs` (wired
// into root `npm test`).
//
// The regressions this guards: publish-libs.mjs once dropped the `bin` field,
// which would silently break the `mcp-server-stigmer` executable that `npx`
// (and the patched CLI launcher) rely on; and it once published every test,
// fixture and test helper under src/ while every source map named a path
// one level outside the installed package; and every published coding-agent
// plugin once said it was 0.0.0-dev, because the build stamped the
// workspace's version into its manifests and only dist/package.json got the
// release's (stigmer/stigmer#3144); and it once dropped peerDependenciesMeta,
// so every optional peer published as required (stigmer/stigmer#2975).
//
// It also pins which registry a run is tied to: only an NPM_TOKEN run (the
// release lane, npmjs.com) writes a registry into .npmrc. The dev lane sets no
// NPM_TOKEN and publishes where npm's scope configuration sends @stigmer/*,
// so an npmjs.com line there would be a second, wrong statement of it.

import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { build as buildCodingAgentPlugin } from "../coding-agents/scripts/build.mjs";
import {
  PACKAGES,
  PLUGIN_MANIFESTS,
  WORKSPACE_VERSION,
  assertStagedDist,
  distPackageJsonOf,
  generateDistPackageJson,
  isTestSidePath,
  packCommand,
  packageClosure,
  resolvePackageTag,
  rewriteBinPaths,
  isPluginManifestPath,
  rewriteMapSources,
  stageSources,
  stampPluginManifests,
  tokenNpmrc,
} from "./publish-libs.mjs";

test("PACKAGES is exactly the workspace members that are not private", () => {
  // The publish set and the workspace's `private` flags are two statements of
  // the same fact. The root build:libs / clean:libs / test scripts derive their
  // package set from PACKAGES (scripts/turbo-set.mjs), so a package that is
  // publishable in one place and not the other would either publish unbuilt
  // or build and never publish. Both directions are checked.
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const { workspaces } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const publishable = workspaces.filter(
    (relDir) => !JSON.parse(readFileSync(join(root, relDir, "package.json"), "utf8")).private,
  );
  assert.deepEqual(
    [...PACKAGES].sort(),
    publishable.sort(),
    "PACKAGES and the non-private workspace members must name the same directories",
  );
});

test("PACKAGES publishes @stigmer/coding-agent-plugin and @stigmer/examples before the CLI that depends on them", () => {
  for (const dir of ["coding-agents", "examples"]) {
    assert.ok(PACKAGES.includes(dir), `${dir} must be in PACKAGES`);
    assert.ok(PACKAGES.indexOf(dir) < PACKAGES.indexOf("client-apps/cli"), `${dir} must publish before client-apps/cli`);
  }
});

test("PACKAGES publishes @stigmer/plugins before the CLI that acquires it", () => {
  // A published @stigmer/cli acquires @stigmer/plugins at its exact version on
  // demand, so plugins must be in the publish set. Order is not load-bearing
  // (plugins has no @stigmer/* deps; turbo orders builds by the dependency
  // graph), but keeping it ahead of the CLI mirrors the acquire relationship.
  assert.ok(PACKAGES.includes("plugins"), "plugins must be in PACKAGES");
  assert.ok(
    PACKAGES.indexOf("plugins") < PACKAGES.indexOf("client-apps/cli"),
    "plugins must publish before client-apps/cli",
  );
});

test("PACKAGES publishes @stigmer/plugin-package before the CLI that depends on it", () => {
  // The CLI's offline plugin validation imports the library and declares it
  // as a workspace dependency ("*"), which the publisher pins to the lockstep
  // version; a library missing from the publish set would leave every
  // installed CLI with an unresolvable dependency.
  assert.ok(
    PACKAGES.includes("backend/libs/ts/plugin-package"),
    "@stigmer/plugin-package must be in PACKAGES",
  );
  assert.ok(
    PACKAGES.indexOf("backend/libs/ts/plugin-package") < PACKAGES.indexOf("client-apps/cli"),
    "@stigmer/plugin-package must publish before client-apps/cli",
  );
});

test("PACKAGES publishes the workspace libs the runner's release stamps as deps", () => {
  // The runner release workflows rewrite these file: links to the exact
  // release version right before `npm publish` — a lib missing from the
  // publish set makes every embedder's fresh runner install unresolvable.
  assert.ok(PACKAGES.includes("apis/stubs/ts"), "@stigmer/apis must be in PACKAGES");
  assert.ok(
    PACKAGES.includes("backend/libs/ts/temporal-codecs"),
    "@stigmer/temporal-codecs must be in PACKAGES",
  );
});

test("rewriteBinPaths rewrites the dist prefix for the object form", () => {
  const out = rewriteBinPaths({
    "mcp-server-stigmer": "./dist/cli/mcp-server-stigmer.js",
  });
  assert.deepEqual(out, {
    "mcp-server-stigmer": "./cli/mcp-server-stigmer.js",
  });
});

test("rewriteBinPaths rewrites the dist prefix for the string form", () => {
  assert.equal(rewriteBinPaths("./dist/cli/run.js"), "./cli/run.js");
});

test("resolvePackageTag: explicit run tag always wins (dev channel)", () => {
  // The dev pipeline passes --tag dev; every package goes to dev regardless of pins.
  assert.equal(resolvePackageTag({ stigmerPublish: { tag: "next" } }, "dev", "latest"), "dev");
  assert.equal(resolvePackageTag({}, "dev", "latest"), "dev");
});

test("resolvePackageTag: a package pins itself off latest until parity", () => {
  // @stigmer/cli pins to next so a stable release never promotes it to latest.
  assert.equal(resolvePackageTag({ stigmerPublish: { tag: "next" } }, undefined, "latest"), "next");
});

test("resolvePackageTag: a pin cannot raise a prerelease run to latest", () => {
  // The pin only lowers from latest; on a prerelease run the inferred tag stands.
  assert.equal(resolvePackageTag({ stigmerPublish: { tag: "latest" } }, undefined, "next"), "next");
});

test("resolvePackageTag: unpinned packages use the inferred tag", () => {
  assert.equal(resolvePackageTag({}, undefined, "latest"), "latest");
  assert.equal(resolvePackageTag({}, undefined, "next"), "next");
});

test("generateDistPackageJson carries bin and pins workspace deps", () => {
  const pkgDir = mkdtempSync(join(tmpdir(), "publish-libs-test-"));
  try {
    mkdirSync(join(pkgDir, "dist"));
    writeFileSync(
      join(pkgDir, "package.json"),
      JSON.stringify({
        name: "@stigmer/mcp-server",
        license: "Apache-2.0",
        type: "module",
        engines: { node: ">=20" },
        dependencies: { "@stigmer/apis": "*", "@stigmer/client": "*", zod: "^3.25.0" },
        publishConfig: {
          main: "./dist/index.js",
          types: "./dist/index.d.ts",
          bin: { "mcp-server-stigmer": "./dist/cli/mcp-server-stigmer.js" },
          exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } },
        },
      }),
    );

    const distPath = generateDistPackageJson(pkgDir, "1.2.3");
    const dist = JSON.parse(readFileSync(distPath, "utf8"));

    assert.deepEqual(dist.bin, { "mcp-server-stigmer": "./cli/mcp-server-stigmer.js" });
    assert.equal(dist.main, "./index.js");
    assert.equal(dist.types, "./index.d.ts");
    assert.equal(dist.version, "1.2.3");
    // Workspace deps pinned to the lockstep version; third-party untouched.
    assert.equal(dist.dependencies["@stigmer/apis"], "1.2.3");
    assert.equal(dist.dependencies["@stigmer/client"], "1.2.3");
    assert.equal(dist.dependencies.zod, "^3.25.0");
  } finally {
    rmSync(pkgDir, { recursive: true, force: true });
  }
});

test("an optional peer publishes optional", () => {
  // The script once built the manifest field by field and dropped
  // peerDependenciesMeta, so every optional peer shipped required: npm 7+
  // would have installed outbound's undici (with its Node floor) into the
  // runner, which never loads the entry that needs it.
  const dist = distPackageJsonOf(
    {
      name: "@stigmer/outbound",
      peerDependencies: { undici: "8.12.3", "@stigmer/apis": "*" },
      peerDependenciesMeta: { undici: { optional: true } },
    },
    "1.2.3",
  );
  assert.deepEqual(dist.peerDependencies, { undici: "8.12.3", "@stigmer/apis": "1.2.3" });
  assert.deepEqual(dist.peerDependenciesMeta, { undici: { optional: true } });

  assert.equal("peerDependenciesMeta" in distPackageJsonOf({ name: "@stigmer/x", peerDependencies: { a: "1" } }, "1.2.3"), false);
});

test("every published package keeps the peer meta its source declares", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const declaring = [];
  for (const relDir of PACKAGES) {
    const src = JSON.parse(readFileSync(join(root, relDir, "package.json"), "utf8"));
    if (!src.peerDependenciesMeta) continue;
    declaring.push(relDir);
    assert.deepEqual(distPackageJsonOf(src, "1.2.3").peerDependenciesMeta, src.peerDependenciesMeta, relDir);
  }
  // A walk that read nothing cannot pass on nothing.
  assert.ok(declaring.includes("backend/libs/ts/outbound"), `peer meta found only in: ${declaring.join(", ")}`);
});

test("@stigmer/client publishes @connectrpc/connect-node as an optional peer", () => {
  // Only its `/node` entry imports the transport, and four of the five app
  // stacks the client hands over install a browser chat that never loads it.
  // Optional, a browser app installs only what it uses; every install line
  // that runs `@stigmer/client/node` names the transport itself, and a Node
  // app that skips it gets Node's own error naming the package.
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const dist = distPackageJsonOf(JSON.parse(readFileSync(join(root, "sdk/typescript/package.json"), "utf8")), "1.2.3");
  assert.ok(dist.peerDependencies?.["@connectrpc/connect-node"], "the client names @connectrpc/connect-node as a peer");
  assert.equal(dist.peerDependenciesMeta?.["@connectrpc/connect-node"]?.optional, true);
});

// A synthetic publish set shaped like the real one's hazards: a peer-only
// edge (sdk -> protos), a diamond (cli -> ink -> sdk, cli -> sdk), a
// third-party dep to ignore, and a package nothing reaches (embed). Keyed by
// real PACKAGES paths so the order assertion is meaningful.
const syntheticManifests = new Map([
  ["apis/stubs/ts", { name: "@stigmer/apis" }],
  ["sdk/typescript", { name: "@stigmer/client", peerDependencies: { "@stigmer/apis": "*", "@bufbuild/protobuf": "^2" } }],
  ["sdk/embed", { name: "@stigmer/embed" }],
  ["sdk/ink", { name: "@stigmer/ink-ui", dependencies: { ink: "^5" }, peerDependencies: { "@stigmer/client": "*" } }],
  ["client-apps/cli", { name: "@stigmer/cli", dependencies: { "@stigmer/ink-ui": "*", "@stigmer/client": "*" } }],
]);

test("packageClosure follows dependencies and peers, in PACKAGES order", () => {
  // Peers count: npm 7+ installs them, so a peer left out of the tarball set
  // is fetched from the registry — the race --only exists to remove.
  assert.deepEqual(packageClosure("@stigmer/cli", syntheticManifests), [
    "apis/stubs/ts",
    "sdk/typescript",
    "sdk/ink",
    "client-apps/cli",
  ]);
  // A leaf's closure is itself.
  assert.deepEqual(packageClosure("@stigmer/apis", syntheticManifests), ["apis/stubs/ts"]);
});

test("packageClosure of several names is the union of their closures, once each, in PACKAGES order", () => {
  // A standalone package outside the publish set names its file:-linked libs
  // one --only each; overlapping closures (ink and sdk both reach protos)
  // must not pack a package twice, and the order stays the publish order
  // whatever order the names arrive in.
  assert.deepEqual(packageClosure(["@stigmer/embed", "@stigmer/ink-ui"], syntheticManifests), [
    "apis/stubs/ts",
    "sdk/typescript",
    "sdk/embed",
    "sdk/ink",
  ]);
  assert.deepEqual(
    packageClosure(["@stigmer/ink-ui", "@stigmer/embed"], syntheticManifests),
    packageClosure(["@stigmer/embed", "@stigmer/ink-ui"], syntheticManifests),
  );
  // One name in a list is the single-name closure.
  assert.deepEqual(packageClosure(["@stigmer/cli"], syntheticManifests), packageClosure("@stigmer/cli", syntheticManifests));
});

test("packageClosure refuses a name outside the publish set", () => {
  // A typo must not pack an empty set that an image then installs "successfully".
  assert.throws(() => packageClosure("@stigmer/clii", syntheticManifests), /not a publishable workspace package/);
  // In a list too, and it names the one that is wrong.
  assert.throws(() => packageClosure(["@stigmer/apis", "@stigmer/clii"], syntheticManifests), /--only @stigmer\/clii: not a publishable/);
});

test("packageClosure refuses an @stigmer/* edge that leaves the publish set", () => {
  // Such an edge could only be satisfied by the registry, and nothing there
  // carries that name; the closure is unusable and says so.
  const manifests = new Map(syntheticManifests);
  manifests.set("client-apps/cli", {
    name: "@stigmer/cli",
    dependencies: { "@stigmer/client": "*", "@stigmer/not-published": "*" },
  });
  assert.throws(() => packageClosure("@stigmer/cli", manifests), /@stigmer\/not-published, which is not in the publish set/);
});

test("the checked-in @stigmer/cli closure is exactly what the compose-runner image installs", () => {
  // The compose-runner image (backend/services/runner/Dockerfile.sandbox)
  // installs this set from tarballs in one `npm install`; the release lane
  // stages it with `--only @stigmer/cli`. Pinned so a new @stigmer/* dep on
  // the CLI's path is a visible change here, not a silent registry fetch in
  // the image build. The SDK folds a session's events with session-log,
  // which reads the tool vocabulary; the Temporal download reads
  // artifact-fetch; `stigmer example` reads examples and `stigmer
  // coding-agent` prints coding-agents' guide. plugins, embed and
  // temporal-codecs are NOT on the CLI's path and stay out of the image.
  assert.deepEqual(packageClosure("@stigmer/cli"), [
    "apis/stubs/ts",
    "backend/libs/ts/zip-structure",
    "backend/libs/ts/artifact-fetch",
    "backend/libs/ts/eval-runtime",
    "backend/libs/ts/plugin-package",
    "backend/libs/ts/tool-vocabulary",
    "backend/libs/ts/session-log",
    "examples",
    "sdk/typescript",
    "sdk/react-core",
    "sdk/ink",
    "mcp-server",
    "coding-agents",
    "client-apps/cli",
  ]);
});

test("every @stigmer/* edge of a closure member stays inside the closure", () => {
  // The completeness invariant behind the snapshot above, checked against the
  // manifests themselves: an install of exactly these tarballs never needs the
  // registry for an @stigmer/* package.
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const closure = packageClosure("@stigmer/cli");
  const names = new Set(
    closure.map((relDir) => JSON.parse(readFileSync(join(root, relDir, "package.json"), "utf8")).name),
  );
  for (const relDir of closure) {
    const manifest = JSON.parse(readFileSync(join(root, relDir, "package.json"), "utf8"));
    for (const dep of Object.keys({ ...manifest.dependencies, ...manifest.peerDependencies })) {
      if (dep.startsWith("@stigmer/")) {
        assert.ok(names.has(dep), `${manifest.name} -> ${dep} leaves the closure`);
      }
    }
  }
});

test("packCommand packs the built dist into the pack directory, silently", () => {
  // --pack-dir "publishes" to a directory: the same stamped dist/ that
  // `npm publish` would upload, packed where a from-source build (the
  // all-in-one image) can install it at an unpublished version. The tarball's
  // name is npm's own rule (<scope>-<name>-<version>.tgz), never re-derived.
  assert.equal(
    packCommand("/repo/client-apps/cli/dist", "/out/pkgs"),
    "npm pack /repo/client-apps/cli/dist --pack-destination /out/pkgs --silent",
  );
});

test("isTestSidePath names the workspace's test markers and nothing a consumer imports", () => {
  for (const rel of [
    "__tests__/zip-structure.test.ts",
    "workspace/__tests__/a11y/.gitignore",
    "__tests__/fixtures/encrypted-payload-fixture.json",
    "__test-utils__/fake-artifact-storage.ts",
    "marketplace/__fixtures__/cursor-marketplace.ts",
    "node.test.ts",
    "tools/format.test.tsx",
    "__tests__/transcript.golden.md",
    "api.spec.ts",
    "__tests__\\windows.ts",
  ]) {
    assert.equal(isTestSidePath(rel), true, rel);
  }
  // The published test-support entry points (@stigmer/react-sdk/test,
  // @stigmer/plugin-package/testing) and names that merely contain "test".
  for (const rel of [
    "test/index.ts",
    "test/samples.ts",
    "testing.ts",
    "local/temporal/inspect.ts",
    "resource-workbench/components/ResourceInspector.tsx",
    "latest.ts",
    "",
  ]) {
    assert.equal(isTestSidePath(rel), false, rel);
  }
});

test("every published entry point stays outside the test side", () => {
  // The predicate must never refuse a file a package exports: a false
  // positive would stage a tarball whose exports point at nothing. Pinned
  // over the checked-in manifests, so ./test and ./testing are covered.
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const targets = (value) =>
    typeof value === "string"
      ? [value]
      : value && typeof value === "object"
        ? Object.values(value).flatMap(targets)
        : [];
  for (const relDir of PACKAGES) {
    const { publishConfig = {} } = JSON.parse(readFileSync(join(root, relDir, "package.json"), "utf8"));
    const { main, types, bin, exports } = publishConfig;
    for (const target of targets([main, types, bin, exports])) {
      assert.equal(isTestSidePath(target), false, `${relDir}: ${target}`);
    }
  }
});

test("no published manifest points into a dist/ folder the tarball does not have", () => {
  // Every package is published from its dist/, so a manifest path that still
  // starts ./dist/ names nothing: an import of the package fails on install.
  // Pinned over the checked-in manifests, so a package whose publishConfig
  // names no exports of its own (its source exports are carried) is covered.
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const targets = (value) =>
    typeof value === "string"
      ? [value]
      : value && typeof value === "object"
        ? Object.values(value).flatMap(targets)
        : [];
  for (const relDir of PACKAGES) {
    const dist = distPackageJsonOf(JSON.parse(readFileSync(join(root, relDir, "package.json"), "utf8")), "1.2.3");
    for (const target of targets([dist.main, dist.types, dist.bin, dist.exports])) {
      assert.equal(target.startsWith("./dist/"), false, `${relDir}: ${target}`);
    }
  }
});

/** A package tree in a temp dir: `files` maps a package-relative path to its content. */
function syntheticPackage(files) {
  const pkgDir = mkdtempSync(join(tmpdir(), "publish-libs-stage-"));
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(pkgDir, rel)), { recursive: true });
    writeFileSync(join(pkgDir, rel), content);
  }
  return pkgDir;
}

/** A map the way tsc writes one: sources relative to the map, repository layout. */
const tscMap = (file, source) =>
  JSON.stringify({ version: 3, file, sourceRoot: "", sources: [source], names: [], mappings: "AAAA" });

test("stageSources copies the runtime sources and leaves the test side out", () => {
  const pkgDir = syntheticPackage({
    "src/index.ts": "export {};",
    "src/test/index.ts": "export {};",
    "src/styles.css": "",
    "src/__tests__/index.test.ts": "",
    "src/__tests__/fixtures/payload.json": "{}",
    "src/__test-utils__/fake.ts": "",
    "src/node.test.ts": "",
    "dist/index.js": "",
    // Left by an earlier, unfiltered stage: the stage owns dist/src/.
    "dist/src/stale.test.ts": "",
  });
  try {
    assert.equal(stageSources(pkgDir), true);
    const staged = (rel) => existsSync(join(pkgDir, "dist", "src", rel));
    assert.ok(staged("index.ts") && staged("test/index.ts") && staged("styles.css"));
    for (const rel of ["__tests__", "__test-utils__", "node.test.ts", "stale.test.ts"]) {
      assert.equal(staged(rel), false, rel);
    }
    assert.ok(existsSync(join(pkgDir, "dist", "index.js")), "build output is untouched");
  } finally {
    rmSync(pkgDir, { recursive: true, force: true });
  }
});

test("stageSources: a package with no src/ ships no maps", () => {
  // protos: its maps name generated .ts that never ship, so they can only dangle.
  const pkgDir = syntheticPackage({
    "dist/ai/v1/api_pb.js": "",
    "dist/ai/v1/api_pb.js.map": tscMap("api_pb.js", "../../../ai/v1/api_pb.ts"),
    "dist/ai/v1/api_pb.d.ts": "",
  });
  try {
    assert.equal(stageSources(pkgDir), false);
    assert.equal(existsSync(join(pkgDir, "dist", "ai", "v1", "api_pb.js.map")), false);
    assert.ok(existsSync(join(pkgDir, "dist", "ai", "v1", "api_pb.js")));
    assert.equal(existsSync(join(pkgDir, "dist", "src")), false);
  } finally {
    rmSync(pkgDir, { recursive: true, force: true });
  }
});

test("rewriteMapSources re-aims tsc's maps at the staged copy, at any depth, once", () => {
  const pkgDir = syntheticPackage({
    "src/index.ts": "",
    "src/org/update.ts": "",
    "dist/index.js.map": tscMap("index.js", "../src/index.ts"),
    "dist/index.d.ts.map": tscMap("index.d.ts", "../src/index.ts"),
    "dist/org/update.d.ts.map": tscMap("update.d.ts", "../../src/org/update.ts"),
  });
  const distDir = join(pkgDir, "dist");
  const sources = (rel) => JSON.parse(readFileSync(join(distDir, rel), "utf8")).sources;
  try {
    stageSources(pkgDir);
    assert.equal(rewriteMapSources(distDir, pkgDir), 3);
    // From the published root (dist/), each source now names the staged copy.
    assert.deepEqual(sources("index.js.map"), ["src/index.ts"]);
    assert.deepEqual(sources("index.d.ts.map"), ["src/index.ts"]);
    assert.deepEqual(sources("org/update.d.ts.map"), ["../src/org/update.ts"]);
    // --skip-build re-stages the same dist/: a second pass changes nothing.
    const before = readFileSync(join(distDir, "org/update.d.ts.map"), "utf8");
    stageSources(pkgDir);
    assert.equal(rewriteMapSources(distDir, pkgDir), 0);
    assert.equal(readFileSync(join(distDir, "org/update.d.ts.map"), "utf8"), before);
    assertStagedDist(distDir, "@stigmer/synthetic");
  } finally {
    rmSync(pkgDir, { recursive: true, force: true });
  }
});

test("rewriteMapSources keeps the rest of the map byte-for-byte", () => {
  // Tarball parity: the rewrite changes `sources` and nothing else.
  const pkgDir = syntheticPackage({
    "src/index.ts": "",
    "dist/index.js.map": tscMap("index.js", "../src/index.ts"),
  });
  try {
    stageSources(pkgDir);
    rewriteMapSources(join(pkgDir, "dist"), pkgDir);
    assert.equal(
      readFileSync(join(pkgDir, "dist", "index.js.map"), "utf8"),
      tscMap("index.js", "src/index.ts"),
    );
  } finally {
    rmSync(pkgDir, { recursive: true, force: true });
  }
});

test("assertStagedDist refuses a test-side file and a map source not in the tarball", () => {
  const pkgDir = syntheticPackage({
    "dist/index.js": "",
    // What an unfiltered build config does: a compiled test in the tarball.
    "dist/__tests__/client.test.js": "",
    // A map whose source was never staged.
    "dist/index.js.map": tscMap("index.js", "../src/index.ts"),
  });
  try {
    assert.throws(
      () => assertStagedDist(join(pkgDir, "dist"), "@stigmer/synthetic"),
      (err) =>
        err.message.includes("@stigmer/synthetic") &&
        err.message.includes("2 problem(s)") &&
        err.message.includes("test-side file: __tests__/client.test.js") &&
        err.message.includes("map source not in the tarball: index.js.map -> ../src/index.ts"),
    );
  } finally {
    rmSync(pkgDir, { recursive: true, force: true });
  }
});

const manifest = (version) => `${JSON.stringify({ name: "stigmer", version }, null, 2)}\n`;

test("isPluginManifestPath names the four manifest locations at any depth, and nothing else", () => {
  for (const location of PLUGIN_MANIFESTS) {
    assert.equal(isPluginManifestPath(location), true, location);
    assert.equal(isPluginManifestPath(`plugin/${location}`), true, location);
    assert.equal(isPluginManifestPath(`a\\b\\${location.replaceAll("/", "\\")}`), true, location);
  }
  for (const other of ["package.json", ".claude-plugin/marketplace.json", "myplugin.json", ".claude-plugin/plugin.jsonc"]) {
    assert.equal(isPluginManifestPath(other), false, other);
  }
});

test("stampPluginManifests stamps the workspace version at any depth and leaves a plugin's own version byte for byte", () => {
  const ownVersion = '{"name":"vendored","version":"1.2.0"}';
  const pkgDir = syntheticPackage({
    "dist/plugin/.claude-plugin/plugin.json": manifest(WORKSPACE_VERSION),
    "dist/plugin/.cursor-plugin/plugin.json": manifest(WORKSPACE_VERSION),
    "dist/plugin/.codex-plugin/plugin.json": manifest(WORKSPACE_VERSION),
    "dist/vendored/plugin.json": ownVersion,
    // Not a manifest location: a marketplace file is never stamped.
    "dist/plugin/.claude-plugin/marketplace.json": manifest(WORKSPACE_VERSION),
    // Not JSON: the plugin reader reports it; staging leaves it alone.
    "dist/broken/.claude-plugin/plugin.json": "{",
  });
  const distDir = join(pkgDir, "dist");
  try {
    assert.deepEqual(stampPluginManifests(distDir, "2.0.0").sort(), [
      "plugin/.claude-plugin/plugin.json",
      "plugin/.codex-plugin/plugin.json",
      "plugin/.cursor-plugin/plugin.json",
    ]);
    for (const tool of [".claude-plugin", ".cursor-plugin", ".codex-plugin"]) {
      assert.deepEqual(JSON.parse(readFileSync(join(distDir, "plugin", tool, "plugin.json"), "utf8")), { name: "stigmer", version: "2.0.0" });
    }
    assert.equal(readFileSync(join(distDir, "vendored", "plugin.json"), "utf8"), ownVersion);
    assert.equal(readFileSync(join(distDir, "plugin", ".claude-plugin", "marketplace.json"), "utf8"), manifest(WORKSPACE_VERSION));
    // --skip-build re-stages the same dist/: a second pass stamps nothing.
    assert.deepEqual(stampPluginManifests(distDir, "2.0.0"), []);
  } finally {
    rmSync(pkgDir, { recursive: true, force: true });
  }
});

test("stampPluginManifests stamps a dist/ staged earlier at another version again, by its source's workspace version", () => {
  // `--version 1.0.0` then `--version 1.0.1 --skip-build`: the dist/ already
  // says 1.0.0, and only the package's source says the manifest is its own.
  const vendored = '{"name":"vendored","version":"1.0.0"}';
  const pkgDir = syntheticPackage({
    "plugin/.claude-plugin/plugin.json": manifest(WORKSPACE_VERSION),
    "dist/plugin/.claude-plugin/plugin.json": manifest("1.0.0"),
    // A vendored plugin whose own version is the earlier release's, by chance.
    "vendored/.codex-plugin/plugin.json": vendored,
    "dist/vendored/.codex-plugin/plugin.json": vendored,
  });
  const distDir = join(pkgDir, "dist");
  try {
    assert.deepEqual(stampPluginManifests(distDir, "1.0.1", pkgDir), ["plugin/.claude-plugin/plugin.json"]);
    assert.equal(JSON.parse(readFileSync(join(distDir, "plugin", ".claude-plugin", "plugin.json"), "utf8")).version, "1.0.1");
    assert.equal(readFileSync(join(distDir, "vendored", ".codex-plugin", "plugin.json"), "utf8"), vendored);
  } finally {
    rmSync(pkgDir, { recursive: true, force: true });
  }
});

test("assertStagedDist refuses a plugin manifest still at the workspace version", () => {
  const pkgDir = syntheticPackage({
    "dist/index.js": "",
    "dist/plugin/.codex-plugin/plugin.json": manifest(WORKSPACE_VERSION),
    "dist/plugin/.claude-plugin/plugin.json": manifest("2.0.0"),
  });
  try {
    assert.throws(
      () => assertStagedDist(join(pkgDir, "dist"), "@stigmer/synthetic"),
      (err) =>
        err.message.includes("1 problem(s)") &&
        err.message.includes(`plugin manifest at the workspace version ${WORKSPACE_VERSION}: plugin/.codex-plugin/plugin.json`),
    );
  } finally {
    rmSync(pkgDir, { recursive: true, force: true });
  }
});

test("assertStagedDist refuses a package's own plugin manifest at another version than its package.json", () => {
  // A dist/ staged at 1.0.0, then re-staged at 1.0.1 without the stamp.
  const vendored = '{"name":"vendored","version":"1.0.0"}';
  const pkgDir = syntheticPackage({
    "plugin/.claude-plugin/plugin.json": manifest(WORKSPACE_VERSION),
    "dist/package.json": '{"name":"@stigmer/synthetic","version":"1.0.1"}',
    "dist/plugin/.claude-plugin/plugin.json": manifest("1.0.0"),
    // A vendored plugin keeps its own version, whatever the package's.
    "vendored/.codex-plugin/plugin.json": vendored,
    "dist/vendored/.codex-plugin/plugin.json": vendored,
  });
  try {
    assert.throws(
      () => assertStagedDist(join(pkgDir, "dist"), "@stigmer/synthetic", pkgDir),
      (err) =>
        err.message.includes("1 problem(s)") &&
        err.message.includes("plugin manifest at 1.0.0, not the package's 1.0.1: plugin/.claude-plugin/plugin.json"),
    );
    stampPluginManifests(join(pkgDir, "dist"), "1.0.1", pkgDir);
    assertStagedDist(join(pkgDir, "dist"), "@stigmer/synthetic", pkgDir);
  } finally {
    rmSync(pkgDir, { recursive: true, force: true });
  }
});

test("the coding-agent plugin, built and staged as a release stages it, carries the release version everywhere", () => {
  // The package's own build stamps its source version (the workspace's) into
  // the manifests; staging must leave none of it in what is published.
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const pkgDir = mkdtempSync(join(tmpdir(), "publish-libs-coding-agents-"));
  try {
    cpSync(join(root, "coding-agents", "package.json"), join(pkgDir, "package.json"));
    cpSync(join(root, "coding-agents", "plugin"), join(pkgDir, "plugin"), { recursive: true });
    buildCodingAgentPlugin(pkgDir);
    const distDir = join(pkgDir, "dist");
    generateDistPackageJson(pkgDir, "2.0.0");
    assert.deepEqual(stampPluginManifests(distDir, "2.0.0").sort(), [
      "plugin/.claude-plugin/plugin.json",
      "plugin/.codex-plugin/plugin.json",
      "plugin/.cursor-plugin/plugin.json",
    ]);
    assertStagedDist(distDir, "@stigmer/coding-agent-plugin");
    assert.equal(JSON.parse(readFileSync(join(distDir, "package.json"), "utf8")).version, "2.0.0");
    for (const tool of [".claude-plugin", ".cursor-plugin", ".codex-plugin"]) {
      assert.equal(JSON.parse(readFileSync(join(distDir, "plugin", tool, "plugin.json"), "utf8")).version, "2.0.0", tool);
    }
    assert.doesNotMatch(readFileSync(join(distDir, "index.js"), "utf8"), new RegExp(WORKSPACE_VERSION.replaceAll(".", "\\.")));
  } finally {
    rmSync(pkgDir, { recursive: true, force: true });
  }
});

/**
 * Where reconcile-coding-agent-plugin.yaml reads the plugin inside the
 * unpacked npm tarball, as a path under the tarball's `package/` root.
 */
function reconcileSourceInPackage(workflowText) {
  const line = workflowText.split("\n").find((l) => /^\s*SOURCE="\$RUNNER_TEMP\/pkg\/package\//.test(l));
  if (line === undefined) throw new Error("reconcile-coding-agent-plugin.yaml sets no SOURCE under the unpacked package");
  return line.trim().replace(/^SOURCE="\$RUNNER_TEMP\/pkg\/package\//, "").replace(/"$/, "");
}

test("the plugin repository's reconcile reads the folder the published package keeps its plugin in (stigmer/stigmer#3177)", () => {
  // The staged dist/ is what npm publishes as the tarball's package/ root,
  // so the workflow's path under package/ must hold the three manifests at
  // the release version there.
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const workflow = readFileSync(join(root, ".github", "workflows", "reconcile-coding-agent-plugin.yaml"), "utf8");
  const source = reconcileSourceInPackage(workflow);
  const pkgDir = mkdtempSync(join(tmpdir(), "publish-libs-reconcile-"));
  try {
    cpSync(join(root, "coding-agents", "package.json"), join(pkgDir, "package.json"));
    cpSync(join(root, "coding-agents", "plugin"), join(pkgDir, "plugin"), { recursive: true });
    buildCodingAgentPlugin(pkgDir);
    const distDir = join(pkgDir, "dist");
    generateDistPackageJson(pkgDir, "2.0.0");
    stampPluginManifests(distDir, "2.0.0");
    for (const tool of [".claude-plugin", ".cursor-plugin", ".codex-plugin"]) {
      const manifest = join(distDir, source, tool, "plugin.json");
      assert.ok(existsSync(manifest), `${source}/${tool}/plugin.json is not in the published package`);
      assert.equal(JSON.parse(readFileSync(manifest, "utf8")).version, "2.0.0", tool);
    }
  } finally {
    rmSync(pkgDir, { recursive: true, force: true });
  }
});

test("reconcileSourceInPackage reads the path under package/ and refuses a workflow without one", () => {
  assert.equal(reconcileSourceInPackage('          SOURCE="$RUNNER_TEMP/pkg/package/plugin"\n'), "plugin");
  assert.equal(reconcileSourceInPackage('          SOURCE="$RUNNER_TEMP/pkg/package/dist/plugin"\n'), "dist/plugin");
  assert.throws(() => reconcileSourceInPackage("name: x\n"), /no SOURCE/);
});

test("only an NPM_TOKEN run writes a registry into .npmrc, by reference to the token", () => {
  assert.equal(tokenNpmrc({}), undefined);
  assert.equal(tokenNpmrc({ NPM_TOKEN: "" }), undefined);
  // The dev lane's credential is setup-node's NODE_AUTH_TOKEN for the scope's
  // registry; it never makes this script write anything.
  assert.equal(tokenNpmrc({ NODE_AUTH_TOKEN: "ya29.example" }), undefined);
  const npmrc = tokenNpmrc({ NPM_TOKEN: "npm_secret_value" });
  assert.equal(npmrc, "//registry.npmjs.org/:_authToken=${NPM_TOKEN}\n");
  assert.doesNotMatch(npmrc, /npm_secret_value/);
});
