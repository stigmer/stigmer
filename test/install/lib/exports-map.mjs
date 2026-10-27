/**
 * Reads a package's `exports` map the way Node's resolver does, for the
 * install smokes that check a tarball ships what its map names
 * (smoke-libs.mjs): every entry with every path it names under every
 * condition, and for a subpath pattern, which shipped files it covers and
 * what a consumer would import to reach one. Plain Node, pure, no imports,
 * as the install layer requires (test/README.md).
 *
 * A pattern's key carries one `*`; its target may carry several, and every
 * `*` in it stands for the same text (Node's "subpath patterns"), so a
 * target is matched as a whole, not split at its first `*`.
 */

/**
 * Each entry of an exports map with every path it names, under every
 * condition: `{ key: "./x", targets: ["./dist/x.d.ts", "./dist/x.js"] }`.
 * A string or array map is the "." entry.
 */
export function exportEntries(exportsField) {
  const map = typeof exportsField === "string" || Array.isArray(exportsField) ? { ".": exportsField } : exportsField ?? {};
  const targetsOf = (value) =>
    typeof value === "string" ? [value] : Array.isArray(value) ? value.flatMap(targetsOf) : value === null ? [] : Object.values(value).flatMap(targetsOf);
  return Object.entries(map).map(([key, value]) => ({ key, targets: [...new Set(targetsOf(value))] }));
}

function escape(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** What a target's `*` stands for in `file`, or undefined when the target does not cover it. */
export function patternMatch(target, file) {
  const parts = target.replace(/^\.\//, "").split("*");
  if (parts.length === 1) return undefined;
  const re = new RegExp(`^${parts.map(escape).reduce((pattern, part, index) => `${pattern}${index === 1 ? "(.+)" : "\\1"}${part}`)}$`);
  return re.exec(file)?.[1];
}

/** The shipped files a target names: itself, or for a pattern every file it covers. */
export function matchTarget(target, shipped) {
  const path = target.replace(/^\.\//, "");
  if (!path.includes("*")) return shipped.includes(path) ? [path] : [];
  return shipped.filter((file) => patternMatch(path, file) !== undefined);
}

/** The subpath a consumer imports to reach `file` through a pattern entry: its key with `*` filled in. */
export function subpathFor(key, target, file) {
  const stands = patternMatch(target, file);
  return stands === undefined ? undefined : key.replaceAll("*", stands);
}
