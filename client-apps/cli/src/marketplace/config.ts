// The sources a CLI knows: the built-in ones (the official catalogue and the
// three vendors' public ones, the same list the console ships), and the ones
// a user added under the `marketplaces` key of ~/.stigmer/config.yaml.
//
// A source is client-side configuration, never a server resource: the
// server only ever sees the plugin archive a client pushes. That is why the
// list lives beside the named backends and the context, and why `stigmer
// marketplace` is a noun group like `config` and `auth`. The built-ins are
// code, not config: they cannot be added over or removed, so `stigmer
// install cursor-plugins/thermos` works on a fresh machine and the CLI's
// list never drifts from the console's.
//
// The config module keeps the on-disk entry loose (`MarketplaceEntryConfig`,
// every field optional) so a hand-edited entry this CLI cannot read survives
// the next save; this module is where the entry is narrowed into a
// `MarketplaceSource` the fetchers act on, and where an unreadable entry
// becomes a reason `stigmer marketplace list` prints instead of a silent gap.

import {
  type Config,
  type MarketplaceEntryConfig,
  load as loadConfig,
  save as saveConfig,
} from "../config/index.js";
import {
  type GitHubMarketplaceSource,
  BUILT_IN_MARKETPLACES,
  OFFICIAL_MARKETPLACE_NAME,
  builtInSourceRefusal,
  describeGitHubSource,
  isBuiltInMarketplaceName,
  isOwnerRepo,
} from "@stigmer/plugin-package/client";
import { UsageError } from "../errors/index.js";
import { isStandalone } from "../runtime.js";

export { OFFICIAL_MARKETPLACE_NAME, isOwnerRepo };

/** Where a marketplace tree comes from. Every source yields a directory. */
export type MarketplaceSource =
  /** The catalogue this CLI ships with: the repo tree in dev, `@stigmer/plugins` otherwise. */
  | { readonly type: "official" }
  /** A public GitHub repository, fetched as a zipball of `ref` (the default branch when absent); the console reads the same record. */
  | GitHubMarketplaceSource
  /** A directory on this machine, stored absolute. */
  | { readonly type: "local"; readonly path: string };

/** A marketplace the CLI can act on. */
export interface KnownMarketplace {
  readonly name: string;
  readonly source: MarketplaceSource;
}

/** A configured entry this CLI cannot read; listed with its reason, never dropped. */
export interface UnreadableMarketplace {
  readonly name: string;
  readonly reason: string;
}

export interface MarketplaceListing {
  /** The official marketplace first, then the config's entries in file order. */
  readonly known: readonly KnownMarketplace[];
  readonly unreadable: readonly UnreadableMarketplace[];
}

export const OFFICIAL_MARKETPLACE: KnownMarketplace = {
  name: OFFICIAL_MARKETPLACE_NAME,
  source: { type: "official" },
};

/** The sources every CLI ships with, in listing order; the official one is first. */
export const BUILT_IN_SOURCES: readonly KnownMarketplace[] =
  BUILT_IN_MARKETPLACES.map((entry) => ({
    name: entry.name,
    source: entry.source,
  }));

/** Every source the CLI knows: the built-ins first, then the config's entries in file order. */
export function listMarketplaces(
  config: Config = loadConfig(),
): MarketplaceListing {
  const known: KnownMarketplace[] = [...BUILT_IN_SOURCES];
  const unreadable: UnreadableMarketplace[] = [];
  for (const [name, entry] of Object.entries(config.marketplaces ?? {})) {
    // A config written before the vendors were built in may name one; the
    // built-in wins and the entry is left in the file untouched.
    if (isBuiltInMarketplaceName(name)) continue;
    const narrowed = narrowEntry(entry);
    if (narrowed.ok) known.push({ name, source: narrowed.source });
    else unreadable.push({ name, reason: narrowed.reason });
  }
  return { known, unreadable };
}

/** The marketplace called `name`, or `undefined`; an unreadable entry refuses with its reason. */
export function findMarketplace(
  name: string,
  config: Config = loadConfig(),
): KnownMarketplace | undefined {
  const listing = listMarketplaces(config);
  const known = listing.known.find((marketplace) => marketplace.name === name);
  if (known !== undefined) return known;
  const broken = listing.unreadable.find(
    (marketplace) => marketplace.name === name,
  );
  if (broken !== undefined) {
    throw new UsageError(
      `marketplace '${name}' is configured but cannot be read: ${broken.reason}\n\n` +
        `Fix the entry under 'marketplaces.${name}' in the config file, or remove it with 'stigmer marketplace remove ${name}'.`,
    );
  }
  return undefined;
}

