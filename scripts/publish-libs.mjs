#!/usr/bin/env node

/**
 * Builds and publishes all @stigmer/* packages to npm.
 *
 * Reads each package's `publishConfig` to produce a dist/package.json
 * with the correct entry points for npm consumers, then publishes from
 * the dist/ directory. The workspace package.json is never modified.
 *
 * Usage:
 *   node scripts/publish-libs.mjs --version 0.5.0              # build + publish at version
 *   node scripts/publish-libs.mjs --version 0.5.0 --dry-run    # dry-run
 *   node scripts/publish-libs.mjs --version 0.5.0 --skip-build # publish pre-built dist/
 *   node scripts/publish-libs.mjs --version 0.5.0-dev.20260608 --tag dev  # dev channel
 *   NPM_TOKEN=npm_xxx node scripts/publish-libs.mjs --version 0.5.0  # CI with token
 *   node scripts/publish-libs.mjs --version 0.0.0-dev.abc1234 --pack-dir out/pkgs  # tarballs, no registry
 *   node scripts/publish-libs.mjs --version 3.17.0 --pack-dir out/pkgs --only @stigmer/cli  # one package + its @stigmer/* closure
 *   node scripts/publish-libs.mjs --version 3.17.0 --pack-dir out/pkgs --only @stigmer/protos --only @stigmer/outbound  # the union of two closures
 *
 * --version is required. It stamps the version into every dist/package.json.
 *
 * --pack-dir <dir> "publishes" to a directory instead of the registry: every
 * package is packed (`npm pack`) into <dir> with the same stamped dist/ that
 * `npm publish` would upload, and nothing is sent anywhere. This is how a
 * build that must carry the workspace's OWN packages at an unpublished
 * version — the all-in-one image built from a PR's sources — gets bytes
 * identical to a release's, and it needs no npm token. Mutually exclusive
 * with --dry-run and --tag (no dist-tag exists for a directory).
 *
 * --only <name> narrows a --pack-dir run to one package and the @stigmer/*
 * packages it depends on, transitively, through `dependencies` and
 * `peerDependencies` (npm 7+ installs peers). An image that bakes one of our
 * packages installs exactly that set of tarballs in one `npm install`, and
 * npm resolves every @stigmer/* edge among them instead of asking the
 * registry — the compose-runner image's CLI (stigmer/stigmer#1158). Repeat
 * it to pack the union of several closures: a standalone package outside
 * the publish set (the server, the runner) names its `file:`-linked libs
 * one --only each, and gets them with everything they depend on
 * (scripts/stage-server-library.mjs). Refused without --pack-dir: the
 * registry publish is lockstep by design, and a subset there would leave
 * the other packages' pinned deps unresolvable.
 *
 * The npm dist-tag is chosen as follows:
 *   - If --tag is passed explicitly, that tag is used verbatim. This is how the
 *     dev-publishing pipeline routes throwaway builds to a dedicated `dev` tag,
 *     keeping them off both `latest` (stable) and `next` (release candidates).
 *   - Otherwise it is inferred from the version: pre-release versions
 *     (e.g. 0.5.0-rc.1) publish under "next"; stable versions under "latest".
 *
 * A tarball is exactly what sits in dist/, so the staged dist/ is the
 * package's published contents. Besides dist/package.json, each package gets
 * its runtime sources in dist/src/ with the test side left out. tsc writes
 * every source map relative to the repository layout (`../src/x.ts` from
 * dist/), and publishing from dist/ puts that one level outside the installed
 * package, so the maps are rewritten to name the staged copy. Before anything
 * is packed or sent, the staged dist/ must hold no test-side file and every
 * map source it names must resolve inside it; a package that fails either
 * check stops the run.
 */

import { execSync } from "node:child_process";
import {
  readFileSync,
  writeFileSync,
  cpSync,
  existsSync,
  unlinkSync,
  readdirSync,
  mkdirSync,
  rmSync,
} from "node:fs";
import { resolve, dirname, join, relative, sep, isAbsolute } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

