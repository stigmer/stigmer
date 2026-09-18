// Tests for the dist/package.json generation in publish-libs.mjs.
// Run via `node --test scripts/publish-libs.test.mjs` (wired into root `npm test`).
//
// The regression this guards: publish-libs.mjs once dropped the `bin` field,
// which would silently break the `mcp-server-stigmer` executable that `npx`
// (and the patched CLI launcher) rely on.

import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import {
  PACKAGES,
  generateDistPackageJson,
  packCommand,
  packageClosure,
  resolvePackageTag,
  rewriteBinPaths,
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
  assert.ok(PACKAGES.includes("apis/stubs/ts"), "@stigmer/protos must be in PACKAGES");
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
        dependencies: { "@stigmer/protos": "*", "@stigmer/sdk": "*", zod: "^3.25.0" },
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
    assert.equal(dist.dependencies["@stigmer/protos"], "1.2.3");
    assert.equal(dist.dependencies["@stigmer/sdk"], "1.2.3");
    assert.equal(dist.dependencies.zod, "^3.25.0");
  } finally {
    rmSync(pkgDir, { recursive: true, force: true });
  }
});

// A synthetic publish set shaped like the real one's hazards: a peer-only
// edge (sdk -> protos), a diamond (cli -> ink -> sdk, cli -> sdk), a
// third-party dep to ignore, and a package nothing reaches (embed). Keyed by
// real PACKAGES paths so the order assertion is meaningful.
const syntheticManifests = new Map([
  ["apis/stubs/ts", { name: "@stigmer/protos" }],
  ["sdk/typescript", { name: "@stigmer/sdk", peerDependencies: { "@stigmer/protos": "*", "@bufbuild/protobuf": "^2" } }],
  ["sdk/embed", { name: "@stigmer/embed" }],
  ["sdk/ink", { name: "@stigmer/ink", dependencies: { ink: "^5" }, peerDependencies: { "@stigmer/sdk": "*" } }],
  ["client-apps/cli", { name: "@stigmer/cli", dependencies: { "@stigmer/ink": "*", "@stigmer/sdk": "*" } }],
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
  assert.deepEqual(packageClosure("@stigmer/protos", syntheticManifests), ["apis/stubs/ts"]);
});

test("packageClosure refuses a name outside the publish set", () => {
  // A typo must not pack an empty set that an image then installs "successfully".
  assert.throws(() => packageClosure("@stigmer/clii", syntheticManifests), /not a publishable workspace package/);
});

test("packageClosure refuses an @stigmer/* edge that leaves the publish set", () => {
  // Such an edge could only be satisfied by the registry, and nothing there
  // carries that name; the closure is unusable and says so.
  const manifests = new Map(syntheticManifests);
  manifests.set("client-apps/cli", {
    name: "@stigmer/cli",
    dependencies: { "@stigmer/sdk": "*", "@stigmer/not-published": "*" },
  });
  assert.throws(() => packageClosure("@stigmer/cli", manifests), /@stigmer\/not-published, which is not in the publish set/);
});

test("the checked-in @stigmer/cli closure is exactly what the compose-runner image installs", () => {
  // The compose-runner image (backend/services/runner/Dockerfile.sandbox)
  // installs this set from tarballs in one `npm install`; the release lane
  // stages it with `--only @stigmer/cli`. Pinned so a new @stigmer/* dep on
  // the CLI's path is a visible change here, not a silent registry fetch in
  // the image build. plugins, embed and temporal-codecs are NOT on the
  // CLI's path and stay out of the image.
  assert.deepEqual(packageClosure("@stigmer/cli"), [
    "apis/stubs/ts",
    "backend/libs/ts/zip-structure",
    "backend/libs/ts/plugin-package",
    "sdk/typescript",
    "sdk/theme",
    "sdk/react",
    "sdk/ink",
    "mcp-server",
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
