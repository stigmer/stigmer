#!/usr/bin/env node

/**
 * Builds the slim distribution artifact for stigmer-server-ts — the entry
 * the CLI daemon launches after the cutover (STIGMER_SERVER_ENTRY, D2 §6
 * cutover mechanics; D4 #24).
 *
 * This is the runner's bundle-slim.mjs recipe (stigmer/stigmer#170),
 * adapted: the plain dist resolves @temporalio/* from node_modules at
 * runtime, and @temporalio/worker alone drags in webpack/@swc (~45 MB dead
 * weight once workflow bundles are pre-built) plus the all-platforms native
 * core-bridge (~127 MB, of which one platform needs ~22 MB). The slim
 * artifact bundles ALL JavaScript into one main.js and carries the native
 * bridge as a per-platform package.
 *
 * Two output shapes, same contents:
 *
 * 1. Self-contained directory (default) — `dist-slim/`; run `node main.js`.
 *
 *    dist-slim/
 *      main.js                                ← esbuild CJS bundle of the server
 *      main.js.map                            ← external sourcemap
 *      workflow-bundle-agent-execution.js     ← pre-built Temporal workflow
 *      workflow-bundle-workflow-execution.js    bundles, one per domain worker,
 *      workflow-bundle-schedule.js              discovered as siblings by
 *                                               src/temporal/workflow-source.ts
 *      workflow-worker-thread.cjs             ← Temporal's sandbox thread entry;
 *                                               worker_threads needs a real file
 *      mappings.wasm                          ← source-map's lazy-loaded wasm
 *      node_modules/
 *        @stigmer/server-slim-<platform>      ← Temporal native bridge, pruned
 *                                               to ONE platform
 *        @temporalio/common, @grpc/...        ← runtime deps of the native bridge
 *
 * 2. npm packages (`--emit-packages`) — `dist-slim-pkgs/` with publishable
 *    directories: `@stigmer/server-slim` plus five
 *    `@stigmer/server-slim-<platform>` packages installed selectively via
 *    optionalDependencies + os/cpu. The platform packages carry only
 *    core-bridge — whose releases for all five platforms ship in the npm
 *    tarball — so `--emit-packages` works from any host.
 *
 * FORMAT NOTE: the bundle is CommonJS, not ESM like the package's own
 * sources. The runner's temporal-bundling machinery reused here (the
 * bundler stub, the threaded-vm patch, the core-bridge shim's dynamic
 * platform require) is proven end-to-end on CJS output, and the shim's
 * runtime `require(<computed name>)` has no reliable ESM-output
 * equivalent (esbuild lowers unanalyzable requires in ESM output to a
 * throwing stub). `import.meta.url` — which the workers use to discover
 * their sibling workflow bundles — is mapped via `define` to the bundle's
 * own file URL, exactly as the runner does, so sibling discovery lands
 * next to main.js. Verified by `npm run verify:slim`.
 *
 * Build with `npm run build` first; this consumes the compiled dist/.
 *
 * Usage:
 *   node scripts/bundle-slim.mjs [--platform=<darwin-arm64|darwin-x64|linux-x64|linux-arm64|win32-x64>] [--emit-packages]
 */

import { build } from "esbuild";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

const serverRoot = fileURLToPath(new URL("..", import.meta.url));
const distDir = join(serverRoot, "dist");
const nodeModulesDir = join(serverRoot, "node_modules");
const outDir = join(serverRoot, "dist-slim");
const pkgsDir = join(serverRoot, "dist-slim-pkgs");

/**
 * The three domain workers and the sibling bundle names their
 * workflow-source resolvers look for. The names are load-bearing: a drifted
 * sibling fails SOFT at runtime (the worker falls through to the stubbed
 * bundler and manager.ts retries instead of crashing), so
 * buildWorkflowBundles verifies each name against the COMPILED worker
 * module — drift fails the build, not the release train.
 */
const WORKFLOW_BUNDLES = [
  {
    entry: "temporal/agentexecution/workflows/index.js",
    worker: "temporal/agentexecution/worker.js",
    sibling: "workflow-bundle-agent-execution.js",
  },
  {
    entry: "temporal/workflowexecution/workflows/index.js",
    worker: "temporal/workflowexecution/worker.js",
    sibling: "workflow-bundle-workflow-execution.js",
  },
  {
    entry: "temporal/schedule/workflows/index.js",
    worker: "temporal/schedule/worker.js",
    sibling: "workflow-bundle-schedule.js",
  },
];