export const PACKAGES = [
  "apis/stubs/ts",
  // @stigmer/temporal-codecs has no @stigmer/* deps, so its position is
  // order-free. It MUST publish: the runner (published separately by the
  // release workflows) depends on it, pinned to the exact release version
  // at stamp time — exactly like @stigmer/protos.
  "backend/libs/ts/temporal-codecs",
  // @stigmer/zip-structure has no deps at all, so its position is order-free.
  // It MUST publish for the same reason as temporal-codecs: the runner links
  // it and pins the exact release version at stamp time.
  "backend/libs/ts/zip-structure",
  // @stigmer/plugin-package has no @stigmer/* deps, so its position is
  // order-free. It MUST publish: @stigmer/cli depends on it (pinned to the
  // lockstep version at stamp time), and the server links it once the plugin
  // install pipeline lands.
  "backend/libs/ts/plugin-package",
  // @stigmer/outbound has no deps at all, so its position is order-free. It
  // MUST publish: the server and the runner both link it (the egress policy
  // and the MCP OAuth rules they share) and pin the exact release version at
  // stamp time.
  "backend/libs/ts/outbound",
  "sdk/typescript",
  "sdk/theme",
  "sdk/react",
  // @stigmer/embed has no @stigmer/* deps (the loader must stay dependency-free
  // so the IIFE bundles nothing but itself), so its position is order-free.
  "sdk/embed",
  "sdk/ink",
  // mcp-server depends only on @stigmer/protos + @stigmer/sdk, both above it,
  // so the publish DAG stays ordered. Mirrors the build:libs order in package.json.
  "mcp-server",
  // @stigmer/plugins is the official plugin marketplace as a directory tree
  // (a root marketplace.json and one Agent Plugins package per entry); no
  // @stigmer/* deps, so its position is order-free. A published @stigmer/cli
  // acquires it at its exact version for `stigmer install`, and the console
  // reads it at the server's version from the npm CDN, so it MUST publish too.
  "plugins",
  // @stigmer/cli depends on @stigmer/protos + @stigmer/sdk + @stigmer/ink, all
  // above it, so it publishes last with its deps already resolved.
  "client-apps/cli",
];

function run(cmd, cwd = root) {
  console.log(`  $ ${cmd}`);
  execSync(cmd, { cwd, stdio: "inherit" });
}

function parseArgs() {
  const args = process.argv.slice(2);
  const version = args.includes("--version")
    ? args[args.indexOf("--version") + 1]
    : undefined;

  if (!version) {
    console.error("error: --version is required (e.g. --version 0.5.0)");
    process.exit(1);
  }

  const tag = args.includes("--tag")
    ? args[args.indexOf("--tag") + 1]
    : undefined;

  const packDir = args.includes("--pack-dir")
    ? args[args.indexOf("--pack-dir") + 1]
    : undefined;
  if (args.includes("--pack-dir") && !packDir) {
    console.error("error: --pack-dir requires a directory");
    process.exit(1);
  }
  if (packDir && (tag || args.includes("--dry-run"))) {
    console.error("error: --pack-dir cannot be combined with --tag or --dry-run");
    process.exit(1);
  }

  const only = args.flatMap((arg, i) => (arg === "--only" ? [args[i + 1]] : []));
  if (only.some((name) => !name || name.startsWith("--"))) {
    console.error("error: --only requires a package name (e.g. --only @stigmer/cli)");
    process.exit(1);
  }
  if (only.length > 0 && !packDir) {
    console.error("error: --only is only valid with --pack-dir (the registry publish is lockstep)");
    process.exit(1);
  }

  return {
    version,
    tag,
    dryRun: args.includes("--dry-run"),
    skipBuild: args.includes("--skip-build"),
    packDir: packDir ? resolve(packDir) : undefined,
    only: only.length > 0 ? only : undefined,
  };
}

/**
 * The transitive @stigmer/* closure of one package, or the union of several
 * packages' closures, over the publish set: the packages themselves plus
 * every @stigmer/* package reachable through `dependencies` and
 * `peerDependencies`, in PACKAGES order (so a caller that cares about
 * publish order keeps it). Peers count because npm 7+ installs
 * them; an edge left out would send npm to the registry for it, which is
 * the race this closure exists to remove.
 *
 * `manifests` maps each PACKAGES entry to its parsed package.json; the
 * default reads them from the checkout. Injectable so the test can pin the
 * rule on a synthetic graph, and the checked-in graph's closure separately.
 * Throws when a name is not a published package (a typo must not pack an
 * empty set that an image then installs "successfully"), and when a member
 * names an @stigmer/* package outside the publish set (that edge could only
 * be satisfied by the registry, and there is no such package on it).
 */
