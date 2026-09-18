"use client";

/**
 * The sources this browser knows: the built-in ones, and the GitHub sources
 * the user added, remembered in `localStorage`.
 *
 * A source is client-side configuration, never a server resource (the
 * server only ever sees the archive a client pushes), so the console keeps
 * its list where the CLI keeps its own: per machine, per user, here under
 * one versioned key in the CLI's entry shape. The built-ins (the official
 * catalogue and the three vendors' public ones) are code shared with the
 * CLI, never stored, so the two clients list the same sources and a user
 * can neither add over nor remove one. An entry this version cannot read
 * is dropped from the known list and named with its reason, never silently.
 *
 * `add` reads the source before recording it, as `stigmer marketplace add`
 * does: a repository that is not a marketplace is refused with the
 * library's sentences, and the name defaults to the one the marketplace
 * file gives itself, so the form has one required field.
 */

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { isValidPluginName } from "@stigmer/plugin-package";
import {
  type GitHubMarketplaceSource,
  type GitHubSourceOutcome,
  BUILT_IN_MARKETPLACES,
  OFFICIAL_MARKETPLACE_NAME,
  builtInSourceRefusal,
  isBuiltInMarketplaceName,
  isOwnerRepo,
  parseGitHubSource,
} from "@stigmer/plugin-package/client";

import { openGitHubTree } from "./sources/github.js";
import { PluginReadRefusal, openMarketplace } from "./sources/read.js";
import type { FetchImpl, KnownMarketplace, MarketplaceSource } from "./sources/types.js";

export { OFFICIAL_MARKETPLACE_NAME };

/** The storage key; the version suffix changes when the entry shape does. */
export const MARKETPLACES_STORAGE_KEY = "stigmer:plugins:marketplaces:v1";

/** The sources every console ships with, in listing order: the CLI's list, in the console's type. */
export const BUILT_IN_SOURCES: readonly KnownMarketplace[] = BUILT_IN_MARKETPLACES.map((entry) => ({
  name: entry.name,
  source: entry.source,
}));

/** The official catalogue, listed first everywhere. */
export const OFFICIAL_MARKETPLACE: KnownMarketplace = BUILT_IN_SOURCES[0] ?? {
  name: OFFICIAL_MARKETPLACE_NAME,
  source: { type: "official" },
};

/** A remembered entry this browser cannot read; listed with its reason so the user can remove it. */
export interface UnreadableMarketplace {
  readonly name: string;
  readonly reason: string;
}

/** What `add` comes to: the source recorded under `name`, or the sentence refusing it. */
export type AddSourceOutcome = { readonly ok: true; readonly name: string } | { readonly ok: false; readonly message: string };

export interface UseMarketplacesOptions {
  /** The HTTP client `add` reads a source with; `globalThis.fetch` by default, a fake in tests. */
  readonly fetchImpl?: FetchImpl;
}

/** Return value of {@link useMarketplaces}. */
export interface UseMarketplacesReturn {
  /** The built-in sources first, then the remembered ones in the order they were added. */
  readonly marketplaces: readonly KnownMarketplace[];
  readonly unreadable: readonly UnreadableMarketplace[];
  /**
   * Read a GitHub source and remember it. The name is the marketplace
   * file's own unless `name` is given; a reserved or taken name, a text that
   * is not a GitHub source, and a repository that is not a marketplace are
   * refused with their sentences.
   */
  readonly add: (sourceText: string, name?: string) => Promise<AddSourceOutcome>;
  /** Forget the source called `name`; a built-in refuses. Returns the refusal or `null`. */
  readonly remove: (name: string) => string | null;
  /** Parse a source the user typed without adding it, for live validation in a form. */
  readonly parseSource: (sourceText: string) => GitHubSourceOutcome;
  /** Whether `name` is a source the user may neither add over nor remove. */
  readonly isBuiltIn: (name: string) => boolean;
}

type StoredEntries = Readonly<Record<string, unknown>>;

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === MARKETPLACES_STORAGE_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function readRaw(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(MARKETPLACES_STORAGE_KEY) ?? "";
  } catch {
    // Private browsing or a disabled store: the built-in sources alone.
    return "";
  }
}

function writeEntries(entries: StoredEntries): void {
  try {
    if (Object.keys(entries).length === 0) window.localStorage.removeItem(MARKETPLACES_STORAGE_KEY);
    else window.localStorage.setItem(MARKETPLACES_STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // The store refused the write; the in-memory list still notifies so the UI reflects the attempt's outcome.
  }
  for (const listener of listeners) listener();
}

function parseRaw(raw: string): StoredEntries {
  if (raw === "") return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as StoredEntries) : {};
  } catch {
    return {};
  }
}

type Narrowed = { readonly ok: true; readonly source: MarketplaceSource } | { readonly ok: false; readonly reason: string };