/**
 * Assets that bundled modules read from disk relative to their __dirname.
 * (source-map powers @temporalio/worker's workflow stack-trace mapping and
 * lazy-loads its wasm at first use.)
 */
const BUNDLED_MODULE_ASSETS = [
  { from: "source-map/lib/mappings.wasm", to: "mappings.wasm" },
];

/** node platform-arch → Temporal core-bridge release triple. */
const CORE_BRIDGE_TRIPLES = {
  "darwin-arm64": "aarch64-apple-darwin",
  "darwin-x64": "x86_64-apple-darwin",
  "linux-x64": "x86_64-unknown-linux-gnu",
  "linux-arm64": "aarch64-unknown-linux-gnu",
  "win32-x64": "x86_64-pc-windows-msvc",
};

function parseArgs() {
  const hostPlatform = `${process.platform}-${process.arch}`;
  let platform = hostPlatform;
  let emitPackages = false;
  for (const arg of process.argv.slice(2)) {
    const m = arg.match(/^--platform=(.+)$/);
    if (m) platform = m[1];
    else if (arg === "--emit-packages") emitPackages = true;
    else fail(`unknown argument: ${arg}`);
  }
  if (!(platform in CORE_BRIDGE_TRIPLES)) {
    fail(
      `Unsupported platform "${platform}". Supported: ${Object.keys(CORE_BRIDGE_TRIPLES).join(", ")}`,
    );
  }
  return { platform, emitPackages };
}

function fail(message) {
  console.error(`bundle-slim: ${message}`);
  process.exit(1);
}

function readPackageJson(dir) {
  return JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
}

const serverPkg = readPackageJson(serverRoot);

// The ldflags equivalent (D4 #13): release lanes export these env vars and
// the defines stamp them into their fallback chains
// (src/domain/platform/version.ts, boot/config.ts's bundled GitHub OAuth
// defaults). Unset keeps each source default — exactly Go's unstamped
// build.
const defineFromEnv = (identifier, envName) => ({
  [identifier]:
    process.env[envName] !== undefined && process.env[envName] !== ""
      ? JSON.stringify(process.env[envName])
      : "undefined",
});
const stampDefines = {
  ...defineFromEnv("__STIGMER_SERVER_VERSION__", "STIGMER_SERVER_VERSION"),
  ...defineFromEnv("__STIGMER_GITHUB_CLIENT_ID__", "STIGMER_GITHUB_CLIENT_ID"),
  ...defineFromEnv(
    "__STIGMER_GITHUB_CLIENT_SECRET__",
    "STIGMER_GITHUB_CLIENT_SECRET",
  ),
};

// ─── Step 1: Pre-build the Temporal workflow bundles ────────────────────────

/**
 * One bundle per domain worker, emitted as siblings of main.js where
 * workflow-source.ts's prebuilt discovery finds them. Pre-building here is
 * what lets step 3 stub the runtime bundler and keep webpack/@swc out of
 * the artifact entirely.
 */
async function buildWorkflowBundles() {
  console.log("[1/5] Pre-building Temporal workflow bundles...");
  const { bundleWorkflowCode } = await import("@temporalio/worker");
  for (const { entry, worker, sibling } of WORKFLOW_BUNDLES) {
    const workflowsPath = join(distDir, entry);
    if (!existsSync(workflowsPath)) {
      fail(
        `workflows entry not found: ${workflowsPath} — run \`npm run build\` first`,
      );
    }
    // The name contract, enforced statically: the compiled worker must
    // reference this exact sibling in its prebuiltSibling URL.
    const workerPath = join(distDir, worker);
    if (!existsSync(workerPath)) {
      fail(`worker module not found: ${workerPath} — run \`npm run build\` first`);
    }
    if (!readFileSync(workerPath, "utf8").includes(sibling)) {
      fail(
        `sibling-name drift: ${worker} does not reference "${sibling}". ` +
          "Update WORKFLOW_BUNDLES to match the worker's prebuiltSibling URL (or vice versa).",
      );
    }
    const { code } = await bundleWorkflowCode({ workflowsPath });
    writeFileSync(join(outDir, sibling), code);
  }
}

// ─── Step 2: Bundle Temporal's workflow sandbox worker-thread entry ─────────

/**
 * Temporal runs workflow isolates on a worker thread whose entry it locates
 * with `require.resolve('./workflow-worker-thread')` — a real file on disk
 * that a single-file bundle cannot provide. So that entry gets its own
 * (pure-JS, self-contained) bundle, and the main bundle's copy of threaded-vm
 * is patched to point at it (see the plugin below). Runner recipe verbatim.
 */