export function packageClosure(names, manifests = readWorkspaceManifests()) {
  const roots = Array.isArray(names) ? names : [names];
  const byName = new Map();
  for (const [relPath, manifest] of manifests) byName.set(manifest.name, relPath);
  for (const name of roots) {
    if (!byName.has(name)) {
      throw new Error(
        `--only ${name}: not a publishable workspace package (PACKAGES names ${[...byName.keys()].join(", ")})`,
      );
    }
  }

  const closure = new Set();
  const pending = [...roots];
  while (pending.length > 0) {
    const current = pending.pop();
    if (closure.has(current)) continue;
    closure.add(current);
    const manifest = manifests.get(byName.get(current));
    const edges = { ...manifest.dependencies, ...manifest.peerDependencies };
    for (const dep of Object.keys(edges)) {
      if (!dep.startsWith("@stigmer/")) continue;
      if (!byName.has(dep)) {
        throw new Error(
          `${current} depends on ${dep}, which is not in the publish set; the closure cannot be installed from tarballs alone`,
        );
      }
      if (!closure.has(dep)) pending.push(dep);
    }
  }

  return PACKAGES.filter(
    (relPath) => manifests.has(relPath) && closure.has(manifests.get(relPath).name),
  );
}

/** PACKAGES entry → parsed package.json, read from this checkout. */
function readWorkspaceManifests() {
  return new Map(
    PACKAGES.map((relPath) => [
      relPath,
      JSON.parse(readFileSync(resolve(root, relPath, "package.json"), "utf8")),
    ]),
  );
}

function isPrerelease(version) {
  return version.includes("-");
}

/**
 * Resolve the npm dist-tag for a single package.
 *
 * An explicit run-level `--tag` (how the dev pipeline routes every package to the
 * `dev` channel) always wins — a dev build is a dev build for the whole train.
 *
 * Otherwise a package may pin itself below the inferred tag via
 * `stigmerPublish.tag` in its package.json. This lets a not-yet-GA package ship
 * to npm (so it is installable + CI-testable) without ever landing on `latest`;
 * the pin is removed when the package reaches parity. (No package currently
 * pins — `@stigmer/cli` did until it went GA.) A
 * package never pins itself ABOVE the inferred tag (e.g. it cannot force
 * `latest` onto a prerelease run).
 */
export function resolvePackageTag(srcPkg, explicitTag, inferredTag) {
  if (explicitTag) return explicitTag;
  const pinned = srcPkg.stigmerPublish?.tag;
  if (pinned && inferredTag === "latest") return pinned;
  return inferredTag;
}

