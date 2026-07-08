#!/usr/bin/env node

/**
 * Builds the slim embedding artifact for @stigmer/runner.
 *
 * Why this exists (stigmer/stigmer#170): the plain tsc dist resolves its 30
 * production dependencies from node_modules at runtime — ~508 MB unpacked —
 * and every desktop embedder ships that tree inside their app bundle. This
 * script bundles the runner down to ~85 MB per platform.
 *
 * Two output shapes, same contents:
 *
 * 1. Self-contained directory (default) — `dist-slim/` with a staged
 *    node_modules; copy it into an app bundle and run `node main.js`.
 *    Used by the desktop app's resource staging.
 *
 *    dist-slim/
 *      main.js                     ← esbuild bundle of the whole runner
 *      main.js.map                 ← external sourcemap (identifiers kept)
 *      workflow-bundle.js          ← Temporal workflow code, pre-built here so
 *                                    webpack/@swc never ship (see
 *                                    src/workflow-source.ts)
 *      workflow-worker-thread.cjs  ← Temporal's workflow sandbox thread entry;
 *                                    worker_threads needs a real file on disk
 *      mappings.wasm               ← source-map's lazy-loaded wasm
 *      node_modules/
 *        @stigmer/runner-slim-<platform>  ← Temporal's native bridge, pruned
 *                                           to ONE platform (~22 of ~127 MB)
 *        @cursor/sdk (+platform, +deps)   ← Cursor's own JS + native helper
 *                                           binaries; theirs to distribute,
 *                                           never repackaged
 *        jq-wasm                          ← Emscripten loader needs its
 *                                           co-located wasm
 *        @temporalio/common, @grpc/...    ← runtime deps of the native bridge
 *
 * 2. npm packages (`--emit-packages`) — `dist-slim-pkgs/` with publishable
 *    package directories following the esbuild/Cursor-SDK platform pattern:
 *    `@stigmer/runner-slim` (bundle + real npm dependencies) plus five
 *    `@stigmer/runner-slim-<platform>` packages carrying the pruned native
 *    bridge, installed selectively via optionalDependencies + os/cpu.
 *
 * The JS bundles are platform-independent; only the native staging varies.
 * Cross-platform staging of @cursor/sdk requires the target platform's
 * packages in node_modules, so the self-contained shape builds on a matching
 * host (same model as Tauri's per-platform desktop builds). The npm platform
 * packages carry only core-bridge — whose releases for all five platforms
 * ship in the npm tarball — so `--emit-packages` works from any host.
 *
 * Build with `npm run build` first; this consumes the compiled dist/.
 *
 * Usage:
 *   node scripts/bundle-slim.mjs [--platform=<darwin-arm64|darwin-x64|linux-x64|linux-arm64|win32-x64>] [--emit-packages]
 */

import { build } from "esbuild";
import { bundleWorkflowCode } from "@temporalio/worker";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

const runnerRoot = fileURLToPath(new URL("..", import.meta.url));
const distDir = join(runnerRoot, "dist");
const nodeModulesDir = join(runnerRoot, "node_modules");
const outDir = join(runnerRoot, "dist-slim");
const pkgsDir = join(runnerRoot, "dist-slim-pkgs");

/**
 * Packages that stay OUTSIDE the bundle and resolve from node_modules at
 * runtime. Everything else — LangChain, OTel, Temporal's JS, openai,
 * deepagents, @stigmer/protos, the lot — is compiled into main.js.
 *
 * - @cursor/sdk: resolves its per-platform helper binaries (cursorsandbox,
 *   rg) and native sqlite3 from sibling packages at runtime.
 * - jq-wasm: Emscripten loader reads its .wasm relative to its own module.
 *
 * @temporalio/core-bridge (the third native piece) is NOT listed here: it is
 * aliased to core-bridge-shim.cjs, which dispatches to the per-platform
 * @stigmer/runner-slim-<platform> package. Duplicated @temporalio/common
 * copies (bundled + the staged one core-bridge links against) are safe:
 * Temporal's error classes use Symbol.for-based instanceof precisely so
 * multiple copies interoperate.
 */
const RUNTIME_EXTERNALS = ["@cursor/sdk", "jq-wasm"];

