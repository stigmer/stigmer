"use client";

/**
 * The marketplaces this browser knows: the official one, built in, and the
 * GitHub sources the user added, remembered in `localStorage`.
 *
 * A marketplace is client-side configuration, never a server resource (the
 * server only ever sees the archive a client pushes), so the console keeps
 * the list where the CLI keeps its own: per machine, per user, here under
 * one versioned key in the CLI's entry shape. The official marketplace is
 * always first and cannot be added, replaced or removed, exactly as the
 * CLI reserves the name `stigmer`. An entry this version cannot read is
 * dropped from the known list and named with its reason, never silently.
 */

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { isValidPluginName } from "@stigmer/plugin-package";
import {
  type GitHubSourceOutcome,
  OFFICIAL_MARKETPLACE_NAME,
  isOwnerRepo,
  parseGitHubSource,
} from "@stigmer/plugin-package/client";

import type { KnownMarketplace, MarketplaceSource } from "./sources/types.js";

export { OFFICIAL_MARKETPLACE_NAME };

/** The storage key; the version suffix changes when the entry shape does. */
export const MARKETPLACES_STORAGE_KEY = "stigmer:plugins:marketplaces:v1";

/** The built-in marketplace, listed first everywhere. */
export const OFFICIAL_MARKETPLACE: KnownMarketplace = {
  name: OFFICIAL_MARKETPLACE_NAME,
  source: { type: "official" },
};

/** A remembered entry this browser cannot read; listed with its reason so the user can remove it. */
export interface UnreadableMarketplace {
  readonly name: string;
  readonly reason: string;
}

/** Return value of {@link useMarketplaces}. */
export interface UseMarketplacesReturn {
  /** The official marketplace first, then the remembered ones in the order they were added. */
  readonly marketplaces: readonly KnownMarketplace[];
  readonly unreadable: readonly UnreadableMarketplace[];
  /**
   * Remember a GitHub source under `name`. Returns the sentence refusing it
   * (a reserved or taken name, a text that is not a GitHub source) or
   * `null` when it was added.
   */
  readonly add: (name: string, sourceText: string) => string | null;
  /** Forget the marketplace called `name`; the official one refuses. Returns the refusal or `null`. */
  readonly remove: (name: string) => string | null;
  /** Parse a source the user typed without adding it, for live validation in a form. */
  readonly parseSource: (sourceText: string) => GitHubSourceOutcome;
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
    // Private browsing or a disabled store: the official marketplace alone.
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
 * The marketplaces this browser knows, with add and remove.
 *
 * Reads through `useSyncExternalStore`, so every mounted consumer sees an
 * add or remove at once, and a change from another tab arrives through
 * the `storage` event.
 *
 * @example
 * ```tsx
 * const { marketplaces, add, remove } = useMarketplaces();
 * const refusal = add("cursor-plugins", "cursor/plugins");
 * if (refusal) toast.error(refusal);
 * ```
 */
export function useMarketplaces(): UseMarketplacesReturn {
  const raw = useSyncExternalStore(subscribe, readRaw, () => "");

  const { marketplaces, unreadable } = useMemo(() => {
    const known: KnownMarketplace[] = [OFFICIAL_MARKETPLACE];
    const broken: UnreadableMarketplace[] = [];
    for (const [name, entry] of Object.entries(parseRaw(raw))) {
      if (name === OFFICIAL_MARKETPLACE_NAME) continue;
      const narrowed = narrowStoredEntry(entry);
      if (narrowed.ok) known.push({ name, source: narrowed.source });
      else broken.push({ name, reason: narrowed.reason });
    }
    return { marketplaces: known, unreadable: broken };
  }, [raw]);

  const add = useCallback((name: string, sourceText: string): string | null => {
    if (name === OFFICIAL_MARKETPLACE_NAME) {
      return `'${OFFICIAL_MARKETPLACE_NAME}' is the built-in marketplace and cannot be added or replaced; choose another name`;
    }
    if (!isValidPluginName(name)) {
      return `'${name}' is not a marketplace name; use lowercase letters, digits, '.' and '-'`;
    }
    const parsed = parseGitHubSource(sourceText.trim());
    if (!parsed.ok) return parsed.message;
    const entries = parseRaw(readRaw());
    if (entries[name] !== undefined) {
      return `a marketplace named '${name}' is already configured; remove it first or choose another name`;
    }
    writeEntries({ ...entries, [name]: parsed.source });
    return null;
  }, []);

  const remove = useCallback((name: string): string | null => {
    if (name === OFFICIAL_MARKETPLACE_NAME) {
      return `'${OFFICIAL_MARKETPLACE_NAME}' is the built-in marketplace and cannot be removed`;
    }
    const entries = parseRaw(readRaw());
    if (entries[name] === undefined) return `no marketplace named '${name}' is configured`;
    const { [name]: _removed, ...rest } = entries;
    writeEntries(rest);
    return null;
  }, []);

  const parseSource = useCallback((sourceText: string) => parseGitHubSource(sourceText.trim()), []);

  return useMemo(
    () => ({ marketplaces, unreadable, add, remove, parseSource }),
    [marketplaces, unreadable, add, remove, parseSource],
  );
}
