#!/usr/bin/env node

/**
 * What the published libraries make an app download, held to the ceilings
 * in test/bundle-budgets.json. A change that makes the React kit's provider
 * or its session screens heavier, its stylesheet larger or the embed's
 * loader bigger fails here, and names what weighs most in the entry, before
 * an adopter's bundle finds out.
 *
 * What it measures, in gzip bytes:
 *   - react-sdk/provider: an app that imports `StigmerProvider` and
 *     `useStigmer`, the JavaScript it loads at once;
 *   - react-sdk/session: an app that imports `SessionViewer` and
 *     `NewSessionViewer`, the JavaScript it loads at once (the chunks it
 *     loads later, the diagram and maths renderers, are reported, not held);
 *   - react-sdk/styles: the stylesheet the kit ships, dist/styles.css;
 *   - embed/loader: the `<script>` tag loader, dist/embed.global.js.
 *
 * The JavaScript is bundled from the workspace by the Vite (Rollup) the
 * root lockfile pins, as an app's bundler builds it: minified, split, with
 * React left to the app as a peer and every other dependency at the version
 * the lockfile locks (test/install/lib/bundle-budget.mjs has the rules). So
 * a figure moves only when this repository's code or lockfile does: a
 * dependency update that grows the kit says so in its own pull request. The
 * library smoke (smoke-libs.mjs) installs peers by range instead, which is
 * right for "it installs" and wrong for "it weighs". The tarball's
 * JavaScript is the TypeScript compiler's output of the same sources, so
 * the figure is what an adopter on these versions bundles.
 *
 * Why Vite and not esbuild: esbuild's code splitting puts every file a lazy
 * chunk also uses into a shared chunk the entry imports, so the provider
 * alone read 512 KB gzip there against Rollup's 11 KB (2026-10-27); without
 * splitting it cannot tell what loads later. Rollup's bundle carries each
 * chunk's modules and the bytes each renders, which is what names the
 * heaviest when an entry is over.
 *
 * Each entry is built by `vite build` as a child process, over a config this
 * script writes beside the entry under node_modules/.cache/stigmer-budgets/,
 * so the entry resolves the kit as an app in this workspace does; the
 * config's plugin writes the chunk report the budgets are judged from.
 *
 * Its one case is titled with the promise it holds on the UX bar
 * (test/ux-bar.json), so the bar's check reads it from source and the
 * scorecard reads its result through test/install/lib/json-reporter.mjs.
 *
 * A ceiling is the figure it was set from and 2% (`ceilingFor`), and is
 * raised by editing test/bundle-budgets.json, a gate file (test/README.md,
 * rule 5), in the open. An entry more than 10% under its ceiling is said,
 * with the ceiling to set, so the ceiling follows a saving down.
 *
 * Plain Node: `node:*`, test/install/lib, and Vite run as a child process
 * (the install layer's rule, test/README.md). The stylesheet and the loader
 * are build outputs: `make smoke-budgets` builds the libraries first.
 *
 * Usage:
 *   node test/install/smoke-budgets.mjs [--keep] [--skip-build]
 *   --keep        keep the bundles and their chunk reports, which a failure
 *                 keeps anyway.
 *   --skip-build  accepted and changes nothing: this smoke never builds, and
 *                 the scorecard passes the flag to every smoke.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

import { ceilingFor, eagerChunks, formatBytes, heaviest, judgeBudgets, readBudgets } from "./lib/bundle-budget.mjs";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const BUDGETS = join(repoRoot, "test", "bundle-budgets.json");
const VITE = join(repoRoot, "node_modules", ".bin", "vite");
/** Inside the workspace's node_modules, so an entry resolves `@stigmer/react-sdk` as an app here does. */
const SCRATCH = join(repoRoot, "node_modules", ".cache", "stigmer-budgets");

/** The JavaScript entries: what an app imports, as a module of its own. */
const SCRIPT_ENTRIES = [
  { name: "react-sdk/provider", source: 'export { StigmerProvider, useStigmer } from "@stigmer/react-sdk";\n' },
  { name: "react-sdk/session", source: 'export { SessionViewer, NewSessionViewer } from "@stigmer/react-sdk";\n' },
];
/** The built files measured as they ship. */
const FILE_ENTRIES = [
  { name: "react-sdk/styles", path: "sdk/react/dist/styles.css" },
  { name: "embed/loader", path: "sdk/embed/dist/embed.global.js" },
];
/** What the app provides itself: React is every kit's peer. */
const EXTERNAL = ["react", "react-dom", "react/jsx-runtime", "react-dom/client"];

const args = process.argv.slice(2);
const unknown = args.filter((arg) => arg !== "--keep" && arg !== "--skip-build");
if (unknown.length > 0) {
  console.error(`smoke-budgets: unknown argument: ${unknown[0]} (usage: node test/install/smoke-budgets.mjs [--keep] [--skip-build])`);
  process.exit(2);
}
const keep = args.includes("--keep");
let failed = false;

function log(line) {
  console.log(`smoke-budgets: ${line}`);
}

function gzipBytes(path) {
  return gzipSync(readFileSync(path), { level: 9 }).length;
}