/**
 * Assets that bundled modules read from disk relative to their __dirname.
 * The bundle's banner pins __dirname to the artifact root, so these are
 * copied there. (source-map powers @temporalio/worker's workflow stack-trace
 * mapping and lazy-loads its wasm at first use.)
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

// Must stay in sync with src/workflow-source.ts. Imported from the compiled
// dist (not src) so the script has no TypeScript loader dependency.
const { OTEL_WORKFLOW_INTERCEPTOR_MODULE } = await import(
  new URL("../dist/workflow-source.js", import.meta.url).href
);

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
    fail(`Unsupported platform "${platform}". Supported: ${Object.keys(CORE_BRIDGE_TRIPLES).join(", ")}`);
  }
  return { platform, isCrossBuild: platform !== hostPlatform, emitPackages };
}

function fail(message) {
  console.error(`bundle-slim: ${message}`);
  process.exit(1);
}

function readPackageJson(dir) {
  return JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
}

const runnerPkg = readPackageJson(runnerRoot);

// ─── Step 1: Pre-build the Temporal workflow bundle ─────────────────────────

async function buildWorkflowBundle() {
  console.log("[1/5] Pre-building Temporal workflow bundle...");
  const { code } = await bundleWorkflowCode({
    workflowsPath: join(distDir, "workflows", "index.js"),
    // Baked in unconditionally; the interceptor is inert unless the host
    // configures the OTel sink. This also closes the gap where manager-mode
    // runtime bundling historically omitted it (see runner-manager.ts).
    workflowInterceptorModules: [require.resolve(OTEL_WORKFLOW_INTERCEPTOR_MODULE)],
  });
  writeFileSync(join(outDir, "workflow-bundle.js"), code);
}

// ─── Step 2: Bundle Temporal's workflow sandbox worker-thread entry ─────────

/**
 * Temporal runs workflow isolates on a worker thread whose entry it locates
 * with `require.resolve('./workflow-worker-thread')` — a real file on disk
 * that a single-file bundle cannot provide. So that entry gets its own
 * (pure-JS, self-contained) bundle, and the main bundle's copy of threaded-vm
 * is patched to point at it (see the plugin below).
 */
async function buildWorkerThreadBundle() {
  console.log("[2/5] Bundling Temporal workflow worker-thread entry...");
  await build({
    entryPoints: [join(nodeModulesDir, "@temporalio/worker/lib/workflow/workflow-worker-thread.js")],
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
      "@temporalio/core-bridge": join(runnerRoot, "scripts", "core-bridge-shim.cjs"),
    },
    logLevel: "warning",
  });
}

// ─── Step 3: Bundle the runner itself ────────────────────────────────────────

/**
 * Replaces @temporalio/worker's runtime webpack bundler with a stub. Slim
 * builds always ship a pre-built workflow-bundle.js (workflow-source.ts
 * prefers it), so the bundler — and with it webpack, @swc/core, memfs and
 * friends (~45 MB) — must never enter the module graph. The stub keeps the
 * module's export shape and fails loudly if something calls it anyway.
 */
