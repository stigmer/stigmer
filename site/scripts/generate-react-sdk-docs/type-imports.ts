/**
 * Where a reader imports a type a kit's signature names from.
 *
 * TypeDoc names the package a type is declared in (`ExternalTarget`), which
 * is not always the package a reader installs: `ToolUse` is declared in
 * `@stigmer/session-log` and reaches readers through `@stigmer/client`;
 * `ReactNode` is declared in `@types/react` and imported from `react`. A
 * reader installs the kit and its peer dependencies, so an import is only
 * ever from a peer, read from the kit's own `package.json`:
 *
 *   - a peer whose `exports` map has a pattern (`@stigmer/apis`'s `./*`)
 *     is imported from the subpath the declaring file matches
 *     (`dist/ai/stigmer/agentic/run/v1/api_pb.d.ts` →
 *     `@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb`);
 *   - otherwise from the first peer whose root exports the name, the
 *     declaring package (or the package its `@types/` package types) first.
 *
 * A peer's root export counts only when the checker says it is the declaring
 * package's own type, so an unrelated type of the same name in another peer
 * is never imported in its place.
 *
 * A type of the kit's own, a global, or one no peer exports has no import:
 * the docs snippet gate imports the kit's names from the page's entry, and
 * reports any other at its page and line, where the fix is the kit
 * exporting the type. A peer's root exports are read with the TypeScript
 * checker from the kit's own folder, as the gate reads an entry's.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import ts from "typescript";
import type { ExternalTarget } from "./typedoc-types";
import type { TypeImportResolver } from "./mdx-utils";

/** The package a type is declared in, as a reader would install it: `@types/react` → `react`. */
function installedName(packageName: string): string {
  if (!packageName.startsWith("@types/")) return packageName;
  const bare = packageName.slice("@types/".length);
  return bare.includes("__") ? `@${bare.replace("__", "/")}` : bare;
}

interface PackageJson {
  readonly name: string;
  readonly peerDependencies?: Readonly<Record<string, string>>;
  readonly exports?: unknown;
}

/** The nearest `node_modules/<name>` above a folder, as Node finds a package: its manifest and its real folder. */
function findPackage(fromDir: string, name: string): { manifest: PackageJson; dir: string } | null {
  for (let dir = fromDir; ; dir = path.dirname(dir)) {
    const file = path.join(dir, "node_modules", name, "package.json");
    if (fs.existsSync(file)) return { manifest: JSON.parse(fs.readFileSync(file, "utf8")) as PackageJson, dir: fs.realpathSync(path.dirname(file)) };
    if (path.dirname(dir) === dir) return null;
  }
}

/** The types file of an `exports` entry: the `types` condition, or the entry itself when it is a path. */
function typesTarget(entry: unknown): string | null {
  if (typeof entry === "string") return entry;
  if (typeof entry === "object" && entry !== null) {
    const conditions = entry as Record<string, unknown>;
    return typesTarget(conditions.types ?? conditions.import ?? conditions.default);
  }
  return null;
}

/**
 * The subpath of a package whose `exports` pattern holds a declaring file,
 * or null when no pattern matches: `dist/ai/x_pb.d.ts` under
 * `"./*": { "types": "./dist/*.d.ts" }` is `ai/x_pb`.
 *
 * TypeDoc gives the file relative to the nearest `package.json` above it,
 * and a library built for publishing has one in `dist/` too
 * (`scripts/publish-libs.mjs`), so the same file can arrive as
 * `ai/x_pb.d.ts`. The pattern's prefix may therefore be met from any of its
 * folders down, never from inside a folder name.
 */