async function buildWorkerThreadBundle() {
  console.log("[2/5] Bundling Temporal workflow worker-thread entry...");
  await build({
    entryPoints: [
      join(
        nodeModulesDir,
        "@temporalio/worker/lib/workflow/workflow-worker-thread.js",
      ),
    ],
    outfile: join(outDir, "workflow-worker-thread.cjs"),
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    minifyWhitespace: true,
    minifySyntax: true,
    minifyIdentifiers: false,
    sourcemap: "linked",
    // The sandbox thread reads the native bridge's monotonic clock (deadlock
    // detection), so it dispatches through the same per-platform shim as the
    // main bundle.
    alias: {
      "@temporalio/core-bridge": join(
        serverRoot,
        "scripts",
        "core-bridge-shim.cjs",
      ),
    },
    logLevel: "warning",
  });
}

// ─── Step 3: Bundle the server itself ────────────────────────────────────────

/**
 * Replaces @temporalio/worker's runtime webpack bundler with a stub. Slim
 * builds always ship pre-built workflow bundles (workflow-source.ts prefers
 * them), so the bundler — and with it webpack, @swc/core, memfs and friends
 * (~45 MB) — must never enter the module graph. The stub keeps the module's
 * export shape and fails loudly if something calls it anyway.
 */
const stubTemporalBundlerPlugin = {
  name: "stub-temporal-workflow-bundler",
  setup(buildApi) {
    buildApi.onLoad(
      {
        filter: /@temporalio[\\/]worker[\\/]lib[\\/]workflow[\\/]bundler\.js$/,
      },
      () => ({
        contents: `
        const UNAVAILABLE = "Runtime workflow bundling is unavailable in the slim server artifact; it ships pre-built workflow bundles (see workflow-source.ts)";
        exports.defaultWorkflowInterceptorModules = [];
        exports.allowedBuiltinModules = ["assert", "url", "util"];
        exports.disallowedBuiltinModules = [];
        exports.disallowedModules = [];
        exports.moduleMatches = () => false;
        exports.bundleWorkflowCode = () => { throw new Error(UNAVAILABLE); };
        exports.WorkflowCodeBundler = class WorkflowCodeBundler {
          constructor() { throw new Error(UNAVAILABLE); }
        };
      `,
        loader: "js",
      }),
    );
  },
};

/**
 * Redirects threaded-vm's `require.resolve('./workflow-worker-thread')` to
 * the sibling bundle emitted in step 2. Exact-match replacement with a count
 * assertion so a Temporal upgrade that moves this callsite breaks the build
 * loudly instead of producing a server that cannot start workflow sandboxes.
 */
const patchThreadedVmPlugin = {
  name: "patch-temporal-threaded-vm",
  setup(buildApi) {
    buildApi.onLoad(
      {
        filter:
          /@temporalio[\\/]worker[\\/]lib[\\/]workflow[\\/]threaded-vm\.js$/,
      },
      (args) => {
        const source = readFileSync(args.path, "utf8");
        const needle = "require.resolve('./workflow-worker-thread')";
        const occurrences = source.split(needle).length - 1;
        if (occurrences !== 1) {
          fail(
            `expected exactly 1 occurrence of ${needle} in threaded-vm.js, found ${occurrences}. ` +
              "The @temporalio/worker version likely changed; update bundle-slim.mjs.",
          );
        }
        return {
          contents: source.replace(
            needle,
            "globalThis.__stigmerWorkflowWorkerThreadPath()",
          ),
          loader: "js",
        };
      },
    );
  },
};

/**
 * CJS-output preamble (runner recipe): `require`, `__filename`, `__dirname`
 * are native under CJS. `import.meta.url` — used by the workers' sibling
 * workflow-bundle discovery — is mapped to this banner's file URL of the
 * bundle via esbuild `define`, so discovery resolves next to main.js. The
 * worker-thread entry path for the threaded-vm patch is published on
 * globalThis using the native __dirname.
 */
const CJS_BANNER = `
const { pathToFileURL: __stigmerPathToFileURL } = require("node:url");
const { join: __stigmerJoin } = require("node:path");
const __stigmerImportMetaUrl = __stigmerPathToFileURL(__filename).href;
globalThis.__stigmerWorkflowWorkerThreadPath = () => __stigmerJoin(__dirname, "workflow-worker-thread.cjs");
`;