export function generateDistPackageJson(pkgDir, version) {
  const srcPkg = JSON.parse(
    readFileSync(resolve(pkgDir, "package.json"), "utf8"),
  );
  const publishConfig = srcPkg.publishConfig || {};

  const distPkg = {
    name: srcPkg.name,
    version,
    description: srcPkg.description,
    license: srcPkg.license,
    type: srcPkg.type,
    sideEffects: srcPkg.sideEffects,
    repository: srcPkg.repository,
  };

  if (srcPkg.engines) distPkg.engines = srcPkg.engines;
  if (srcPkg.keywords) distPkg.keywords = srcPkg.keywords;

  if (publishConfig.main) {
    distPkg.main = publishConfig.main.replace(/^\.\/dist\//, "./");
  }
  if (publishConfig.types) {
    distPkg.types = publishConfig.types.replace(/^\.\/dist\//, "./");
  }

  // Executable packages (e.g. @stigmer/mcp-server) declare their entry points
  // under publishConfig.bin. Without this the bin field is dropped and `npx`
  // has nothing to run.
  if (publishConfig.bin) {
    distPkg.bin = rewriteBinPaths(publishConfig.bin);
  }

  if (publishConfig.exports) {
    distPkg.exports = rewriteExports(publishConfig.exports);
  } else if (srcPkg.exports) {
    distPkg.exports = srcPkg.exports;
  }

  if (srcPkg.dependencies) {
    distPkg.dependencies = pinWorkspaceDeps(srcPkg.dependencies, version);
  }
  if (srcPkg.peerDependencies) {
    distPkg.peerDependencies = pinWorkspaceDeps(
      srcPkg.peerDependencies,
      version,
    );
  }

  const distPath = resolve(pkgDir, "dist", "package.json");
  writeFileSync(distPath, JSON.stringify(distPkg, null, 2) + "\n");
  return distPath;
}

/**
 * The markers the workspace uses for files that exist only to test a package:
 * a `__tests__`, `__test-utils__` or `__fixtures__` directory anywhere on the
 * path, or a `*.test.*` / `*.spec.*` file. Deliberately not `test/` or
 * `testing.ts`: `@stigmer/react/test` and `@stigmer/plugin-package/testing`
 * are published entry points for consumers' own tests.
 */
const TEST_SIDE_DIRS = new Set(["__tests__", "__test-utils__", "__fixtures__"]);
const TEST_SIDE_FILE = /\.(test|spec)\.[^/\\]+$/;

/** Whether a path (relative, either separator) is test-side and never ships. */
export function isTestSidePath(relPath) {
  const segments = relPath.split(/[\\/]/);
  return (
    segments.some((segment) => TEST_SIDE_DIRS.has(segment)) ||
    TEST_SIDE_FILE.test(segments[segments.length - 1])
  );
}

/** Every file under `dir`, as paths relative to it, in a stable order. */
function listFiles(dir, prefix = "") {
  const files = [];
  const entries = readdirSync(join(dir, prefix), { withFileTypes: true });
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    const rel = prefix ? join(prefix, entry.name) : entry.name;
    if (entry.isDirectory()) files.push(...listFiles(dir, rel));
    else files.push(rel);
  }
  return files;
}

/** Whether `path` is `dir` itself or lies under it. */
function isInside(dir, path) {
  const rel = relative(dir, path);
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/**
 * Stage the sources the shipped maps point at: src/ into dist/src/, the test
 * side left out. The stage owns dist/src/ and clears it first, so a re-run
 * over an already-staged dist/ (--skip-build), or one staged before the
 * filter existed, never carries a file the filter would refuse.
 *
 * A package with no src/ (protos: its generated .ts sit beside the .d.ts they
 * compile to, where shipping them would change how consumers resolve types)
 * has no sources to point at, so it ships no maps either. Returns whether
 * sources were staged.
 */
export function stageSources(pkgDir) {
  const srcDir = resolve(pkgDir, "src");
  const distDir = resolve(pkgDir, "dist");
  const destDir = resolve(distDir, "src");
  rmSync(destDir, { recursive: true, force: true });
  if (!existsSync(srcDir)) {
    for (const rel of listFiles(distDir)) {
      if (rel.endsWith(".map")) rmSync(join(distDir, rel));
    }
    return false;
  }
  cpSync(srcDir, destDir, {
    recursive: true,
    filter: (from) => !isTestSidePath(relative(srcDir, from)),
  });
  return true;
}

/** A map's sources as absolute paths, resolved the way a consumer's tool does. */
function mapSourcePaths(mapPath, map) {
  const base = resolve(dirname(mapPath), map.sourceRoot || "");
  return (map.sources ?? []).map((source) => resolve(base, source));
}

/**
 * Point every map in dist/ at the staged copy of its source. tsc names a
 * source relative to the repository (`<pkg>/src/x.ts`); the file ships at
 * `dist/src/x.ts`, so a source outside dist/ but inside the package is
 * re-aimed at the same path under dist/. A source already inside dist/ is
 * left alone, which makes a second run a no-op. Returns the number of maps
 * rewritten.
 */
export function rewriteMapSources(distDir, pkgDir) {
  let rewritten = 0;
  for (const rel of listFiles(distDir)) {
    if (!rel.endsWith(".map") || isInside(join(distDir, "src"), join(distDir, rel))) continue;
    const mapPath = join(distDir, rel);
    const map = JSON.parse(readFileSync(mapPath, "utf8"));
    if (!Array.isArray(map.sources)) continue;
    const base = resolve(dirname(mapPath), map.sourceRoot || "");
    let changed = false;
    const sources = mapSourcePaths(mapPath, map).map((abs, i) => {
      if (isInside(distDir, abs) || !isInside(pkgDir, abs)) return map.sources[i];
      changed = true;
      return relative(base, resolve(distDir, relative(pkgDir, abs))).split(sep).join("/");
    });
    if (!changed) continue;
    writeFileSync(mapPath, JSON.stringify({ ...map, sources }));
    rewritten += 1;
  }
  return rewritten;
}

/**
 * Refuse a staged dist/ that would publish a test-side file or a map whose
 * source is not in the tarball. Runs last, on exactly what `npm pack` and
 * `npm publish` read, so whatever put the file there (the source stage, a
 * build config that compiles tests) is caught the same way.
 */
export function assertStagedDist(distDir, name) {
  const problems = [];
  for (const rel of listFiles(distDir)) {
    if (isTestSidePath(rel)) problems.push(`test-side file: ${rel}`);
    if (!rel.endsWith(".map")) continue;
    const mapPath = join(distDir, rel);
    const map = JSON.parse(readFileSync(mapPath, "utf8"));
    mapSourcePaths(mapPath, map).forEach((abs, i) => {
      if (!isInside(distDir, abs) || !existsSync(abs)) {
        problems.push(`map source not in the tarball: ${rel} -> ${map.sources[i]}`);
      }
    });
  }
  if (problems.length === 0) return;
  const shown = problems.slice(0, 20).map((p) => `    ${p}`).join("\n");
  const more = problems.length > 20 ? `\n    ...and ${problems.length - 20} more` : "";
  throw new Error(`${name}: the staged dist/ would publish ${problems.length} problem(s):\n${shown}${more}`);
}

/**
 * Replace workspace protocol ("*") with the lockstep version for @stigmer/* deps.
 */
function pinWorkspaceDeps(deps, version) {
  const pinned = { ...deps };
  for (const [name, range] of Object.entries(pinned)) {
    if (name.startsWith("@stigmer/") && range === "*") {
      pinned[name] = version;
    }
  }
  return pinned;
}

/**
 * Rewrite publishConfig.exports paths from ./dist/... to ./ (since we publish from dist/).
 */
function rewriteExports(exports) {
  if (typeof exports === "string") {
    return exports.replace(/^\.\/dist\//, "./");
  }
  if (typeof exports === "object" && exports !== null) {
    const result = {};
    for (const [key, value] of Object.entries(exports)) {
      result[key] = rewriteExports(value);
    }
    return result;
  }
  return exports;
}

/**
 * Rewrite publishConfig.bin paths from ./dist/... to ./ (since we publish from dist/).
 * npm's `bin` is either a string (single executable) or a flat { name: path } map.
 */
export function rewriteBinPaths(bin) {
  if (typeof bin === "string") {
    return bin.replace(/^\.\/dist\//, "./");
  }
  const result = {};
  for (const [name, path] of Object.entries(bin)) {
    result[name] = path.replace(/^\.\/dist\//, "./");
  }
  return result;
}

/**
 * If NPM_TOKEN is set, write a project-level .npmrc that authenticates
 * against the npm registry. Returns true if a file was written (caller
 * must clean up).
 */
function setupNpmrc() {
  const token = process.env.NPM_TOKEN;
  if (!token) return false;

  const npmrcPath = resolve(root, ".npmrc");
  if (existsSync(npmrcPath)) {
    console.error(
      "  ERROR: .npmrc already exists at repo root. Remove it or unset NPM_TOKEN.",
    );
    process.exit(1);
  }

  writeFileSync(
    npmrcPath,
    `//registry.npmjs.org/:_authToken=\${NPM_TOKEN}\n`,
  );
  console.log("  Created temporary .npmrc (will be removed after publish)\n");
  return true;
}

function teardownNpmrc(created) {
  if (!created) return;
  const npmrcPath = resolve(root, ".npmrc");
  try {
    unlinkSync(npmrcPath);
    console.log("\n  Removed temporary .npmrc");
  } catch {
    console.warn(
      `  WARNING: failed to remove ${npmrcPath} — delete it manually`,
    );
  }
}

/**
 * The `npm pack` invocation for one built package: the tarball lands in
 * `packDir`, named `<scope>-<name>-<version>.tgz` as npm names it. Returned so
 * callers (and the test) can address the file without re-deriving npm's rule.
 */
export function packCommand(distDir, packDir) {
  return `npm pack ${distDir} --pack-destination ${packDir} --silent`;
}

async function main() {
  const { version, tag: explicitTag, dryRun, skipBuild, packDir, only } = parseArgs();
  const inferredTag = isPrerelease(version) ? "next" : "latest";
  const tag = explicitTag ?? inferredTag;
  const packages = only ? packageClosure(only) : PACKAGES;

  console.log(`\n  version: ${version}`);
  if (packDir) {
    console.log(`  pack to: ${packDir} (no registry)`);
    if (only) {
      const named = only.join(", ");
      const whose = only.length === 1 ? "its" : "their";
      console.log(`  only:    ${named} and ${whose} @stigmer/* closure (${packages.length} packages)`);
    }
  } else {
    console.log(`  tag:     ${tag}${explicitTag ? "" : " (default; some packages may pin lower)"}`);
    console.log(`  dry-run: ${dryRun}`);
  }
  console.log("");

  if (!skipBuild) {
    console.log("=== Building all packages ===\n");
    run("npm run clean:libs");
    run("npm run build:libs");
  } else {
    console.log("=== Skipping build (--skip-build) ===\n");
  }

  // A directory needs no credentials; never touch .npmrc for a pack run.
  const npmrcCreated = packDir ? false : setupNpmrc();
  if (packDir) mkdirSync(packDir, { recursive: true });

  try {
    console.log(packDir ? "=== Packing packages ===\n" : "=== Publishing packages ===\n");

    for (const relPath of packages) {
      const pkgDir = resolve(root, relPath);
      const srcPkg = JSON.parse(
        readFileSync(resolve(pkgDir, "package.json"), "utf8"),
      );
      const distDir = resolve(pkgDir, "dist");

      console.log(`--- ${srcPkg.name}@${version} ---`);

      if (!existsSync(distDir)) {
        console.error(
          `  ERROR: dist/ does not exist in ${relPath}. Run without --skip-build first.`,
        );
        process.exit(1);
      }

      const pkgTag = resolvePackageTag(srcPkg, explicitTag, inferredTag);

      const distPkgPath = generateDistPackageJson(pkgDir, version);
      console.log(`  Generated ${distPkgPath}`);
      if (!packDir && pkgTag !== tag) {
        console.log(`  dist-tag: ${pkgTag} (pinned below the run default "${tag}")`);
      }

      if (stageSources(pkgDir)) {
        const rewritten = rewriteMapSources(distDir, pkgDir);
        console.log(`  Staged src/ (test side left out); ${rewritten} map(s) re-aimed at it`);
      } else {
        console.log("  No src/ to stage; source maps left out");
      }

      const readmeSrc = resolve(pkgDir, "README.md");
      if (existsSync(readmeSrc)) {
        cpSync(readmeSrc, resolve(distDir, "README.md"));
      }

      const licenseSrc = resolve(root, "LICENSE");
      if (existsSync(licenseSrc)) {
        cpSync(licenseSrc, resolve(distDir, "LICENSE"));
      }

      assertStagedDist(distDir, srcPkg.name);

      if (packDir) {
        run(packCommand(distDir, packDir));
        console.log("");
        continue;
      }

      let publishCmd = `npm publish ${distDir} --access public --tag ${pkgTag}`;
      if (dryRun) publishCmd += " --dry-run";

      run(publishCmd);
      console.log("");
    }

    console.log("=== Done ===\n");
  } finally {
    teardownNpmrc(npmrcCreated);
  }
}

// Only run when invoked directly (not when imported by tests).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
