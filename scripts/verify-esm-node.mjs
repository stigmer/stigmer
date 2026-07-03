#!/usr/bin/env node

/**
 * Node-ESM regression gate for the published @stigmer/* packages.
 *
 * Regression lock for stigmer/stigmer#209: @stigmer/sdk, @stigmer/react, and
 * @stigmer/theme once shipped `dist` with extension-less relative specifiers
 * (`from "./foo"`), which bundlers resolve but plain Node ESM cannot — crashing
 * every Node consumer (the CLI, `npx @stigmer/mcp-server`). Dev/tests never
 * caught it because they run under tsx (esbuild, extension-optional).
 *
 * This gate statically verifies the invariant Node ESM enforces: every RELATIVE
 * import/export/dynamic-import specifier in a shipped `dist` module carries an
 * explicit extension and points at a file that exists. It is deliberately
 * static rather than an actual `import()`:
 *
 *   - Deterministic + offline. No `npm pack`/install, no network, no version
 *     stamping. In the workspace, `@stigmer/sdk`'s package `exports` point at
 *     TypeScript source (its dev entry), so a real `import()` of a built module
 *     that depends on another workspace package fails under plain Node for
 *     reasons unrelated to this bug.
 *   - Complete. It scans every shipped module, so lazily-imported chunks
 *     (React.lazy) are covered — an eager `import()` would never reach them.
 *   - No false positives. `@stigmer/react` is browser-oriented; only the
 *     headless subset the CLI loads is meant to run under Node, so executing its
 *     full module graph would fail for reasons unrelated to specifier
 *     resolution. Static analysis sidesteps that entirely.
 *
 * The `npm i -g @stigmer/cli` clean-room (the reporter's exact repro) remains
 * the manual post-release acceptance check against the truly published tarballs.
 *
 * Package list is shared with the publisher (scripts/publish-libs.mjs) so the
 * two never drift.
 *
 * Usage:
 *   npm run build:libs && node scripts/verify-esm-node.mjs
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

import { PACKAGES } from "./publish-libs.mjs";

const require = createRequire(import.meta.url);
const ts = require("typescript");

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Runtime module extensions Node ESM accepts on an explicit relative specifier.
// `.json` is included because `resolveJsonModule` emits data imports.
const RESOLVABLE_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".json"]);

function isRelative(spec) {
  return spec.startsWith("./") || spec.startsWith("../");
}

/**
 * Extract every relative module specifier (static import/export + runtime
 * dynamic `import()`) from a compiled module. Uses the TypeScript parser rather
 * than a regex so string literals and comments can never be mistaken for
 * imports. Type-only syntax is already erased in emitted `dist` output.
 */
export function extractRelativeSpecifiers(sourceText, fileName = "module.js") {
  const sourceFile = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
  );
  const specifiers = [];

  const visit = (node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length > 0 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      specifiers.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return specifiers.filter(isRelative);
}

/**
 * Validate a single relative specifier as Node ESM would. Returns a failure
 * reason string, or null when the specifier is Node-resolvable.
 */
export function validateSpecifier(fromFile, spec) {
  const ext = extname(spec);
  if (!RESOLVABLE_EXTENSIONS.has(ext)) {
    return `extension-less relative specifier "${spec}" (Node ESM requires an explicit extension, e.g. "${spec}.js")`;
  }
  const target = resolve(dirname(fromFile), spec);
  if (!existsSync(target)) {
    return `relative specifier "${spec}" resolves to a missing file (${relative(root, target)})`;
  }
  return null;
}

function listJsFiles(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      // Test files ship in some packages' dist (a pre-existing build-config
      // quirk) and are intentionally not part of this codemod; they are not
      // consumer-reachable runtime modules, so they are out of scope here.
      if (entry.name === "__tests__") continue;
      out.push(...listJsFiles(full));
    } else if (
      entry.name.endsWith(".js") &&
      !entry.name.endsWith(".test.js") &&
      !entry.name.endsWith(".spec.js") &&
      // Legacy `*_connect.js` are dead output from protoc-gen-connect-es v1.6.1
      // (its `import_extension=js` emitted malformed `./x_pbjs` specifiers). They
      // have zero consumers — the SDK uses @connectrpc/connect v2, which embeds
      // services in the `_pb` modules — and don't resolve under any bundler, so
      // they predate and fall outside stigmer/stigmer#209. Removing them belongs
      // to a separate protos-codegen cleanup, not this Node-ESM gate.
      !entry.name.endsWith("_connect.js")
    ) {
      out.push(full);
    }
  }
  return out;
}

/** Scan one package's dist directory; returns an array of violation objects. */
export function checkDistDir(distDir) {
  const violations = [];
  for (const file of listJsFiles(distDir)) {
    const source = readFileSync(file, "utf8");
    for (const spec of extractRelativeSpecifiers(source, file)) {
      const reason = validateSpecifier(file, spec);
      if (reason) violations.push({ file: relative(root, file), spec, reason });
    }
  }
  return violations;
}

function main() {
  const packages = PACKAGES;
  let total = 0;
  let scanned = 0;

  console.log("\nverify-esm-node: checking published dist for Node-resolvable ESM\n");

  for (const relPath of packages) {
    const distDir = resolve(root, relPath, "dist");
    if (!existsSync(distDir) || !statSync(distDir).isDirectory()) {
      console.error(
        `verify-esm-node: FAIL — ${relPath}/dist not found. Run \`npm run build:libs\` first.`,
      );
      process.exit(1);
    }
    const violations = checkDistDir(distDir);
    scanned += 1;
    if (violations.length === 0) {
      console.log(`  ok  ${relPath}`);
    } else {
      total += violations.length;
      console.log(`  FAIL ${relPath} (${violations.length})`);
      for (const v of violations) {
        console.log(`       ${v.file}: ${v.reason}`);
      }
    }
  }

  if (total > 0) {
    console.error(
      `\nverify-esm-node: FAIL — ${total} non-Node-resolvable specifier(s) across ${scanned} package(s).` +
        `\nThese ship in dist but crash under plain Node ESM (see stigmer/stigmer#209).`,
    );
    process.exit(1);
  }

  console.log(`\nverify-esm-node: OK — ${scanned} package(s) are Node-ESM clean.\n`);
}

// Only run when invoked directly (not when imported by the test).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