async function buildMainBundle() {
  console.log("[3/5] Bundling server entry (dist/main.js)...");
  const result = await build({
    entryPoints: [join(distDir, "main.js")],
    outfile: join(outDir, "main.js"),
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    // Identifiers are kept so stack traces stay readable; the external
    // sourcemap recovers original file/line.
    minifyWhitespace: true,
    minifySyntax: true,
    minifyIdentifiers: false,
    sourcemap: "linked",
    define: {
      ...stampDefines,
      // `import.meta.url` is empty under CJS; map it to the banner-computed
      // file URL of the bundle (see CJS_BANNER).
      "import.meta.url": "__stigmerImportMetaUrl",
    },
    // The native bridge import dispatches to the per-platform package at
    // runtime instead of upstream's all-platforms-in-one package.
    alias: {
      "@temporalio/core-bridge": join(
        serverRoot,
        "scripts",
        "core-bridge-shim.cjs",
      ),
    },
    banner: { js: CJS_BANNER },
    plugins: [stubTemporalBundlerPlugin, patchThreadedVmPlugin],
    metafile: true,
    logLevel: "warning",
  });
  writeFileSync(join(outDir, "meta.json"), JSON.stringify(result.metafile));

  for (const asset of BUNDLED_MODULE_ASSETS) {
    const src = join(nodeModulesDir, asset.from);
    if (!existsSync(src)) {
      fail(`bundled-module asset not found: node_modules/${asset.from}`);
    }
    cpSync(src, join(outDir, asset.to));
  }
}

// ─── Platform packages: pruned @temporalio/core-bridge ──────────────────────

/**
 * core-bridge ships native libraries for all five platforms (~120 MB of its
 * ~127 MB) plus vendored Rust sources (~7 MB). The runtime needs exactly:
 * the JS loader (index.js / common.js / lib/) and ONE platform's prebuilt
 * release. Temporal's own prebuilt-path loader stays byte-for-byte intact
 * inside the platform package's core-bridge/ directory.
 */
const CORE_BRIDGE_RUNTIME_PATHS = [
  "package.json",
  "index.js",
  "common.js",
  "lib",
  "README.md",
  "LICENSE",
];

function buildPlatformPackage(platform, destDir) {
  const coreBridgeSrc = join(nodeModulesDir, "@temporalio/core-bridge");
  const coreBridgePkg = readPackageJson(coreBridgeSrc);
  const triple = CORE_BRIDGE_TRIPLES[platform];
  if (!existsSync(join(coreBridgeSrc, "releases", triple))) {
    fail(`core-bridge has no prebuilt release for ${triple}`);
  }

  rmSync(destDir, { recursive: true, force: true });
  mkdirSync(destDir, { recursive: true });

  cpSync(coreBridgeSrc, join(destDir, "core-bridge"), {
    recursive: true,
    dereference: true,
    filter: (src) => {
      const rel = relative(coreBridgeSrc, src);
      if (rel === "") return true;
      const [head, second] = rel.split(/[\\/]/);
      if (head === "releases") return second === undefined || second === triple;
      return CORE_BRIDGE_RUNTIME_PATHS.includes(head);
    },
  });

  writeFileSync(
    join(destDir, "index.cjs"),
    `// Re-exports the vendored @temporalio/core-bridge (MIT), pruned to the\n` +
      `// ${triple} prebuilt release. Loaded via @stigmer/server-slim's\n` +
      `// core-bridge shim — never import this package directly.\n` +
      `module.exports = require("./core-bridge/index.js");\n`,
  );

  const [os, cpu] = platform.split("-");
  writeFileSync(
    join(destDir, "package.json"),
    JSON.stringify(
      {
        name: `@stigmer/server-slim-${platform}`,
        version: serverPkg.version,
        description: `Temporal native bridge for the slim Stigmer TS server (${platform})`,
        license: "MIT",
        main: "index.cjs",
        os: [os],
        cpu: [cpu],
        // The vendored loader resolves these by name at runtime; declared so
        // npm hoists them where the platform package can reach them. Copied
        // verbatim from core-bridge's own manifest (the ranges upstream
        // declares) so the bridge and its JS halves resolve exactly as they
        // do in upstream's install.
        dependencies: {
          "@temporalio/common":
            coreBridgePkg.dependencies["@temporalio/common"],
          "@grpc/grpc-js": coreBridgePkg.dependencies["@grpc/grpc-js"],
        },
        repository: serverPkg.repository,
      },
      null,
      2,
    ) + "\n",
  );
  writeFileSync(
    join(destDir, "README.md"),
    `# @stigmer/server-slim-${platform}\n\n` +
      `Platform support package for [@stigmer/server-slim](https://www.npmjs.com/package/@stigmer/server-slim). ` +
      `Contains [@temporalio/core-bridge](https://www.npmjs.com/package/@temporalio/core-bridge) ` +
      `${coreBridgePkg.version} (MIT) pruned to the ${triple} prebuilt release. ` +
      `Installed automatically on ${os}/${cpu}; never depend on it directly.\n`,
  );
}

