/**
 * What a storefront shows for a plugin before anyone installs it: a display
 * name, a logo, an author, a version, a description, a category.
 *
 * This is a read apart from `readPluginPackage` on purpose. The full read
 * decides what Stigmer INSTALLS and refuses what it cannot; a card must
 * render for every entry a catalogue lists, refused or not, and must cost
 * one manifest, not the plugin's whole tree. So this reader opens only the
 * manifests present, takes what they say about appearance, and never
 * reports a finding: an unreadable manifest contributes nothing, a wrong
 * type is treated as absent, and the caller draws a fallback face.
 *
 * Which manifest speaks is the full reader's rule (`MANIFEST_PRECEDENCE`:
 * the root manifest, then Claude, Cursor, Codex), so a plugin shipping two
 * dialects is named the same way on a card and in an install. Identity
 * fields (`name`, `version`, `description`, `author`) come from the first
 * manifest that carries each; the presentation fields come from the
 * dialects that define them: Cursor's top-level `displayName`, `logo` and
 * `category`; the legacy Codex manifest's `interface.displayName`,
 * `interface.logo` and `interface.category`. Claude Code's manifest and the
 * open format define none, and a logo rule for the `ai.stigmer` extension
 * namespace waits for the first official plugin that needs one.
 *
 * A logo is a path inside the plugin, and the card that shows it fetches it
 * by URL from wherever the tree lives. So the path is kept only when it is
 * contained, names an image by extension, is LISTED in the tree, and its
 * declared size is under `PLUGIN_DOCUMENT_LIMITS.logo`; the library's rule
 * that a cap is checked from declared sizes before a byte moves holds here
 * too. Both spellings the vendors use (`assets/logo.png`, `./assets/logo.png`)
 * are accepted, as the marketplace reader accepts both for a source.
 *
 * `logo` stays an ignored component in the full read: nothing in an
 * Organization carries the image after an install, and the preview's "Not
 * installed" line is true until the stored plugin does.
 */

import { MANIFEST_PRECEDENCE } from "./detect.js";
import { decodeUtf8, isContainedPath, PLUGIN_DOCUMENT_LIMITS, PluginFileIndex, type PluginFiles } from "./files.js";
import { isJsonObject, type JsonObject } from "./documents.js";
import { MANIFEST_LOCATIONS } from "./messages.js";
import type { PluginAuthor, PluginDialect } from "./types.js";

/** What a card shows for a plugin; every field optional, because every dialect may omit it. */
export interface PluginPresentation {
  /** The name for people (`Thermos`); the install name stays `name`. */
  readonly displayName?: string;
  /** A plugin-relative path to an image the tree lists, verified as described in the module header. */
  readonly logo?: string;
  readonly author?: PluginAuthor;
  readonly version?: string;
  readonly description?: string;
  /** The catalogue's own grouping word (`developer-tools`, `Productivity`), as written. */
  readonly category?: string;
}

/** The image extensions a browser renders in an `<img>`; a logo named otherwise is not shown. */
const LOGO_EXTENSIONS: ReadonlySet<string> = new Set(["png", "svg", "jpg", "jpeg", "webp", "gif"]);

/** The appearance fields of every manifest present, merged in precedence order. */
export function readPluginPresentation(files: PluginFiles): PluginPresentation {
  const index = new PluginFileIndex(files);
  const presentation: { -readonly [K in keyof PluginPresentation]: PluginPresentation[K] } = {};

  for (const dialect of MANIFEST_PRECEDENCE) {
    const object = readManifest(index, MANIFEST_LOCATIONS[dialect]);
    if (object === undefined) continue;
    const contribution = contributionOf(dialect, object, index);
    for (const key of Object.keys(contribution) as (keyof PluginPresentation)[]) {
      if (presentation[key] === undefined) Object.assign(presentation, { [key]: contribution[key] });
    }
  }

  return presentation;
}

/** The manifest at `path` as an object, or `undefined` for anything a card should not stumble on. */
function readManifest(index: PluginFileIndex, path: string): JsonObject | undefined {
  const entry = index.entry(path);
  if (entry === undefined || entry.size > PLUGIN_DOCUMENT_LIMITS.manifest) return undefined;
  let bytes: Uint8Array;
  try {
    bytes = index.files.read(path);
  } catch {
    return undefined;
  }
  if (bytes.length > PLUGIN_DOCUMENT_LIMITS.manifest) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(decodeUtf8(bytes));
  } catch {
    return undefined;
  }
  return isJsonObject(value) ? value : undefined;
}

function contributionOf(dialect: PluginDialect, object: JsonObject, index: PluginFileIndex): PluginPresentation {
  const identity = identityOf(object);
  switch (dialect) {
    case "cursor":
      return { ...identity, ...appearanceOf(object, index) };
    case "codex": {
      const surface = object["interface"];
      return isJsonObject(surface) ? { ...identity, ...appearanceOf(surface, index) } : identity;
    }
    case "agent-plugins":
    case "claude":
      return identity;
    default: {
      const exhaustive: never = dialect;
      return exhaustive;
    }
  }
}

/** The identity fields every dialect shares, typed loosely: a wrong type is absent, never a finding. */
function identityOf(object: JsonObject): PluginPresentation {
  const author = authorOf(object["author"]);
  return {
    ...optional("version", object["version"]),
    ...optional("description", object["description"]),
    ...(author !== undefined && { author }),
  };
}

/** `displayName`, `logo` and `category` from an object that carries them at its top level (a Cursor manifest, a Codex `interface`). */
function appearanceOf(object: JsonObject, index: PluginFileIndex): PluginPresentation {
  const logo = logoPath(object["logo"], index);
  return {
    ...optional("displayName", object["displayName"]),
    ...optional("category", object["category"]),
    ...(logo !== undefined && { logo }),
  };
}

function authorOf(value: unknown): PluginAuthor | undefined {
  if (!isJsonObject(value)) return undefined;
  const author: { -readonly [K in keyof PluginAuthor]: PluginAuthor[K] } = {
    ...optional("name", value["name"]),
    ...optional("email", value["email"]),
    ...optional("url", value["url"]),
  };
  return Object.keys(author).length === 0 ? undefined : author;
}

/**
 * A declared logo as a plugin-relative path the tree lists, or nothing.
 * `./` is stripped (Codex's spelling); an absolute path, a `..` segment, a
 * URL, a non-image extension, an unlisted file or an over-cap file all
 * mean "no logo", never a refusal.
 */
function logoPath(value: unknown, index: PluginFileIndex): string | undefined {
  if (typeof value !== "string") return undefined;
  const path = value.startsWith("./") ? value.slice(2) : value;
  if (!isContainedPath(path)) return undefined;
  const dot = path.lastIndexOf(".");
  if (dot === -1 || !LOGO_EXTENSIONS.has(path.slice(dot + 1).toLowerCase())) return undefined;
  const entry = index.entry(path);
  if (entry === undefined || entry.size > PLUGIN_DOCUMENT_LIMITS.logo) return undefined;
  return path;
}

/** `{ [key]: value }` when `value` is a non-empty string; `{}` otherwise. */
function optional<K extends string>(key: K, value: unknown): Partial<Record<K, string>> {
  return typeof value === "string" && value !== "" ? ({ [key]: value } as Record<K, string>) : {};
}
