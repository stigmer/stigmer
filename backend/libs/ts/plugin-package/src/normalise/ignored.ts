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
 * `agents/` joins the list only when no vendor manifest is present: the
 * open format defines no sub-agent component, so a root-manifest-only
 * plugin with an `agents/` folder is told the folder is not read rather
 * than having semantics assigned to it. `README`, `CHANGELOG`, `LICENSE`
 * and dotfiles are not components and pass silently.
 */

import type { PluginFileIndex } from "../files.js";
import type { IgnoredComponent, IgnoredComponentKind } from "../types.js";

const IGNORED_DIRECTORIES: Readonly<Record<string, IgnoredComponentKind>> = {
  rules: "rules",
  hooks: "hooks",
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

export function ignoredOnDisk(index: PluginFileIndex, readsAgents: boolean): readonly IgnoredComponent[] {
  const ignored: IgnoredComponent[] = [];
  for (const dir of index.childDirectories("")) {
    const kind = IGNORED_DIRECTORIES[dir];
    if (kind !== undefined) ignored.push({ kind, path: `${dir}/` });
    if (dir === "agents" && !readsAgents) ignored.push({ kind: "agents", path: `${dir}/` });
  }
  for (const file of index.childFiles("")) {
    const kind = IGNORED_FILES[file];
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
