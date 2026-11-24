/**
 * No two neighbours in the docs sidebar share a name.
 *
 * An explanation page and the folder of guides listed right under it once
 * carried the same title, so the sidebar read "Environments", "Plugins",
 * "Channels" and "Routines" twice in a row and nothing said which entry was
 * which (#3457); each such topic is now one folder whose `index.mdx` is the
 * explanation. `repeatedSidebarLabels` walks the tree the sidebar is built from,
 * from the root `meta.json` down through every folder's, and returns each
 * label two neighbours share.
 *
 * Neighbours are the entries of one group at the top level (what sits between
 * two `---Group---` separators) and the entries of one folder below it. An
 * entry's label is what the sidebar prints for it: a page's frontmatter title,
 * a folder's `meta.json` title or, with none, its `index.mdx` title (the docs
 * framework names a folder from its index page the same way), a link entry's
 * own text.
 *
 * The walk reads the entry forms the docs use: a separator, a link, a page,
 * and a folder with a `meta.json` that lists its `pages`. It throws, naming
 * the file, on anything else (a folder with no `pages` list, a rest entry
 * such as `...`), so a new form is taught here when the docs first use it and
 * is never guessed at.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import matter from "gray-matter";
import { isLinkEntry, isSeparator, separatorLabel, type SectionMeta } from "./llms-pages";

export interface RepeatedSidebarLabel {
  /** The label the neighbours share. */
  label: string;
  /** Where they sit: the `meta.json` that lists them, and at the top level its group. */
  where: string;
  /** The entries that carry the label, as that `meta.json` writes them. */
  entries: string[];
}

/** One run of neighbours: each label, with the entries that carry it. */
type Neighbours = Map<string, string[]>;

/** `value` as the label `file` gives, or a refusal that names the file. */
function titleOf(value: unknown, file: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`docs/${file}: no title, so its sidebar entry has no label to check`);
  return value.trim();
}

/** A folder's label: its `meta.json` title, else its index page's, else a refusal naming the folder. */
function folderLabel(docsDir: string, folder: string, meta: SectionMeta): string {
  if (meta.title !== undefined) return titleOf(meta.title, join(folder, "meta.json"));
  const index = join(folder, "index.mdx");
  if (existsSync(join(docsDir, index))) return titleOf(matter(readFileSync(join(docsDir, index), "utf8")).data.title, index);
  throw new Error(`docs/${folder}: no title in its meta.json and no index.mdx, so its sidebar entry has no label to check`);
}

function repeatsIn(neighbours: Neighbours, where: string): RepeatedSidebarLabel[] {
  return [...neighbours].filter(([, entries]) => entries.length > 1).map(([label, entries]) => ({ label, where, entries }));
}

/** The folder's `meta.json`, with the `pages` list the walk reads its order from. */
function readMeta(docsDir: string, dir: string): SectionMeta & { pages: string[] } {
  const metaFile = join(dir, "meta.json");
  const meta = JSON.parse(readFileSync(join(docsDir, metaFile), "utf8")) as SectionMeta;
  if (!Array.isArray(meta.pages)) throw new Error(`docs/${metaFile}: no "pages" list, which is where the sidebar's order is read from`);
  return { ...meta, pages: meta.pages };
}

function walk(docsDir: string, dir: string, meta: SectionMeta & { pages: string[] }): RepeatedSidebarLabel[] {
  const metaFile = join(dir, "meta.json");
  const top = dir === "";
  const repeated: RepeatedSidebarLabel[] = [];
  const below: RepeatedSidebarLabel[] = [];
  let neighbours: Neighbours = new Map();
  let where = `docs/${metaFile}`;
  const add = (label: string, entry: string): void => {
    neighbours.set(label, [...(neighbours.get(label) ?? []), entry]);
  };

  for (const entry of meta.pages) {
    if (isSeparator(entry)) {
      // Only the top level's separators start a new run of neighbours: a
      // folder's are headings inside one short list.
      if (!top) continue;
      repeated.push(...repeatsIn(neighbours, where));
      neighbours = new Map();
      where = `docs/${metaFile}, group "${separatorLabel(entry)}"`;
      continue;
    }
    if (isLinkEntry(entry)) {
      add(entry.slice(entry.lastIndexOf("[") + 1, entry.lastIndexOf("](")).trim(), entry);
      continue;
    }
    const page = join(dir, `${entry}.mdx`);
    const folder = join(dir, entry);
    const isPage = existsSync(join(docsDir, page));
    const isFolder = existsSync(join(docsDir, folder, "meta.json"));
    if (isPage === isFolder) {
      throw new Error(`docs/${metaFile}: the entry "${entry}" is not one page or one folder with a meta.json, the forms the sidebar check reads`);
    }
    if (isPage) {
      add(titleOf(matter(readFileSync(join(docsDir, page), "utf8")).data.title, page), entry);
      continue;
    }
    const folderMeta = readMeta(docsDir, folder);
    add(folderLabel(docsDir, folder, folderMeta), entry);
    below.push(...walk(docsDir, folder, folderMeta));
  }
  return [...repeated, ...repeatsIn(neighbours, where), ...below];
}

/**
 * Every label two neighbouring sidebar entries share, in the tree under
 * `docsDir`; empty when every neighbour reads differently.
 */
export function repeatedSidebarLabels(docsDir: string): RepeatedSidebarLabel[] {
  return walk(docsDir, "", readMeta(docsDir, ""));
}