/** The loose stored entry as a source, or the reason it is not one (the CLI's `narrowEntry`). */
export function narrowStoredEntry(entry: unknown): Narrowed {
  if (typeof entry !== "object" || entry === null) return { ok: false, reason: "not an object" };
  const record = entry as Record<string, unknown>;
  switch (record["type"]) {
    case "github": {
      const repo = record["repo"];
      if (typeof repo !== "string" || !isOwnerRepo(repo)) return { ok: false, reason: "type 'github' needs 'repo: owner/repo'" };
      const ref = record["ref"];
      if (ref !== undefined && (typeof ref !== "string" || ref === "")) {
        return { ok: false, reason: "'ref' must be a non-empty branch, tag or commit" };
      }
      return { ok: true, source: { type: "github", repo, ...(typeof ref === "string" && { ref }) } };
    }
    case undefined:
      return { ok: false, reason: "no 'type' (expected 'github')" };
    default:
      return { ok: false, reason: `unknown type '${String(record["type"])}' (expected 'github')` };
  }
}

/**
 * Read a GitHub source once, for `add`: the marketplace's own name and how
 * many plugins it offers. Refusals are the source's or the library's
 * sentences, returned rather than thrown.
 */
async function readSourceForAdd(
  source: GitHubMarketplaceSource,
  fetchImpl: FetchImpl,
): Promise<{ readonly ok: true; readonly name: string } | { readonly ok: false; readonly message: string }> {
  try {
    const opened = await openMarketplace(await openGitHubTree(source, fetchImpl));
    return { ok: true, name: opened.marketplace.name };
  } catch (error) {
    if (error instanceof PluginReadRefusal) {
      return { ok: false, message: `${error.subject}: ${error.errors.map((finding) => finding.message).join("; ")}` };
    }
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * The sources this browser knows, with add and remove.
 *
 * Reads through `useSyncExternalStore`, so every mounted consumer sees an
 * add or remove at once, and a change from another tab arrives through
 * the `storage` event.
 *
 * @example
 * ```tsx
 * const { marketplaces, add, remove } = useMarketplaces();
 * const outcome = await add("acme/plugins");
 * if (!outcome.ok) toast.error(outcome.message);
 * ```
 */
export function useMarketplaces(options: UseMarketplacesOptions = {}): UseMarketplacesReturn {
  const raw = useSyncExternalStore(subscribe, readRaw, () => "");
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  const { marketplaces, unreadable } = useMemo(() => {
    const known: KnownMarketplace[] = [...BUILT_IN_SOURCES];
    const broken: UnreadableMarketplace[] = [];
    for (const [name, entry] of Object.entries(parseRaw(raw))) {
      // Remembered before a vendor was built in: the built-in wins, the entry stays.
      if (isBuiltInMarketplaceName(name)) continue;
      const narrowed = narrowStoredEntry(entry);
      if (narrowed.ok) known.push({ name, source: narrowed.source });
      else broken.push({ name, reason: narrowed.reason });
    }
    return { marketplaces: known, unreadable: broken };
  }, [raw]);

  const add = useCallback(
    async (sourceText: string, name?: string): Promise<AddSourceOutcome> => {
      const parsed = parseGitHubSource(sourceText.trim());
      if (!parsed.ok) return { ok: false, message: parsed.message };
      const read = await readSourceForAdd(parsed.source, fetchImpl);
      if (!read.ok) return read;
      const chosen = name === undefined || name.trim() === "" ? read.name : name.trim();
      if (isBuiltInMarketplaceName(chosen)) {
        return { ok: false, message: builtInSourceRefusal(chosen, "add") };
      }
      if (!isValidPluginName(chosen)) {
        return { ok: false, message: `'${chosen}' is not a source name; use lowercase letters, digits, '.' and '-'` };
      }
      const entries = parseRaw(readRaw());
      if (entries[chosen] !== undefined) {
        return { ok: false, message: `a source named '${chosen}' is already added; remove it first or choose another name` };
      }
      writeEntries({ ...entries, [chosen]: parsed.source });
      return { ok: true, name: chosen };
    },
    [fetchImpl],
  );

  const remove = useCallback((name: string): string | null => {
    if (isBuiltInMarketplaceName(name)) return builtInSourceRefusal(name, "remove");
    const entries = parseRaw(readRaw());
    if (entries[name] === undefined) return `no source named '${name}' is added`;
    const { [name]: _removed, ...rest } = entries;
    writeEntries(rest);
    return null;
  }, []);

  const parseSource = useCallback((sourceText: string) => parseGitHubSource(sourceText.trim()), []);

  return useMemo(
    () => ({ marketplaces, unreadable, add, remove, parseSource, isBuiltIn: isBuiltInMarketplaceName }),
    [marketplaces, unreadable, add, remove, parseSource],
  );
}