export function patternSubpath(exportsMap: unknown, packagePath: string): string | null {
  if (typeof exportsMap !== "object" || exportsMap === null) return null;
  for (const [key, entry] of Object.entries(exportsMap)) {
    if (!key.includes("*")) continue;
    const target = typesTarget(entry);
    if (target === null || !target.includes("*")) continue;
    const [prefix, suffix] = target.replace(/^\.\//, "").split("*");
    if (!packagePath.endsWith(suffix)) continue;
    const stem = packagePath.slice(0, packagePath.length - suffix.length);
    const folders = prefix.split("/").filter((p) => p !== "");
    const roots = folders.map((_, i) => `${folders.slice(i).join("/")}/`).concat(prefix === "" || prefix.endsWith("/") ? [""] : []);
    // The wildcard names a file: never empty, never ending in a folder.
    const root = roots.find((r) => stem.startsWith(r) && stem.length > r.length && !stem.endsWith("/"));
    if (root === undefined) continue;
    return key.replace(/^\.\//, "").replaceAll("*", stem.slice(root.length));
  }
  return null;
}

/** Whether a package's `exports` map gives it a root entry (no map at all is a root too). */
function hasRoot(pkg: PackageJson): boolean {
  if (pkg.exports === undefined) return true;
  if (typeof pkg.exports === "string") return true;
  const map = pkg.exports as Record<string, unknown>;
  return "." in map || !Object.keys(map).some((k) => k.startsWith("."));
}

/**
 * What each peer's root exports, read once with the TypeScript checker from
 * the kit's folder: each name with the files its declarations are in.
 */
function readRootExports(kitDir: string, peers: readonly string[]): Map<string, Map<string, string[]>> {
  const options: ts.CompilerOptions = {
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX,
    allowImportingTsExtensions: true,
    noEmit: true,
    skipLibCheck: true,
    types: [],
  };
  const probe = path.join(kitDir, "__signature-imports__.ts");
  const text = peers.map((p, i) => `import * as p${i} from ${JSON.stringify(p)};\nexport { p${i} };`).join("\n");
  const host = ts.createCompilerHost(options, true);
  const getSourceFile = host.getSourceFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  host.getSourceFile = (fileName, version, onError, create) =>
    fileName === probe ? ts.createSourceFile(fileName, text, version, true) : getSourceFile(fileName, version, onError, create);
  host.fileExists = (fileName) => fileName === probe || fileExists(fileName);
  const program = ts.createProgram([probe], options, host);
  const checker = program.getTypeChecker();
  const result = new Map<string, Map<string, string[]>>();
  const sf = program.getSourceFile(probe);
  for (const stmt of sf?.statements ?? []) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    const symbol = checker.getSymbolAtLocation(stmt.moduleSpecifier);
    if (symbol === undefined) throw new Error(`cannot resolve the peer ${stmt.moduleSpecifier.text} from ${kitDir}: build the workspace's libraries first`);
    const names = new Map<string, string[]>();
    for (const exported of checker.getExportsOfModule(symbol)) {
      const declared = exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
      names.set(exported.name, (declared.declarations ?? []).map((d) => d.getSourceFile().fileName));
    }
    result.set(stmt.moduleSpecifier.text, names);
  }
  return result;
}

/**
 * The resolver for one kit, from its folder (where its `package.json` is).
 * Its peers' root exports are read on first use, once.
 */
export function createTypeImportResolver(kitDir: string): TypeImportResolver {
  const kit = JSON.parse(fs.readFileSync(path.join(kitDir, "package.json"), "utf8")) as PackageJson;
  const peers = Object.keys(kit.peerDependencies ?? {});
  const packages = new Map(
    peers.map((p) => {
      const found = findPackage(kitDir, p);
      if (found === null) throw new Error(`cannot find the package ${p} from ${kitDir}: install the workspace first`);
      return [p, found.manifest];
    }),
  );
  const rooted = peers.filter((p) => hasRoot(packages.get(p)!));
  let roots: Map<string, Map<string, string[]>> | undefined;

  return (name: string, target: ExternalTarget): string | null => {
    const declaring = installedName(target.packageName);
    if (declaring === kit.name || target.packageName === "typescript") return null;
    if (packages.has(declaring)) {
      const subpath = patternSubpath(packages.get(declaring)!.exports, target.packagePath);
      if (subpath !== null) return `${declaring}/${subpath}`;
    }
    const home = findPackage(kitDir, target.packageName)?.dir;
    if (home === undefined) return null;
    roots ??= readRootExports(kitDir, rooted);
    const order = packages.has(declaring) ? [declaring, ...rooted.filter((p) => p !== declaring)] : rooted;
    const isTheType = (p: string) => (roots!.get(p)?.get(name) ?? []).some((file) => file.startsWith(home + path.sep));
    return order.find(isTheType) ?? null;
  };
}