/**
 * Record a marketplace under `name` and save. Refuses the reserved name, a
 * name already taken, and a run under `--standalone` (the config file is
 * ignored there, so there is nothing to add to; saving would write a fresh
 * default file over the user's own).
 */
export function addMarketplace(
  name: string,
  source: Exclude<MarketplaceSource, { type: "official" }>,
): void {
  refuseStandalone("add");
  if (isBuiltInMarketplaceName(name)) {
    throw new UsageError(
      `${builtInSourceRefusal(name, "add")}\n\n` +
        "Pass --name <other-name> to add this source under a different name.",
    );
  }
  const config = loadConfig();
  if (config.marketplaces?.[name] !== undefined) {
    throw new UsageError(
      `a marketplace named '${name}' is already configured\n\n` +
        `Remove it first with 'stigmer marketplace remove ${name}', or pass --name <other-name>.`,
    );
  }
  saveConfig({
    ...config,
    marketplaces: { ...config.marketplaces, [name]: toEntry(source) },
  });
}

/** Remove the marketplace called `name` and save. Refuses the reserved name and an unknown one. */
export function removeMarketplace(name: string): void {
  refuseStandalone("remove");
  if (isBuiltInMarketplaceName(name)) {
    throw new UsageError(builtInSourceRefusal(name, "remove"));
  }
  const config = loadConfig();
  if (config.marketplaces?.[name] === undefined) {
    throw new UsageError(
      `no marketplace named '${name}' is configured\n\nRun 'stigmer marketplace list' to see the configured names.`,
    );
  }
  const { [name]: _removed, ...rest } = config.marketplaces;
  saveConfig({
    ...config,
    marketplaces: Object.keys(rest).length === 0 ? undefined : rest,
  });
}

function refuseStandalone(verb: string): void {
  if (isStandalone()) {
    throw new UsageError(
      `--standalone ignores the config file, so there is no marketplace list to ${verb} to\n\n` +
        "Run without --standalone to change the configured marketplaces.",
    );
  }
}

type NarrowedEntry =
  | { readonly ok: true; readonly source: MarketplaceSource }
  | { readonly ok: false; readonly reason: string };

/** The loose on-disk entry as a source, or the reason it is not one. */
export function narrowEntry(entry: MarketplaceEntryConfig): NarrowedEntry {
  switch (entry.type) {
    case "github": {
      if (typeof entry.repo !== "string" || !isOwnerRepo(entry.repo)) {
        return { ok: false, reason: "type 'github' needs 'repo: owner/repo'" };
      }
      if (
        entry.ref !== undefined &&
        (typeof entry.ref !== "string" || entry.ref === "")
      ) {
        return {
          ok: false,
          reason: "'ref' must be a non-empty branch, tag or commit",
        };
      }
      return {
        ok: true,
        source: {
          type: "github",
          repo: entry.repo,
          ...(entry.ref !== undefined && { ref: entry.ref }),
        },
      };
    }
    case "local": {
      if (typeof entry.path !== "string" || entry.path === "") {
        return { ok: false, reason: "type 'local' needs 'path: <directory>'" };
      }
      return { ok: true, source: { type: "local", path: entry.path } };
    }
    case undefined:
      return { ok: false, reason: "no 'type' (expected 'github' or 'local')" };
    default:
      return {
        ok: false,
        reason: `unknown type '${String(entry.type)}' (expected 'github' or 'local')`,
      };
  }
}

function toEntry(
  source: Exclude<MarketplaceSource, { type: "official" }>,
): MarketplaceEntryConfig {
  switch (source.type) {
    case "github":
      return {
        type: "github",
        repo: source.repo,
        ...(source.ref !== undefined && { ref: source.ref }),
      };
    case "local":
      return { type: "local", path: source.path };
    default: {
      const exhaustive: never = source;
      return exhaustive;
    }
  }
}

/** One sentence naming where a source comes from, for lists and sentences. */
export function describeSource(source: MarketplaceSource): string {
  switch (source.type) {
    case "official":
      return "built in";
    case "github":
      return describeGitHubSource(source);
    case "local":
      return source.path;
    default: {
      const exhaustive: never = source;
      return exhaustive;
    }
  }
}
