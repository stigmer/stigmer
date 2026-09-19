/**
 * `plugins/vendor.json`: where every vendored folder in the catalogue came
 * from, and what a person decided to keep out.
 *
 * One file holds three facts, because each is useless without the others
 * and a second home for any of them would drift. `sources` names the
 * vendor catalogues the audit reads and the commit each vendored folder
 * was copied at (the audit reads a source's default branch; the sync reads
 * the commit). `plugins` names each vendored folder and its path in the
 * source, one row per folder under `plugins/`. `struck` names the entries a
 * person removed from a set the audit would vendor, with the reason, so a
 * later sync from a later audit never quietly puts one back: a strike is a
 * decision, and decisions outlive the run that prompted them.
 *
 * The file is written by the sync tool from an audit's verdicts and read
 * by the audit (its source list), the sync (its work list) and the static
 * suite (the partition of the tree). It is edited by hand for exactly two
 * things: a strike, and a new source. Everything else in it is derived.
 *
 * Not in this file: anything about an authored plugin. An authored folder
 * has no provenance beyond this repository; the suite recognises one by
 * its manifest (`author.name` is Stigmer's), not by a row here.
 */

import { readFileSync, writeFileSync } from "node:fs";

import { comparePaths } from "@stigmer/plugin-package";

/** The pin file's name at the catalogue root. */
export const VENDOR_PINS_FILE = "vendor.json";

export interface VendorSourcePin {
  /** `owner/repo` on github.com. */
  readonly repo: string;
  /** The full commit SHA the vendored folders of this source were copied at. */
  readonly commit: string;
}

export interface VendorPluginRow {
  /** The folder under `plugins/`, and the name a user installs by. */
  readonly name: string;
  /** A key of `sources`. */
  readonly source: string;
  /** The folder's path inside the source repository, POSIX, no leading or trailing slash. */
  readonly path: string;
  /**
   * The licence file INSIDE the folder (`LICENSE`, `LICENSE.txt`), folder-relative.
   * A vendored copy carries its own permission; a folder whose only licence
   * is the repository's root file is not vendored, because the copy could
   * not carry the text that permits it.
   */
  readonly licence: string;
  /**
   * SHA-256 of the archive an install of the folder pushes, computed by the
   * sync over the copied bytes with the install's own preparation. The same
   * bytes in the vendor's repository yield the same digest, which is the
   * identity promise made checkable: the static suite recomputes it, so a
   * hand edit inside a vendored folder is a failing test, not a silent fork.
   */
  readonly digest: string;
}

export interface VendorStrike {
  readonly source: string;
  /** The entry's name in its source catalogue. */
  readonly name: string;
  /** Why a person kept it out; one sentence, for the report and the next reader. */
  readonly reason: string;
}

export interface VendorPins {
  /** Keyed by the marketplace name a user installs from (`cursor-plugins`), in listing order. */
  readonly sources: Readonly<Record<string, VendorSourcePin>>;
  readonly plugins: readonly VendorPluginRow[];
  readonly struck: readonly VendorStrike[];
}

/** A pin file with no sources, rows or strikes: what a catalogue that vendors nothing holds. */
export const EMPTY_VENDOR_PINS: VendorPins = { sources: {}, plugins: [], struck: [] };

/** Read and check the pin file at `path`; a malformed file is refused with the field that is wrong. */
export function readVendorPins(path: string): VendorPins {
  return parseVendorPins(readFileSync(path, "utf8"), path);
}

/** Write `pins` to `path` in the canonical rendering, so a no-op sync leaves no diff. */
export function writeVendorPins(path: string, pins: VendorPins): void {
  writeFileSync(path, renderVendorPins(pins));
}

/** The canonical rendering: rows and strikes sorted, two-space indent, one trailing newline. */
export function renderVendorPins(pins: VendorPins): string {
  const canonical: VendorPins = {
    sources: pins.sources,
    plugins: [...pins.plugins].sort((a, b) => comparePaths(a.name, b.name)),
    struck: [...pins.struck].sort((a, b) => comparePaths(`${a.source}/${a.name}`, `${b.source}/${b.name}`)),
  };
  return `${JSON.stringify(canonical, null, 2)}\n`;
}

