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
 *
 * --version is required. It stamps the version into every dist/package.json.
 *
 * The npm dist-tag is chosen as follows:
 *   - If --tag is passed explicitly, that tag is used verbatim. This is how the
 *     dev-publishing pipeline routes throwaway builds to a dedicated `dev` tag,
 *     keeping them off both `latest` (stable) and `next` (release candidates).
 *   - Otherwise it is inferred from the version: pre-release versions
 *     (e.g. 0.5.0-rc.1) publish under "next"; stable versions under "latest".
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
} from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const PACKAGES = [
  "apis/stubs/ts",
  "sdk/typescript",
  "sdk/theme",
  "sdk/react",
  "sdk/ink",
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

  return {
    version,
    tag,
    dryRun: args.includes("--dry-run"),
    skipBuild: args.includes("--skip-build"),
  };
}

function isPrerelease(version) {
  return version.includes("-");
}

function generateDistPackageJson(pkgDir, version) {
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
 * Copy src/ into dist/src/ so declaration maps resolve to readable TypeScript.
 * Only copies .ts, .tsx, and .css files — no node_modules, no build artifacts.
 */
function copySrcForDeclarationMaps(pkgDir) {
  const srcDir = resolve(pkgDir, "src");
  const destDir = resolve(pkgDir, "dist", "src");
  if (!existsSync(srcDir)) return;
  cpSync(srcDir, destDir, { recursive: true });
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

async function main() {
  const { version, tag: explicitTag, dryRun, skipBuild } = parseArgs();
  const tag = explicitTag ?? (isPrerelease(version) ? "next" : "latest");

  console.log(`\n  version: ${version}`);
  console.log(`  tag:     ${tag}`);
  console.log(`  dry-run: ${dryRun}\n`);

  if (!skipBuild) {
    console.log("=== Building all packages ===\n");
    run("npm run clean:libs");
    run("npm run build:libs");
  } else {
    console.log("=== Skipping build (--skip-build) ===\n");
  }

  const npmrcCreated = setupNpmrc();

  try {
    console.log("=== Publishing packages ===\n");

    for (const relPath of PACKAGES) {
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

      const distPkgPath = generateDistPackageJson(pkgDir, version);
      console.log(`  Generated ${distPkgPath}`);

      copySrcForDeclarationMaps(pkgDir);

      const readmeSrc = resolve(pkgDir, "README.md");
      if (existsSync(readmeSrc)) {
        cpSync(readmeSrc, resolve(distDir, "README.md"));
      }

      const licenseSrc = resolve(root, "LICENSE");
      if (existsSync(licenseSrc)) {
        cpSync(licenseSrc, resolve(distDir, "LICENSE"));
      }

      let publishCmd = `npm publish ${distDir} --access public --tag ${tag}`;
      if (dryRun) publishCmd += " --dry-run";

      run(publishCmd);
      console.log("");
    }

    console.log("=== Done ===\n");
  } finally {
    teardownNpmrc(npmrcCreated);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
