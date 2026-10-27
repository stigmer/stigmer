#!/usr/bin/env node

/**
 * The published TypeScript libraries, installed the way an outside developer
 * gets them: packed from this checkout into the tarballs a release would
 * upload, installed into an empty project with every peer they declare, then
 * resolved, imported, typechecked and rendered from that project. A library
 * that works inside the workspace (where every import resolves to a sibling's
 * source) can still ship an exports map naming a file its build never wrote,
 * an entry Node cannot load, or types a strict consumer cannot compile; no
 * other smoke installs these four (smoke-getting-started.mjs installs only
 * @stigmer/client).
 *
 * What it packs: @stigmer/ink-ui, @stigmer/react-sdk, @stigmer/embed and
 * @stigmer/design-tokens, with their @stigmer/* closure
 * (scripts/publish-libs.mjs --pack-dir, the same stamped dist/ a release
 * publishes, so the exports map installed is the one built from
 * `publishConfig`). What it installs beside them: every peer any packed
 * package declares, the optional ones included, at the declared range (the
 * highest lower bound where two packages declare one differently), and the
 * React types, at the version the root lockfile pins, that a TypeScript
 * adopter installs with React.
 *
 * Its cases are top-level `node:test` cases, titled with the promise on the
 * UX bar they hold (test/ux-bar.json), so the bar's check reads them from
 * source and the scorecard reads their results through
 * test/install/lib/json-reporter.mjs:
 *   - every entry of every installed @stigmer/* exports map, under every
 *     condition, names a file the tarball shipped, and resolves from the
 *     consumer (a pattern entry must match at least one shipped file);
 *   - the entries Node runs import under Node: each JavaScript entry of the
 *     four libraries and of @stigmer/client. Two are browser-only by design
 *     and are resolved but never imported (BROWSER_ONLY);
 *   - a strict TypeScript consumer of every library compiles against the
 *     installed declarations (test/install/lib/type-checker.mjs's compiler);
 *   - the installed terminal kit renders a scenario of the catalogue
 *     (@stigmer/react-sdk/test) through the installed `ink`'s
 *     `renderToString`.
 *
 * Three known breaks are not cases here; each is an open issue the bar lists
 * as pending, and the change that fixes one adds its case: the kit's bin
 * needs `tsx` (stigmer#2617), its session view crashes off a terminal
 * (stigmer#2618), and the React kit imports its optional peers eagerly
 * (stigmer#2621), which is why every optional peer is installed.
 *
 * Plain Node: `node:*`, test/install/lib, and scripts/publish-libs.mjs run
 * as a child process (the install layer's rule, test/README.md). The
 * libraries' dist/ must be built: `make smoke-libs` builds them first and
 * passes --skip-build; run directly without it, the pack builds every
 * library itself. Peers come from the npm registry, so a registry outage
 * reads red with npm's own error.
 *
 * Usage:
 *   node test/install/smoke-libs.mjs [--skip-build] [--tarballs=<dir>] [--keep]
 *   --tarballs=<dir>  install tarballs already packed there (publish-libs.mjs
 *                     --pack-dir) instead of packing them.
 *   --keep            keep the consumer's folder, which a failure keeps anyway.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import process from "node:process";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";

import { lockedSpec, typeChecker } from "./lib/type-checker.mjs";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

/** The libraries this smoke installs; their @stigmer/* closure comes with them. */
const LIBRARIES = ["@stigmer/ink-ui", "@stigmer/react-sdk", "@stigmer/embed", "@stigmer/design-tokens"];
/** Whose JavaScript entries must import under Node: the four, and the core SDK they are built on. */
const IMPORTED = [...LIBRARIES, "@stigmer/client"];
/** The version the pack stamps: never a published one. */
const SMOKE_VERSION = "0.0.0-libs-smoke";
/**
 * Entries that run only in a browser, by design: resolved, never imported.
 * `./define` registers the `<stigmer-agent>` custom element on load
 * (sdk/embed/src/element.ts), and `./loader` is the script-tag IIFE
 * (sdk/embed/package.json).
 */
const BROWSER_ONLY = new Map([
  ["@stigmer/embed/define", "registers a custom element on load, which needs a DOM"],
  ["@stigmer/embed/loader", "the <script> tag loader, a browser IIFE"],
]);
/** Type packages a TypeScript adopter installs beside React, at the workspace's locked versions. */
const TYPE_PACKAGES = ["@types/react", "@types/react-dom"];
/** A line of the completed scenario's reply (sdk/react/src/test/scenarios.ts), which the rendered frame must show. */
const COMPLETED_REPLY = "Fixed: invoices now round once, at the total.";

function log(step) {
  console.log(`smoke-libs: ${step}`);
}