/** Parse the pin file's text; exported for the suite, which reads fixtures as text. */
export function parseVendorPins(text: string, path: string): VendorPins {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error(`${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isRecord(value)) throw new Error(`${path} must be an object with 'sources', 'plugins' and 'struck'`);

  const sources = value["sources"];
  if (!isRecord(sources)) throw new Error(`${path}: 'sources' must be an object keyed by marketplace name`);
  const pinnedSources: Record<string, VendorSourcePin> = {};
  for (const [name, pin] of Object.entries(sources)) {
    if (!isRecord(pin) || typeof pin["repo"] !== "string" || typeof pin["commit"] !== "string") {
      throw new Error(`${path}: source '${name}' must carry a 'repo' and a 'commit'`);
    }
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(pin["repo"])) throw new Error(`${path}: source '${name}' has a repo that is not 'owner/repo': '${pin["repo"]}'`);
    if (!/^[0-9a-f]{40}$/.test(pin["commit"])) throw new Error(`${path}: source '${name}' has a commit that is not a full SHA: '${pin["commit"]}'`);
    pinnedSources[name] = { repo: pin["repo"], commit: pin["commit"] };
  }

  const plugins = value["plugins"];
  if (!Array.isArray(plugins)) throw new Error(`${path}: 'plugins' must be a list`);
  const rows: VendorPluginRow[] = plugins.map((row, index) => {
    if (
      !isRecord(row) ||
      typeof row["name"] !== "string" ||
      typeof row["source"] !== "string" ||
      typeof row["path"] !== "string" ||
      typeof row["licence"] !== "string" ||
      typeof row["digest"] !== "string"
    ) {
      throw new Error(`${path}: plugins[${index}] must carry 'name', 'source', 'path', 'licence' and 'digest'`);
    }
    if (pinnedSources[row["source"]] === undefined) throw new Error(`${path}: plugin '${row["name"]}' names source '${row["source"]}', which 'sources' does not carry`);
    if (!isPlainRelativePath(row["path"])) throw new Error(`${path}: plugin '${row["name"]}' has a path that is not a plain relative directory: '${row["path"]}'`);
    if (!isPlainRelativePath(row["licence"])) throw new Error(`${path}: plugin '${row["name"]}' has a licence path that is not folder-relative: '${row["licence"]}'`);
    if (!/^[0-9a-f]{64}$/.test(row["digest"])) throw new Error(`${path}: plugin '${row["name"]}' has a digest that is not a SHA-256 hex: '${row["digest"]}'`);
    return { name: row["name"], source: row["source"], path: row["path"], licence: row["licence"], digest: row["digest"] };
  });
  const names = new Set<string>();
  for (const row of rows) {
    if (names.has(row.name)) throw new Error(`${path}: plugin '${row.name}' is listed twice`);
    names.add(row.name);
  }

  const struck = value["struck"];
  if (!Array.isArray(struck)) throw new Error(`${path}: 'struck' must be a list`);
  const strikes: VendorStrike[] = struck.map((strike, index) => {
    if (!isRecord(strike) || typeof strike["source"] !== "string" || typeof strike["name"] !== "string" || typeof strike["reason"] !== "string") {
      throw new Error(`${path}: struck[${index}] must carry 'source', 'name' and 'reason'`);
    }
    if (strike["reason"].trim() === "") throw new Error(`${path}: struck '${strike["source"]}/${strike["name"]}' has no reason; a strike without one cannot be revisited`);
    return { source: strike["source"], name: strike["name"], reason: strike["reason"] };
  });

  return { sources: pinnedSources, plugins: rows, struck: strikes };
}

/** Whether `source/name` is struck. */
export function isStruck(pins: VendorPins, source: string, name: string): boolean {
  return pins.struck.some((strike) => strike.source === source && strike.name === name);
}

/** A non-empty POSIX path with no leading or trailing slash and no `..` segment. */
function isPlainRelativePath(value: string): boolean {
  return value !== "" && !value.startsWith("/") && !value.endsWith("/") && !value.split("/").includes("..");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