// ─── Meta package manifest ───────────────────────────────────────────────────

/**
 * The slim artifact's package.json. Doubles as the npm meta-package manifest
 * and the self-contained directory's module-type marker.
 *
 * NOTE: there is intentionally NO "type": "module" — main.js is a CommonJS
 * bundle (see the FORMAT NOTE in the header); an untyped package is what
 * makes `node main.js` run it as CJS.
 *
 * NOTE: there is intentionally NO "bin". The CLI daemon spawns
 * `node <entry>` directly, and a PATH-visible `stigmer-server` bin would
 * shadow the Go binary in the rollback ladder's `which` step — the exact
 * confusion the coexistence period must avoid.
 *
 * Dependency versions come from the installed tree (the lockfile's truth),
 * so the published artifact runs exactly what was tested here.
 */
function metaPackageJson() {
  const installedVersion = (name) =>
    readPackageJson(join(nodeModulesDir, name)).version;
  const optionalDependencies = {};
  for (const platform of Object.keys(CORE_BRIDGE_TRIPLES)) {
    optionalDependencies[`@stigmer/server-slim-${platform}`] =
      serverPkg.version;
  }
  return {
    name: "@stigmer/server-slim",
    version: serverPkg.version,
    description:
      "Self-contained build of the Stigmer TypeScript control plane, launched by the stigmer CLI's local stack",
    license: serverPkg.license,
    engines: serverPkg.engines,
    dependencies: {
      // Exact: must not skew from the platform packages' native bridge.
      "@temporalio/common": installedVersion("@temporalio/common"),
      "@grpc/grpc-js": `^${installedVersion("@grpc/grpc-js")}`,
    },
    optionalDependencies,
    repository: serverPkg.repository,
  };
}

// ─── Step 4: Stage node_modules for the self-contained shape ────────────────

/**
 * Unlike the runner, the server has zero JS runtime externals — everything
 * bundles. The staged node_modules carries only the per-platform native
 * bridge plus the packages its vendored loader resolves by name, walked
 * TRANSITIVELY (the runner's staging walk): @grpc/grpc-js alone pulls in
 * @js-sdsl/ordered-map and friends, and a missing transitive dependency is
 * exactly the failure verify-slim-artifact.mjs exists to catch.
 */
function stageSelfContained(platform) {
  console.log("[4/5] Staging native bridge packages...");
  const stagedRoot = join(outDir, "node_modules");
  const staged = new Set();

  function stage(name, requiredFromDir) {
    if (name.startsWith("@types/")) return;

    // Node resolution, scoped to the two layouts npm produces here: a copy
    // nested under the requiring package wins (it rode along with its
    // parent's tree), else the top-level package.
    const nestedDir =
      requiredFromDir && join(requiredFromDir, "node_modules", name);
    if (nestedDir && existsSync(nestedDir)) {
      const nestedPkg = readPackageJson(nestedDir);
      for (const dep of Object.keys(nestedPkg.dependencies ?? {})) {
        stage(dep, nestedDir);
      }
      return;
    }
    if (staged.has(name)) return;
    staged.add(name);

    const srcDir = join(nodeModulesDir, name);
    if (!existsSync(srcDir)) {
      fail(`cannot stage "${name}" — not present in node_modules`);
    }
    cpSync(srcDir, join(stagedRoot, name), {
      recursive: true,
      dereference: true,
    });

    const pkg = readPackageJson(srcDir);
    for (const dep of Object.keys(pkg.dependencies ?? {})) {
      stage(dep, srcDir);
    }
  }

  const platformPkgDir = join(
    stagedRoot,
    "@stigmer",
    `server-slim-${platform}`,
  );
  buildPlatformPackage(platform, platformPkgDir);
  for (const dep of Object.keys(readPackageJson(platformPkgDir).dependencies)) {
    stage(dep, null);
  }

  writeFileSync(
    join(outDir, "package.json"),
    JSON.stringify(metaPackageJson(), null, 2) + "\n",
  );
}