function parseArgs() {
  const parsed = { skipBuild: false, tarballs: "", keep: false };
  for (const arg of process.argv.slice(2)) {
    let m;
    if (arg === "--skip-build") parsed.skipBuild = true;
    else if (arg === "--keep") parsed.keep = true;
    else if ((m = arg.match(/^--tarballs=(.+)$/)) !== null) parsed.tarballs = resolve(m[1]);
    else {
      console.error(`smoke-libs: unknown argument: ${arg} (usage: node test/install/smoke-libs.mjs [--skip-build] [--tarballs=<dir>] [--keep])`);
      process.exit(2);
    }
  }
  return parsed;
}

/** Runs a command with inherited output (packing and installing log what a failure needs); throws when it fails. */
function run(command, args, cwd) {
  log(`$ ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.status !== 0) throw new Error(`${command} ${args[0]} exited ${result.status ?? result.signal}`);
}

/** Runs a Node script in the consumer's folder and returns its stdout; throws with its stderr when it fails. */
function node(script, args = []) {
  const result = spawnSync(process.execPath, [script, ...args], { cwd: consumer, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`${script} exited ${result.status ?? result.signal}:\n${result.stderr}${result.stdout}`);
  return result.stdout;
}

/** A range's lowest version as [major, minor, patch]; `*` and anything unparsed is [0, 0, 0]. */
function lowerBound(range) {
  const m = /(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(range);
  return m === null ? [0, 0, 0] : [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)];
}

/** Every peer the manifests declare outside @stigmer/*, one range each: the one with the highest lower bound. */
function peerSpecs(manifests) {
  const chosen = new Map();
  for (const manifest of manifests) {
    for (const [name, range] of Object.entries(manifest.peerDependencies ?? {})) {
      if (name.startsWith("@stigmer/")) continue;
      const current = chosen.get(name);
      const higher = current === undefined || compare(lowerBound(range), lowerBound(current)) > 0;
      if (higher) chosen.set(name, range);
    }
  }
  return [...chosen].sort(([a], [b]) => a.localeCompare(b)).map(([name, range]) => `${name}@${range}`);
}

function compare(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

/**
 * Each entry of an exports map with every path it names, under every
 * condition: `{ key: "./x", targets: ["./dist/x.d.ts", "./dist/x.js"] }`.
 * A string map is the "." entry.
 */
function exportEntries(exportsField) {
  const map = typeof exportsField === "string" || Array.isArray(exportsField) ? { ".": exportsField } : exportsField ?? {};
  const targetsOf = (value) =>
    typeof value === "string" ? [value] : Array.isArray(value) ? value.flatMap(targetsOf) : value === null ? [] : Object.values(value).flatMap(targetsOf);
  return Object.entries(map).map(([key, value]) => ({ key, targets: [...new Set(targetsOf(value))] }));
}

/** Files under `dir`, as package-relative POSIX paths. */
function filesUnder(dir, base = dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "node_modules" ? [] : filesUnder(path, base);
    return [relative(base, path).split(sep).join("/")];
  });
}

/** The shipped files a target matches: itself, or for a `*` pattern every file it covers. */
function matchTarget(target, shipped) {
  const path = target.replace(/^\.\//, "");
  if (!path.includes("*")) return shipped.includes(path) ? [path] : [];
  const [prefix, suffix] = path.split("*");
  return shipped.filter((file) => file.startsWith(prefix) && file.endsWith(suffix) && file.length > prefix.length + suffix.length);
}

const args = parseArgs();
const scratch = mkdtempSync(join(tmpdir(), "stigmer-smoke-libs-"));
const consumer = join(scratch, "consumer");
let failed = false;
/** The installed @stigmer/* packages: name, folder, manifest, shipped files. */
let installed = [];

/** Runs a case's body, marking the run failed when it throws, so the folder is kept for debugging. */
function step(body) {
  return async () => {
    try {
      await body();
    } catch (error) {
      failed = true;
      throw error;
    }
  };
}

/**
 * A case's body through {@link step}, under a function literal of the case's
 * own: the UX bar's inventory (scripts/ux-bar.mjs) reads a case only as
 * `test(title, fn)`, so a body handed over as `step(fn)` would hold nothing.
 */
function guarded(body) {
  return step(body)();
}

before(
  step(() => {
    let dir = args.tarballs;
    if (dir === "") {
      dir = join(scratch, "tarballs");
      log(`packing ${LIBRARIES.join(", ")} and their @stigmer/* closure into ${dir}`);
      run(
        process.execPath,
        [
          join(repoRoot, "scripts", "publish-libs.mjs"),
          "--version",
          SMOKE_VERSION,
          "--pack-dir",
          dir,
          ...(args.skipBuild ? ["--skip-build"] : []),
          ...LIBRARIES.flatMap((name) => ["--only", name]),
        ],
        repoRoot,
      );
    }
    const tarballs = readdirSync(dir)
      .filter((name) => name.endsWith(".tgz"))
      .map((name) => join(dir, name));
    if (tarballs.length === 0) throw new Error(`no tarballs in ${dir}`);

    // Each tarball's manifest, read without installing, for the peers it declares.
    const manifests = tarballs.map((tarball) => {
      const read = spawnSync("tar", ["-xzOf", tarball, "package/package.json"], { encoding: "utf8" });
      if (read.status !== 0) throw new Error(`cannot read the manifest in ${tarball}: ${read.stderr}`);
      return JSON.parse(read.stdout);
    });
    const missing = LIBRARIES.filter((name) => !manifests.some((m) => m.name === name));
    if (missing.length > 0) throw new Error(`the pack holds no tarball for ${missing.join(", ")}`);

    mkdirSync(consumer, { recursive: true });
    writeFileSync(join(consumer, "package.json"), `${JSON.stringify({ name: "libs-consumer", private: true, type: "module" }, null, 2)}\n`);
    const peers = peerSpecs(manifests);
    log(`installing ${tarballs.length} tarballs and ${peers.length} peers into ${consumer}`);
    run("npm", ["install", "--no-audit", "--no-fund", ...tarballs, ...peers, ...TYPE_PACKAGES.map((name) => lockedSpec(repoRoot, name))], consumer);

    const scope = join(consumer, "node_modules", "@stigmer");
    installed = readdirSync(scope).map((name) => {
      const dir = join(scope, name);
      return { name: `@stigmer/${name}`, dir, manifest: JSON.parse(readFileSync(join(dir, "package.json"), "utf8")), shipped: filesUnder(dir) };
    });
  }),
);

after(() => {
  if (failed || args.keep) log(`consumer's folder kept: ${consumer}`);
  else rmSync(scratch, { recursive: true, force: true });
});

// Resolves each specifier from the consumer's folder the way Node's ESM
// loader does (the `import` condition), printing { spec: path | error }.
const RESOLVE_SCRIPT = `
const out = {};
for (const spec of JSON.parse(process.argv[2])) {
  try { out[spec] = { path: new URL(import.meta.resolve(spec)).pathname }; }
  catch (error) { out[spec] = { error: String(error.message ?? error) }; }
}
console.log(JSON.stringify(out));
`;

// Imports each specifier from the consumer's folder, printing { spec: exportCount | error }.
const IMPORT_SCRIPT = `
const out = {};
for (const spec of JSON.parse(process.argv[2])) {
  try { out[spec] = { exports: Object.keys(await import(spec)).length }; }
  catch (error) { out[spec] = { error: String(error?.stack ?? error) }; }
}
console.log(JSON.stringify(out));
process.exit(0);
`;

// The terminal kit's thread over the completed scenario, rendered by the
// installed ink to a string at 100 columns.
const RENDER_SCRIPT = `
import React from "react";
import { renderToString } from "ink";
import { MessageThread } from "@stigmer/ink-ui";
import { scenarios } from "@stigmer/react-sdk/test";
const scenario = scenarios.completed;
process.stdout.write(renderToString(React.createElement(MessageThread, { turns: scenario.fold.turns, runs: scenario.runs }), { columns: 100 }));
process.exit(0);
`;

// A strict consumer of every library: each import is used under a declared
// type, so an entry whose declarations do not resolve fails to compile.
const CONSUMER_TS = `
import type { SessionFold, Stigmer } from "@stigmer/client";
import { createNodeClient } from "@stigmer/client/node";
import { useSessionConversation, type UseSessionConversationReturn } from "@stigmer/react-sdk";
import { conversationOf, samples, scenarios, type Scenario } from "@stigmer/react-sdk/test";
import { MessageThread, SessionView, type MessageThreadProps } from "@stigmer/ink-ui";
import { EMBED_PROTOCOL_VERSION, parseHostMessage } from "@stigmer/embed";
import "@stigmer/embed/jsx";
import { THEME_PRESETS, cn, type ThemePresetId } from "@stigmer/design-tokens";

const scenario: Scenario = scenarios.completed;
const fold: SessionFold = scenario.fold;
const conversation: UseSessionConversationReturn = conversationOf(scenario);
const props: MessageThreadProps = { turns: conversation.turns, runs: [samples.run()] };
const hook: (sessionId: string | null, org: string) => UseSessionConversationReturn = useSessionConversation;
const connect: (baseUrl: string) => Stigmer = (baseUrl) => createNodeClient({ baseUrl });
const preset: ThemePresetId = THEME_PRESETS[0].id;
const protocol: number = EMBED_PROTOCOL_VERSION;

export const used = { fold, props, hook, connect, views: [MessageThread, SessionView], className: cn("a", preset), protocol, parseHostMessage };
`;

test(
  "LIB-01 every entry of every installed exports map resolves to a file the tarball shipped",
  () => guarded(() => {
    const problems = [];
    const specifiers = [];
    for (const pkg of installed) {
      if (pkg.manifest.exports === undefined) {
        problems.push(`${pkg.name} ships no exports map`);
        continue;
      }
      for (const { key, targets } of exportEntries(pkg.manifest.exports)) {
        let example = "";
        for (const target of targets) {
          const matches = matchTarget(target, pkg.shipped);
          if (matches.length === 0) problems.push(`${pkg.name} exports "${key}" -> ${target}, which the tarball does not ship`);
          if (example === "" && matches.length > 0 && key.includes("*")) {
            const [prefix, suffix] = target.replace(/^\.\//, "").split("*");
            example = key.replace("*", matches[0].slice(prefix.length, matches[0].length - suffix.length));
          }
        }
        const subpath = key.includes("*") ? example : key;
        if (subpath !== "") specifiers.push(subpath === "." ? pkg.name : `${pkg.name}/${subpath.replace(/^\.\//, "")}`);
      }
    }
    writeFileSync(join(consumer, "resolve.mjs"), RESOLVE_SCRIPT);
    const resolved = JSON.parse(node("resolve.mjs", [JSON.stringify(specifiers)]));
    for (const spec of specifiers) {
      const answer = resolved[spec];
      if (answer.error !== undefined) problems.push(`${spec} does not resolve from a consumer: ${answer.error}`);
      else if (!existsSync(decodeURIComponent(answer.path))) problems.push(`${spec} resolves to ${answer.path}, which does not exist`);
    }
    log(`${installed.length} packages, ${specifiers.length} entries resolved`);
    if (problems.length > 0) throw new Error(problems.join("\n"));
  }),
);

test(
  "LIB-01 the entries Node runs import under Node",
  () => guarded(() => {
    const specifiers = [];
    for (const pkg of installed.filter((p) => IMPORTED.includes(p.name))) {
      for (const { key, targets } of exportEntries(pkg.manifest.exports)) {
        const spec = key === "." ? pkg.name : `${pkg.name}/${key.replace(/^\.\//, "")}`;
        if (BROWSER_ONLY.has(spec)) {
          log(`${spec}: resolved, not imported (${BROWSER_ONLY.get(spec)})`);
          continue;
        }
        if (targets.some((target) => target.endsWith(".js"))) specifiers.push(spec);
      }
    }
    for (const name of IMPORTED) {
      if (!installed.some((p) => p.name === name)) throw new Error(`${name} is not installed`);
    }
    writeFileSync(join(consumer, "import.mjs"), IMPORT_SCRIPT);
    const imported = JSON.parse(node("import.mjs", [JSON.stringify(specifiers)]));
    const problems = specifiers.filter((spec) => imported[spec].error !== undefined).map((spec) => `${spec} does not import under Node:\n${imported[spec].error}`);
    log(`imported ${specifiers.length - problems.length} of ${specifiers.length} entries under Node`);
    if (problems.length > 0) throw new Error(problems.join("\n\n"));
  }),
);

test(
  "LIB-02 a strict TypeScript consumer compiles against every library's types",
  () => guarded(async () => {
    const { tsc, typeRoots } = await typeChecker({ repoRoot, published: false, scratch, run: () => Promise.resolve() });
    writeFileSync(join(consumer, "consumer.ts"), CONSUMER_TS);
    writeFileSync(
      join(consumer, "tsconfig.json"),
      `${JSON.stringify(
        {
          compilerOptions: {
            strict: true,
            noEmit: true,
            target: "es2022",
            module: "nodenext",
            moduleResolution: "nodenext",
            // The consumer's code is checked strictly against the types the
            // installed declarations give it. An error inside a package's own
            // declarations is its build's to catch (each library's tsc writes
            // them), and a third party's is not this smoke's.
            skipLibCheck: true,
            types: ["node"],
            typeRoots: [typeRoots],
          },
          files: ["consumer.ts"],
        },
        null,
        2,
      )}\n`,
    );
    run(tsc, ["-p", join(consumer, "tsconfig.json")], consumer);
    log("the consumer typechecked (strict)");
  }),
);

test(
  "INK-01 the installed terminal kit renders a catalogue scenario",
  () => guarded(() => {
    writeFileSync(join(consumer, "render.mjs"), RENDER_SCRIPT);
    const frame = stripVTControlCharacters(node("render.mjs"));
    if (!frame.includes(COMPLETED_REPLY)) throw new Error(`the rendered thread does not show the reply "${COMPLETED_REPLY}":\n${frame}`);
    log(`rendered the completed scenario (${frame.split("\n").length} lines)`);
  }),
);
