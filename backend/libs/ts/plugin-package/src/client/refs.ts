/**
 * The two grammars a user types at any marketplace surface, and the words
 * every client uses for what they name.
 *
 * `install [marketplace/]name[@version]`: the plugin's name in its
 * marketplace, optionally qualified by the marketplace's name and pinned to
 * the version the entry's manifest must carry. Both names obey the plugin
 * name rule (`isValidPluginName`: lowercase letters, digits, `.` and `-`,
 * never `/` or `@`), which is what makes the grammar unambiguous: the first
 * `/` splits the marketplace off, the first `@` splits the version off, and
 * anything else is not a ref. A path (`./thermos`, `/tmp/x`, `..`) is the
 * one likely mistake and gets its own sentence, so a client can point at
 * the command that installs a folder.
 *
 * A GitHub marketplace source: `owner/repo[@ref]`, or the URL a browser
 * shows for that repository (`https://github.com/owner/repo[/tree/<ref>]`),
 * normalised to one record. Every vendor keeps its marketplace file at the
 * repository root, so a subdirectory grammar is not offered.
 *
 * Refusals are returned, not thrown: the CLI wraps one in its `UsageError`
 * and the console renders it, and the sentence is the same in both. A
 * client adds the second paragraph naming its own command.
 */

import { isValidPluginName } from "../detect.js";

/** The built-in marketplace's name: the prefix in `install stigmer/<plugin>`; reserved in every client. */
export const OFFICIAL_MARKETPLACE_NAME = "stigmer";

export interface InstallRef {
  /** The marketplace named before the `/`, or `undefined` when the name stands alone. */
  readonly marketplace?: string;
  readonly name: string;
  /** The version named after the `@`, asserted against the entry's manifest. */
  readonly version?: string;
}

export type InstallRefOutcome =
  | { readonly ok: true; readonly ref: InstallRef }
  | {
      readonly ok: false;
      /** `path` when the text names a folder rather than a plugin; `shape` for every other refusal. */
      readonly kind: "path" | "shape";
      readonly message: string;
    };

/** The characters a `@version` may carry: the plugin's tag pattern, so what a ref pins is a tag the server can hold. */
const VERSION_PATTERN = /^[a-zA-Z0-9._-]+$/;

/** The grammar in the user's terms, quoted by every refusal. */
export const INSTALL_REF_SHAPE =
  "[marketplace/]name[@version], for example 'thermos', 'cursor-plugins/thermos' or 'thermos@1.0.0'";

export function parseInstallRef(text: string): InstallRefOutcome {
  if (looksLikePath(text)) {
    return {
      ok: false,
      kind: "path",
      message: `'${text}' is a path, and 'install' takes a plugin's name in a marketplace`,
    };
  }
  let rest = text;
  let marketplace: string | undefined;
  const slash = rest.indexOf("/");
  if (slash !== -1) {
    marketplace = rest.slice(0, slash);
    rest = rest.slice(slash + 1);
    if (!isValidPluginName(marketplace)) {
      return { ok: false, kind: "shape", message: `'${marketplace}' is not a marketplace name` };
    }
  }
  let version: string | undefined;
  const at = rest.indexOf("@");
  if (at !== -1) {
    version = rest.slice(at + 1);
    rest = rest.slice(0, at);
    if (version === "" || !VERSION_PATTERN.test(version)) {
      return { ok: false, kind: "shape", message: `'${version}' is not a version` };
    }
  }
  if (!isValidPluginName(rest)) {
    return { ok: false, kind: "shape", message: `'${rest}' is not a plugin name` };
  }
  return {
    ok: true,
    ref: {
      ...(marketplace !== undefined && { marketplace }),
      name: rest,
      ...(version !== undefined && { version }),
    },
  };
}

/** The grammar's own text for a ref, the inverse of `parseInstallRef`. */
export function formatInstallRef(ref: InstallRef): string {
  const prefix = ref.marketplace === undefined ? "" : `${ref.marketplace}/`;
  const suffix = ref.version === undefined ? "" : `@${ref.version}`;
  return `${prefix}${ref.name}${suffix}`;
}

/** Whether `text` reads as a filesystem path on any platform (relative, home, absolute, Windows). */
export function looksLikePath(text: string): boolean {
  return (
    text === "." ||
    text === ".." ||
    text.startsWith("./") ||
    text.startsWith("../") ||
    text.startsWith("~") ||
    text.startsWith("/") ||
    text.includes("\\") ||
    /^[A-Za-z]:/.test(text)
  );
}

/** A public GitHub repository at a ref; the default branch when `ref` is absent. */
export interface GitHubMarketplaceSource {
  readonly type: "github";
  /** `owner/repo`. */
  readonly repo: string;
  /** Branch, tag or commit. */
  readonly ref?: string;
}

export type GitHubSourceOutcome =
  | { readonly ok: true; readonly source: GitHubMarketplaceSource }
  | { readonly ok: false; readonly message: string };

/** What a GitHub source may be typed as, quoted by every refusal. */
export const GITHUB_SOURCE_SHAPE =
  "a GitHub repository as 'owner/repo' or 'owner/repo@ref', or that repository's URL (https://github.com/owner/repo)";

const GITHUB_URL = /^https?:\/\/(?:www\.)?github\.com\/([^/\s]+)\/([^/\s#?]+?)(?:\.git)?(?:\/tree\/([^\s#?]+))?\/?$/;

/**
 * `owner/repo[@ref]` or a github.com URL as one source. The URL form is
 * tried first because it contains a `/` too; a text that is neither is
 * refused with the shape.
 */
export function parseGitHubSource(text: string): GitHubSourceOutcome {
  const url = GITHUB_URL.exec(text);
  if (url !== null) {
    const repo = `${url[1] ?? ""}/${url[2] ?? ""}`;
    if (!isOwnerRepo(repo)) {
      return { ok: false, message: `'${text}' does not name a GitHub repository` };
    }
    const ref = url[3];
    return { ok: true, source: { type: "github", repo, ...(ref !== undefined && ref !== "" && { ref }) } };
  }

  const at = text.indexOf("@");
  const repo = at === -1 ? text : text.slice(0, at);
  const ref = at === -1 ? undefined : text.slice(at + 1);
  if (isOwnerRepo(repo) && (ref === undefined || ref !== "")) {
    return { ok: true, source: { type: "github", repo, ...(ref !== undefined && { ref }) } };
  }
  return { ok: false, message: `'${text}' is not a GitHub 'owner/repo'` };
}

/** One phrase naming a GitHub source, for lists and sentences. */
export function describeGitHubSource(source: GitHubMarketplaceSource): string {
  return source.ref === undefined ? `github.com/${source.repo}` : `github.com/${source.repo}@${source.ref}`;
}

const OWNER_REPO_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** `owner/repo` as GitHub spells it: two segments, no `.git` suffix required or refused. */
export function isOwnerRepo(value: string): boolean {
  const parts = value.split("/");
  return parts.length === 2 && parts.every((part) => OWNER_REPO_SEGMENT.test(part) && part !== "." && part !== "..");
}