// ─── Step 5 (optional): publishable npm package directories ─────────────────

// Files that ship in the published @stigmer/server-slim tarball. Sourcemaps
// are deliberately EXCLUDED (runner precedent, stigmer/stigmer#170) — still
// generated into dist-slim/ for our own debugging, but they dominate install
// size and identifiers stay un-minified anyway.
const META_PACKAGE_FILES = [
  "main.js",
  ...WORKFLOW_BUNDLES.map(({ sibling }) => sibling),
  "workflow-worker-thread.cjs",
  "mappings.wasm",
];

function emitNpmPackages() {
  console.log("[5/5] Emitting npm package directories...");
  rmSync(pkgsDir, { recursive: true, force: true });

  const metaDir = join(pkgsDir, "server-slim");
  mkdirSync(metaDir, { recursive: true });
  for (const file of META_PACKAGE_FILES) {
    const src = join(outDir, file);
    const dest = join(metaDir, file);
    if (file.endsWith(".js") || file.endsWith(".cjs")) {
      // We don't ship the .map files, so strip the trailing sourceMappingURL
      // pragma rather than leave the published bundle pointing at a 404.
      const code = readFileSync(src, "utf8").replace(
        /\n\/\/# sourceMappingURL=\S*\s*$/,
        "\n",
      );
      writeFileSync(dest, code);
    } else {
      cpSync(src, dest);
    }
  }
  writeFileSync(
    join(metaDir, "package.json"),
    JSON.stringify(metaPackageJson(), null, 2) + "\n",
  );
  writeFileSync(
    join(metaDir, "README.md"),
    `# @stigmer/server-slim\n\n` +
      `Self-contained build of the Stigmer TypeScript control plane (\`backend/services/stigmer-server-ts\`). ` +
      `The [stigmer CLI](https://www.npmjs.com/package/@stigmer/cli) installs this package on demand and ` +
      `launches \`node node_modules/@stigmer/server-slim/main.js\` as the local stack's server — same port, ` +
      `same database, same behavior as the Go \`stigmer-server\` it replaces (parity-gated by the repo's ` +
      `test/conformance suite). You should not need to depend on this package directly.\n`,
  );

  for (const platform of Object.keys(CORE_BRIDGE_TRIPLES)) {
    buildPlatformPackage(platform, join(pkgsDir, `server-slim-${platform}`));
  }
}

// ─── Size report ─────────────────────────────────────────────────────────────

function directorySize(path) {
  const stat = statSync(path);
  if (!stat.isDirectory()) return stat.size;
  let total = 0;
  for (const entry of readdirSync(path)) {
    total += directorySize(join(path, entry));
  }
  return total;
}

function printSizeReport(platform) {
  console.log(`\nSlim artifact for ${platform} — size report:`);
  const rows = [];
  for (const entry of readdirSync(outDir).sort()) {
    if (entry === "meta.json") continue;
    if (entry === "node_modules") {
      for (const scope of readdirSync(join(outDir, "node_modules")).sort()) {
        const scopeDir = join(outDir, "node_modules", scope);
        if (scope.startsWith("@")) {
          for (const pkg of readdirSync(scopeDir).sort()) {
            rows.push([
              `node_modules/${scope}/${pkg}`,
              directorySize(join(scopeDir, pkg)),
            ]);
          }
        } else {
          rows.push([`node_modules/${scope}`, directorySize(scopeDir)]);
        }
      }
    } else {
      rows.push([entry, directorySize(join(outDir, entry))]);
    }
  }
  const total = rows.reduce((sum, [, size]) => sum + size, 0);
  for (const [name, size] of rows) {
    console.log(`  ${(size / 1024 / 1024).toFixed(1).padStart(7)} MB  ${name}`);
  }
  console.log(`  ${"─".repeat(40)}`);
  console.log(`  ${(total / 1024 / 1024).toFixed(1).padStart(7)} MB  total`);
}

// ─── Main ────────────────────────────────────────────────────────────────────

const { platform, emitPackages } = parseArgs();

if (!existsSync(join(distDir, "main.js"))) {
  fail("dist/main.js not found — run `npm run build` first");
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

await buildWorkflowBundles();
await buildWorkerThreadBundle();
await buildMainBundle();
stageSelfContained(platform);
if (emitPackages) {
  emitNpmPackages();
}
printSizeReport(platform);