const stubTemporalBundlerPlugin = {
  name: "stub-temporal-workflow-bundler",
  setup(buildApi) {
    buildApi.onLoad({ filter: /@temporalio[\\/]worker[\\/]lib[\\/]workflow[\\/]bundler\.js$/ }, () => ({
      contents: `
        const UNAVAILABLE = "Runtime workflow bundling is unavailable in the slim runner artifact; it ships a pre-built workflow-bundle.js (see workflow-source.ts)";
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
    }));
  },
};

/**
 * Redirects threaded-vm's `require.resolve('./workflow-worker-thread')` to
 * the sibling bundle emitted in step 2. Exact-match replacement with a count
 * assertion so a Temporal upgrade that moves this callsite breaks the build
 * loudly instead of producing a runner that cannot start workflow sandboxes.
 */
const patchThreadedVmPlugin = {
  name: "patch-temporal-threaded-vm",
  setup(buildApi) {
    buildApi.onLoad({ filter: /@temporalio[\\/]worker[\\/]lib[\\/]workflow[\\/]threaded-vm\.js$/ }, (args) => {
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
        contents: source.replace(needle, "globalThis.__stigmerWorkflowWorkerThreadPath()"),
        loader: "js",
      };
    });
  },
};

/**
 * CJS-output preamble.
 *
 * The bundle is emitted as CommonJS (see buildMainBundle) so the runner's
 * deliberate dynamic-import load order survives bundling. In CJS, `require`,
 * `__filename`, and `__dirname` are native — we must NOT redeclare them. Two
 * things still need wiring:
 *
 *  - `import.meta.url`: empty under CJS, but the source uses it for
 *    `createRequire(import.meta.url)` (http2-interceptor, worker). We map every
 *    `import.meta.url` to this banner's file-URL of the bundle via esbuild
 *    `define` (see buildMainBundle), so createRequire resolves builtins and
 *    packages relative to main.js — exactly as the un-bundled dist does.
 *  - the worker-thread entry path for the threaded-vm patch above, published on
 *    globalThis using the native __dirname.
 */
const CJS_BANNER = `
const { pathToFileURL: __stigmerPathToFileURL } = require("node:url");
const { join: __stigmerJoin } = require("node:path");
const __stigmerImportMetaUrl = __stigmerPathToFileURL(__filename).href;
globalThis.__stigmerWorkflowWorkerThreadPath = () => __stigmerJoin(__dirname, "workflow-worker-thread.cjs");
`;

async function buildMainBundle() {
  console.log("[3/5] Bundling runner entry (dist/main.js)...");
  const result = await build({
    entryPoints: [join(distDir, "main.js")],
    outfile: join(outDir, "main.js"),
    bundle: true,
    platform: "node",
    // CJS, NOT ESM — this is load-bearing (stigmer/stigmer#170). The runner
    // installs its fetch + http2 interceptors and only THEN lazily loads
    // @cursor/sdk and @connectrpc/connect-node (via dynamic import) so the
    // interceptors are in place first. ESM bundling defeats this: esbuild
    // hoists every external import (incl. node:http2, pulled in by connect-node)
    // to the top of the file, where ESM evaluates them before any code runs —
    // freezing the node:http2 namespace and capturing the original fetch before
    // install. CJS preserves the source's lazy module-evaluation order, so the
    // dynamic-import boundary keeps both interceptors correct. Keep main.js as
    // the filename (the meta manifest drops "type":"module", so .js is CJS) to
    // avoid rippling an entry-path rename through the desktop staging, docs, and
    // the verify gate. The worker-thread bundle below is already CJS, so the
    // slim build is now uniformly CommonJS.
    format: "cjs",
    target: "node22",
    // Identifiers are kept so embedders' stack traces stay readable; the
    // external sourcemap recovers original file/line on our side.
    minifyWhitespace: true,
    minifySyntax: true,
    minifyIdentifiers: false,
    sourcemap: "linked",
    external: RUNTIME_EXTERNALS,
    // `import.meta.url` is empty under CJS; the source uses it for
    // createRequire(import.meta.url). Map it to the banner-computed file URL of
    // the bundle so createRequire resolves builtins/packages from main.js.
    define: { "import.meta.url": "__stigmerImportMetaUrl" },
    // The native bridge import dispatches to the per-platform package at
    // runtime instead of upstream's all-platforms-in-one package.
    alias: {
      "@temporalio/core-bridge": join(runnerRoot, "scripts", "core-bridge-shim.cjs"),
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
 * ~127 MB) plus the vendored Rust sources to build from scratch (~7 MB).
 * The runtime needs exactly: the JS loader (index.js / common.js / lib/) and
 * ONE platform's prebuilt release. Temporal's own prebuilt-path loader stays
 * byte-for-byte intact inside the platform package's core-bridge/ directory.
 */
const CORE_BRIDGE_RUNTIME_PATHS = ["package.json", "index.js", "common.js", "lib", "README.md", "LICENSE"];

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
      `// ${triple} prebuilt release. Loaded via @stigmer/runner-slim's\n` +
      `// core-bridge shim — never import this package directly.\n` +
      `module.exports = require("./core-bridge/index.js");\n`,
  );

  const [os, cpu] = platform.split("-");
  writeFileSync(
    join(destDir, "package.json"),
    JSON.stringify(
      {
        name: `@stigmer/runner-slim-${platform}`,
        version: runnerPkg.version,
        description: `Temporal native bridge for the slim Stigmer runner (${platform})`,
        license: "MIT",
        main: "index.cjs",
        os: [os],
        cpu: [cpu],
        // The vendored loader resolves these by name at runtime; declared so
        // npm hoists them where the platform package can reach them. Pinned
        // exactly: the bridge and its JS halves must not skew.
        dependencies: {
          "@temporalio/common": coreBridgePkg.dependencies["@temporalio/common"],
          "@grpc/grpc-js": coreBridgePkg.dependencies["@grpc/grpc-js"],
        },
        repository: runnerPkg.repository,
      },
      null,
      2,
    ) + "\n",
  );
  writeFileSync(
    join(destDir, "README.md"),
    `# @stigmer/runner-slim-${platform}\n\n` +
      `Platform support package for [@stigmer/runner-slim](https://www.npmjs.com/package/@stigmer/runner-slim). ` +
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
 * NOTE: there is intentionally NO "type": "module". main.js is a CommonJS
 * bundle (see buildMainBundle and stigmer/stigmer#170) — leaving the package
 * untyped (default CommonJS) is what makes `node main.js` run it as CJS, which
 * is what preserves the runner's interceptor load order. Adding "type":"module"
 * here would reintroduce the bug.
 *
 * Dependency versions come from the installed tree (the lockfile's truth),
 * so the published artifact runs exactly what was tested here.
 */
function metaPackageJson() {
  const installedVersion = (name) => readPackageJson(join(nodeModulesDir, name)).version;
  const optionalDependencies = {};
  for (const platform of Object.keys(CORE_BRIDGE_TRIPLES)) {
    optionalDependencies[`@stigmer/runner-slim-${platform}`] = runnerPkg.version;
  }
  return {
    name: "@stigmer/runner-slim",
    version: runnerPkg.version,
    description:
      "Self-contained Stigmer runner build for embedding in desktop apps — the bundle-friendly @stigmer/runner",
    license: runnerPkg.license,
    engines: runnerPkg.engines,
    bin: { "stigmer-runner": "./main.js" },
    dependencies: {
      // Exact: ships native helper binaries that must match what was tested.
      "@cursor/sdk": installedVersion("@cursor/sdk"),
      // Exact: must not skew from the platform packages' native bridge.
      "@temporalio/common": installedVersion("@temporalio/common"),
      "@grpc/grpc-js": `^${installedVersion("@grpc/grpc-js")}`,
      "jq-wasm": `^${installedVersion("jq-wasm")}`,
    },
    optionalDependencies,
    keywords: [...(runnerPkg.keywords ?? []), "embedding", "desktop"],
    repository: runnerPkg.repository,
  };
}

// ─── Step 4: Stage node_modules for the self-contained shape ────────────────

/**
 * Copies the runtime externals plus their transitive production dependencies
 * into dist-slim/node_modules, mirroring npm's layout. Nested node_modules
 * (npm's version-conflict copies, e.g. @cursor/sdk's pinned @connectrpc v1)
 * ride along with their parent package, so resolution inside the staged tree
 * behaves exactly as it does in the full install.
 */
function stageSelfContained(platform, isCrossBuild) {
  console.log("[4/5] Staging native/runtime packages...");
  const stagedRoot = join(outDir, "node_modules");
  const staged = new Set();

  function stage(name, requiredFromDir) {
    // Type-declaration packages are dead weight at runtime, even when a
    // dependency (incorrectly) lists them under "dependencies".
    if (name.startsWith("@types/")) return;

    // Node resolution, scoped to the two layouts npm produces here: a copy
    // nested under the requiring package wins, else the top-level package.
    const nestedDir = requiredFromDir && join(requiredFromDir, "node_modules", name);
    if (nestedDir && existsSync(nestedDir)) {
      // The nested copy itself rode along with its parent's directory tree,
      // but its own dependencies may still resolve to top-level packages
      // (npm hoists whatever doesn't conflict), so the walk must continue.
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
      fail(
        `cannot stage "${name}" — not present in node_modules.` +
          (isCrossBuild ? " Cross-platform builds need an install done on the target platform." : ""),
      );
    }
    cpSync(srcDir, join(stagedRoot, name), { recursive: true, dereference: true });

    const pkg = readPackageJson(srcDir);
    for (const dep of Object.keys(pkg.dependencies ?? {})) {
      stage(dep, srcDir);
    }
    if (name === "@cursor/sdk") {
      // Platform helper binaries are optionalDependencies; only the target
      // platform's package ships.
      const platformPkg = `@cursor/sdk-${platform}`;
      if (!(platformPkg in (pkg.optionalDependencies ?? {}))) {
        fail(`@cursor/sdk has no platform package for ${platform}`);
      }
      stage(platformPkg, srcDir);
    }
  }

  for (const external of RUNTIME_EXTERNALS) {
    stage(external, null);
  }

  // The native bridge, in the same per-platform package layout npm installs —
  // one resolution path for both artifact shapes (see core-bridge-shim.cjs).
  const platformPkgDir = join(stagedRoot, "@stigmer", `runner-slim-${platform}`);
  buildPlatformPackage(platform, platformPkgDir);
  for (const dep of Object.keys(readPackageJson(platformPkgDir).dependencies)) {
    stage(dep, null);
  }

  writeFileSync(join(outDir, "package.json"), JSON.stringify(metaPackageJson(), null, 2) + "\n");
}

// ─── Step 5 (optional): publishable npm package directories ─────────────────

// Files that ship in the published @stigmer/runner-slim tarball. Sourcemaps are
// deliberately EXCLUDED here (~26 MB) — they are still generated into dist-slim/
// for our own debugging, but embedders don't need them and they dominated the
// install size (stigmer/stigmer#170). Identifiers stay un-minified, so embedder
// stack traces remain readable without the maps.
const META_PACKAGE_FILES = [
  "main.js",
  "workflow-bundle.js",
  "workflow-worker-thread.cjs",
  "mappings.wasm",
];

function emitNpmPackages() {
  console.log("[5/5] Emitting npm package directories...");
  rmSync(pkgsDir, { recursive: true, force: true });

  const metaDir = join(pkgsDir, "runner-slim");
  mkdirSync(metaDir, { recursive: true });
  for (const file of META_PACKAGE_FILES) {
    const src = join(outDir, file);
    const dest = join(metaDir, file);
    if (file.endsWith(".js") || file.endsWith(".cjs")) {
      // We don't ship the .map files, so strip the trailing sourceMappingURL
      // pragma rather than leave the published bundle pointing at a 404.
      const code = readFileSync(src, "utf8").replace(/\n\/\/# sourceMappingURL=\S*\s*$/, "\n");
      writeFileSync(dest, code);
    } else {
      cpSync(src, dest);
    }
  }
  writeFileSync(join(metaDir, "package.json"), JSON.stringify(metaPackageJson(), null, 2) + "\n");
  writeFileSync(
    join(metaDir, "README.md"),
    `# @stigmer/runner-slim\n\n` +
      `The bundle-friendly build of [@stigmer/runner](https://www.npmjs.com/package/@stigmer/runner) ` +
      `for embedding in desktop apps: a self-contained \`main.js\` plus only the dependencies that ` +
      `genuinely cannot be bundled (native Temporal bridge, Cursor SDK binaries, jq wasm). ` +
      `~85 MB installed per platform instead of ~508 MB.\n\n` +
      `Spawn \`node node_modules/@stigmer/runner-slim/main.js\` (or the \`stigmer-runner\` bin) ` +
      `exactly as you would the full package's \`dist/main.js\` — same modes, same IPC protocol, ` +
      `same environment variables. See the embedding guide: ` +
      `https://docs.stigmer.ai/guides/runners/embedding\n`,
  );

  for (const platform of Object.keys(CORE_BRIDGE_TRIPLES)) {
    buildPlatformPackage(platform, join(pkgsDir, `runner-slim-${platform}`));
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
            rows.push([`node_modules/${scope}/${pkg}`, directorySize(join(scopeDir, pkg))]);
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

const { platform, isCrossBuild, emitPackages } = parseArgs();

if (!existsSync(join(distDir, "main.js"))) {
  fail("dist/main.js not found — run `npm run build` first");
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

await buildWorkflowBundle();
await buildWorkerThreadBundle();
await buildMainBundle();
stageSelfContained(platform, isCrossBuild);
if (emitPackages) {
  emitNpmPackages();
}
printSizeReport(platform);