/** The Vite config that builds one entry and writes its chunk report. */
function viteConfig(entry, out, report) {
  return `// Written by test/install/smoke-budgets.mjs; rewritten on every run.
import { writeFileSync } from "node:fs";
import { relative } from "node:path";

const root = ${JSON.stringify(repoRoot)};
/** A module id as the report names it: repository-relative, the bundler's own helpers apart. */
const idOf = (id) => (id.startsWith("\\0") ? "(bundler runtime)" : relative(root, id.split("?")[0]));

export default {
  root,
  logLevel: "error",
  publicDir: false,
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: {
    outDir: ${JSON.stringify(out)},
    emptyOutDir: true,
    minify: "esbuild",
    target: "es2022",
    reportCompressedSize: false,
    rollupOptions: {
      input: ${JSON.stringify(entry)},
      external: ${JSON.stringify(EXTERNAL)},
      preserveEntrySignatures: "strict",
      output: { format: "es" },
    },
  },
  plugins: [
    {
      name: "stigmer-budget-report",
      generateBundle(_options, bundle) {
        const chunks = Object.values(bundle)
          .filter((item) => item.type === "chunk")
          .map((chunk) => ({
            file: chunk.fileName,
            isEntry: chunk.isEntry,
            imports: chunk.imports,
            dynamicImports: chunk.dynamicImports,
            modules: Object.fromEntries(Object.entries(chunk.modules).map(([id, m]) => [idOf(id), m.renderedLength])),
          }));
        writeFileSync(${JSON.stringify(report)}, JSON.stringify(chunks));
      },
    },
  ],
};
`;
}

/** Bundles one entry and returns its eager and lazy gzip bytes and what weighs most in the eager part. */
function bundle({ name, source }) {
  const dir = join(SCRATCH, name.replace("/", "-"));
  mkdirSync(dir, { recursive: true });
  const entry = join(dir, "entry.mjs");
  const out = join(dir, "out");
  const report = join(dir, "chunks.json");
  const config = join(dir, "vite.config.mjs");
  writeFileSync(entry, source);
  writeFileSync(config, viteConfig(entry, out, report));
  rmSync(report, { force: true });
  const result = spawnSync(VITE, ["build", "--config", config], { cwd: repoRoot, encoding: "utf8" });
  if (result.status !== 0 || !existsSync(report)) throw new Error(`vite could not bundle ${name}:\n${result.stderr}${result.stdout}`);
  const chunks = JSON.parse(readFileSync(report, "utf8"));
  const eager = eagerChunks(chunks);
  const gzip = new Map(chunks.map((chunk) => [chunk.file, gzipBytes(join(out, chunk.file))]));
  const sum = (files) => files.reduce((total, file) => total + (gzip.get(file) ?? 0), 0);
  return {
    eager: sum([...eager]),
    lazy: sum(chunks.map((chunk) => chunk.file).filter((file) => !eager.has(file))),
    heaviest: heaviest(chunks, eager),
  };
}

after(() => {
  if (keep || failed) log(`kept the bundles and their chunk reports in ${SCRATCH}`);
  else rmSync(SCRATCH, { recursive: true, force: true });
});

test("LIB-03 every library entry stays within its size budget", () => {
  try {
    const budgets = readBudgets(readFileSync(BUDGETS, "utf8"));
    const { version } = JSON.parse(readFileSync(join(repoRoot, "node_modules", "vite", "package.json"), "utf8"));
    log(`bundling with vite ${version}, the root lockfile's`);
    const measured = new Map();
    const weighs = new Map();
    for (const entry of SCRIPT_ENTRIES) {
      const { eager, lazy, heaviest: top } = bundle(entry);
      measured.set(entry.name, eager);
      weighs.set(entry.name, top);
      log(`${entry.name}: ${formatBytes(eager)} gzip at once${lazy > 0 ? `, ${formatBytes(lazy)} more loaded later` : ""}`);
    }
    for (const { name, path } of FILE_ENTRIES) {
      const file = join(repoRoot, path);
      if (!existsSync(file)) throw new Error(`${path} is not built: run \`make smoke-budgets\`, which builds the libraries first`);
      measured.set(name, gzipBytes(file));
      log(`${name}: ${formatBytes(measured.get(name))} gzip`);
    }
    const judged = judgeBudgets(measured, budgets);
    for (const { entry, bytes, ceiling } of judged.lower) {
      log(`${entry}: ${formatBytes(bytes)} is more than 10% under its ${formatBytes(ceiling)} budget; lower it in test/bundle-budgets.json to ${ceilingFor(bytes)}`);
    }
    const problems = [
      ...judged.over.map(({ entry, bytes, ceiling }) => {
        const top = weighs.get(entry);
        const most = top === undefined ? "" : `\n  weighs most (before minifying): ${top.map(({ owner, bytes: b }) => `${owner} ${formatBytes(b)}`).join(", ")}`;
        return `${entry}: ${formatBytes(bytes)} gzip, budget ${formatBytes(ceiling)}${most}`;
      }),
      ...judged.unbudgeted.map((entry) => `${entry} is measured but has no budget in test/bundle-budgets.json: add it`),
      ...judged.unmeasured.map((entry) => `${entry} has a budget but nothing measures it: remove it from test/bundle-budgets.json`),
    ];
    if (problems.length > 0) throw new Error(`over budget, or a budget without its entry:\n${problems.join("\n")}`);
  } catch (error) {
    failed = true;
    throw error;
  }
});
