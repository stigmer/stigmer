/**
 * The components Stigmer reads past, found on disk.
 *
 * Every dialect ships things that configure the IDE rather than describe
 * knowledge or tools: rules, hooks, slash commands, canvases, output styles,
 * themes, monitors, LSP servers, Codex apps, bundled binaries, a settings
 * file, a logo. Stigmer installs none of them, and says so once per
 * component (a directory or a file, never per file inside), so an author
 * knows what an install leaves behind. Manifest fields that name the same
 * components are recorded by the dialect readers; the two lists are merged
 * and deduplicated by kind and path in `read-plugin-package.ts`.
 *
 * `agents/` and `hooks/` join the list only when no vendor manifest is
 * present: the open format defines neither component, so a
 * root-manifest-only plugin with such a folder is told it is not read
 * rather than having semantics assigned to it. `settings.json` is read
 * for a Claude plugin (`normalise/settings.ts`) and ignored otherwise. `README`, `CHANGELOG`, `LICENSE`
 * and dotfiles are not components and pass silently.
 */

import type { PluginFileIndex } from "../files.js";
import type { IgnoredComponent, IgnoredComponentKind } from "../types.js";

const IGNORED_DIRECTORIES: Readonly<Record<string, IgnoredComponentKind>> = {
  rules: "rules",
  commands: "commands",
  canvases: "canvases",
  workflows: "workflows",
  "output-styles": "output-styles",
  themes: "themes",
  monitors: "monitors",
  bin: "bin",
  assets: "assets",
  evals: "evals",
};

const IGNORED_FILES: Readonly<Record<string, IgnoredComponentKind>> = {
  ".lsp.json": "lsp-servers",
  "settings.json": "settings",
  ".app.json": "apps",
};

/**
 * `readsVendorComponents`: a vendor manifest is present, so `agents/` and
 * `hooks/` are read. `readsSettings`: a Claude manifest is present, so
 * `settings.json` is read.
 */
export function ignoredOnDisk(index: PluginFileIndex, readsVendorComponents: boolean, readsSettings: boolean): readonly IgnoredComponent[] {
  const ignored: IgnoredComponent[] = [];
  for (const dir of index.childDirectories("")) {
    const kind = IGNORED_DIRECTORIES[dir];
    if (kind !== undefined) ignored.push({ kind, path: `${dir}/` });
    if (dir === "agents" && !readsVendorComponents) ignored.push({ kind: "agents", path: `${dir}/` });
    if (dir === "hooks" && !readsVendorComponents) ignored.push({ kind: "hooks", path: `${dir}/` });
  }
  for (const file of index.childFiles("")) {
    const kind = IGNORED_FILES[file];
    if (kind === "settings" && readsSettings) continue;
    if (kind !== undefined) ignored.push({ kind, path: file });
  }
  return ignored;
}

/** One entry per (kind, path), in first-seen order. */
export function dedupeIgnored(lists: readonly (readonly IgnoredComponent[])[]): readonly IgnoredComponent[] {
  const seen = new Set<string>();
  const out: IgnoredComponent[] = [];
  for (const list of lists) {
    for (const component of list) {
      const key = `${component.kind}\u0000${component.path}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(component);
    }
  }
  return out;
}
