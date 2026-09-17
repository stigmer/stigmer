// The two grammars a user types at the marketplace surface.
//
// `stigmer install [marketplace/]name[@version]`: the plugin's name in its
// marketplace, optionally qualified by the marketplace's name and pinned to
// the version the entry's manifest must carry. Both names obey the plugin
// name rule (`isValidPluginName`: lowercase letters, digits, `.` and `-`,
// never `/` or `@`), which is what makes the grammar unambiguous: the first
// `/` splits the marketplace off, the first `@` splits the version off, and
// anything else is not a ref. A path (`./thermos`, `/tmp/x`, `..`) is the
// one likely mistake, and it is refused toward `stigmer push plugin <dir>`,
// the command that installs a folder.
//
// `stigmer marketplace add <source>`: an existing directory, GitHub's
// `owner/repo[@ref]`, or the URL a browser shows for that repository
// (`https://github.com/owner/repo[/tree/<ref>]`), normalised to the same
// record. Every vendor keeps its marketplace file at the repository root, so
// a subdirectory grammar is not offered.

import { statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { isValidPluginName } from "@stigmer/plugin-package";
import { UsageError } from "../errors/index.js";
import { type MarketplaceSource, isOwnerRepo } from "./config.js";

export interface InstallRef {
  /** The marketplace named before the `/`, or `undefined` when the name stands alone. */
  readonly marketplace?: string;
  readonly name: string;
  /** The version named after the `@`, asserted against the entry's manifest. */
  readonly version?: string;
}

/** The characters a `@version` may carry: the plugin's tag pattern, so what a ref pins is a tag the server can hold. */
const VERSION_PATTERN = /^[a-zA-Z0-9._-]+$/;

const REF_SHAPE =
  "[marketplace/]name[@version], for example 'thermos', 'cursor-plugins/thermos' or 'thermos@1.0.0'";

export function parseInstallRef(text: string): InstallRef {
  if (looksLikePath(text)) {
    throw new UsageError(
      `'${text}' is a path, and 'install' takes a plugin's name in a marketplace\n\n` +
        `To install a plugin from a folder, run: stigmer push plugin ${text}`,
    );
  }
  let rest = text;
  let marketplace: string | undefined;
  const slash = rest.indexOf("/");
  if (slash !== -1) {
    marketplace = rest.slice(0, slash);
    rest = rest.slice(slash + 1);
    if (!isValidPluginName(marketplace)) {
      throw new UsageError(
        `'${marketplace}' is not a marketplace name\n\nA ref is ${REF_SHAPE}.`,
      );
    }
  }
  let version: string | undefined;
  const at = rest.indexOf("@");
  if (at !== -1) {
    version = rest.slice(at + 1);
    rest = rest.slice(0, at);
    if (version === "" || !VERSION_PATTERN.test(version)) {
      throw new UsageError(
        `'${version}' is not a version\n\nA ref is ${REF_SHAPE}.`,
      );
    }
  }
  if (!isValidPluginName(rest)) {
    throw new UsageError(
      `'${rest}' is not a plugin name\n\nA ref is ${REF_SHAPE}.`,
    );
  }
  return {
    ...(marketplace !== undefined && { marketplace }),
    name: rest,
    ...(version !== undefined && { version }),
  };
}

/** The grammar's own text for a ref, the inverse of `parseInstallRef`. */
export function formatInstallRef(ref: InstallRef): string {
  const prefix = ref.marketplace === undefined ? "" : `${ref.marketplace}/`;
  const suffix = ref.version === undefined ? "" : `@${ref.version}`;
  return `${prefix}${ref.name}${suffix}`;
}

function looksLikePath(text: string): boolean {
  return (
    text === "." ||
    text === ".." ||
    text.startsWith("./") ||
    text.startsWith("../") ||
    text.startsWith("~") ||
    text.includes("\\") ||
    isAbsolute(text)
  );
}

const GITHUB_URL =
  /^https?:\/\/(?:www\.)?github\.com\/([^/\s]+)\/([^/\s#?]+?)(?:\.git)?(?:\/tree\/([^\s#?]+))?\/?$/;

/**
 * What `marketplace add <source>` was given, as a source. An existing
 * directory wins over every other reading, so `add plugins` in a checkout
 * means the folder, not a GitHub owner; the `owner/repo` reading needs both
 * segments; a GitHub URL is unwrapped to the same record.
 */
export function parseAddSource(
  text: string,
  cwd: string = process.cwd(),
): Exclude<MarketplaceSource, { type: "official" }> {
  if (text === "")
    throw new UsageError(`a marketplace source is required\n\n${ADD_SHAPE}`);

  const asDirectory = resolve(cwd, text);
  if (isDirectory(asDirectory)) return { type: "local", path: asDirectory };

  const url = GITHUB_URL.exec(text);
  if (url !== null) {
    const repo = `${url[1]}/${url[2]}`;
    if (!isOwnerRepo(repo))
      throw new UsageError(
        `'${text}' does not name a GitHub repository\n\n${ADD_SHAPE}`,
      );
    const ref = url[3];
    return {
      type: "github",
      repo,
      ...(ref !== undefined && ref !== "" && { ref }),
    };
  }

  const at = text.indexOf("@");
  const repo = at === -1 ? text : text.slice(0, at);
  const ref = at === -1 ? undefined : text.slice(at + 1);
  if (isOwnerRepo(repo) && (ref === undefined || ref !== "")) {
    return { type: "github", repo, ...(ref !== undefined && { ref }) };
  }

  if (looksLikePath(text) || text.includes("/")) {
    throw new UsageError(
      `'${text}' is not a directory on this machine and not a GitHub 'owner/repo'\n\n${ADD_SHAPE}`,
    );
  }
  throw new UsageError(`'${text}' is not a marketplace source\n\n${ADD_SHAPE}`);
}

const ADD_SHAPE =
  "A source is a directory holding a marketplace file, a GitHub repository as 'owner/repo' or 'owner/repo@ref', " +
  "or that repository's URL (https://github.com/owner/repo).";

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
