/**
 * What each marketplace entry of a vendor's tree IS to Stigmer: read with
 * the product's own instrument, plus the two facts the product does not
 * keep and the rubric needs.
 *
 * The instrument is `preparePluginFromTree` from
 * `@stigmer/plugin-package/client`: the one chain the console and the CLI
 * install through (ignore rules and security defaults, then the reader,
 * then the archive and its digest). So "this plugin becomes two skills and
 * one server" here is exactly what an install of the entry would produce,
 * and a refusal here is the sentence an install would print. A plain walk
 * of the entry's directory would have been a second, slightly different
 * instrument, and the report would have described a plugin nobody installs.
 *
 * The two facts beyond the reader: the licence the folder or the repository
 * carries (`licence.ts`), and Cursor's `auth` block, which the reader drops
 * with `mcp-server-auth-ignored` because OAuth on Stigmer has its own home.
 * The block is the vendor's own statement of how a server authenticates,
 * so it is kept raw as a hint beside the probe's measurement. Locating it
 * is a heuristic over the entry's JSON documents (any `mcpServers` map whose
 * members carry `auth`), stated as such: the dialect keeps the map either
 * inline in the manifest or in a file the manifest names.
 */

import { readMarketplace, type MarketplaceFinding, type PluginFinding, type PluginVariable } from "@stigmer/plugin-package";
import { preparePluginFromTree } from "@stigmer/plugin-package/client";

import { asPluginFiles, type DirectoryListing, subtree } from "../lib/candidates.js";
import type { CheckedOutTree } from "../lib/git-tree.js";
import { classifyLicenceText, LICENCE_FILE_NAMES, type LicenceClass } from "./licence.js";
import type { AuditSource } from "./sources.js";

/** One MCP server as the entry declares it, in the shape the probe and the rubric read. */
export type EntryServer =
  | {
      readonly name: string;
      readonly transport: "http";
      readonly url: string;
      readonly headers: Readonly<Record<string, string>>;
      /** Variable names the server's headers reference (`McpServerSpec.env`). */
      readonly env: readonly string[];
      /** The vendor's own `auth` block, when the dialect carries one; the reader ignores it. */
      readonly vendorAuthHint?: unknown;
    }
  | {
      readonly name: string;
      readonly transport: "stdio";
      readonly command: string;
      readonly env: readonly string[];
    };

export interface LicenceFact {
  readonly licence: LicenceClass;
  /** Where the text came from, tree-relative; absent for `none`. */
  readonly path?: string;
}

/** A finding rendered for the report: the reader's kind and its one sentence. */
export interface RenderedFinding {
  readonly kind: string;
  readonly message: string;
}

/** What the product would install from the entry, or why it would not. */
export type EntryRead =
  | {
      readonly ok: true;
      readonly dialect: string;
      readonly version?: string;
      readonly description?: string;
      readonly skills: readonly string[];
      readonly subAgents: readonly string[];
      readonly servers: readonly EntryServer[];
      readonly variables: readonly PluginVariable[];
      /** Component kinds the reader passes over (hooks, commands, rules, ...), one per component. */
      readonly ignored: readonly { readonly kind: string; readonly path: string }[];
      readonly warnings: readonly RenderedFinding[];
      /** SHA-256 of the archive an install would push: the identity the server records. */
      readonly digest: string;
      readonly filesIncluded: number;
    }
  | { readonly ok: false; readonly kind: "refused"; readonly errors: readonly RenderedFinding[]; readonly warnings: readonly RenderedFinding[] }
  | { readonly ok: false; readonly kind: "too-large"; readonly selectedBytes: number; readonly maxBytes: number };

export interface EntryFacts {
  readonly source: AuditSource;
  readonly commit: string;
  /** The name a user installs the entry by. */
  readonly name: string;
  /** The entry's directory in the tree, marketplace-relative. */
  readonly dir: string;
  readonly catalogueDescription?: string;
  readonly licence: LicenceFact;
  readonly read: EntryRead;
}

/** An entry the marketplace lists that the reader does not offer, with the reader's sentence. */
export interface DroppedEntry {
  readonly source: AuditSource;
  readonly finding: RenderedFinding;
  readonly subject?: string;
}

export interface CatalogueFacts {
  readonly source: AuditSource;
  readonly commit: string;
  /** The marketplace file that named the catalogue, tree-relative. */
  readonly marketplacePath: string;
  readonly dialect: string;
  readonly entries: readonly EntryFacts[];
  readonly dropped: readonly DroppedEntry[];
  /** The repository's own licence, the fallback for a folder without one. */
  readonly rootLicence: LicenceFact;
}

/** The whole tree failed to read as a marketplace; its sentences travel. */
export class MarketplaceRefusedError extends Error {
  constructor(
    readonly source: AuditSource,
    readonly findings: readonly RenderedFinding[],
  ) {
    super(`${source.repo} does not read as a marketplace: ${findings.map((f) => f.message).join("; ")}`);
    this.name = "MarketplaceRefusedError";
  }
}

/** Read every entry of a checked-out vendor tree. */
export async function readCatalogue(source: AuditSource, tree: CheckedOutTree, listing: DirectoryListing): Promise<CatalogueFacts> {
  const outcome = readMarketplace(asPluginFiles(listing));
  if (!outcome.ok) throw new MarketplaceRefusedError(source, outcome.errors.map(render));

  const rootLicence = findLicence(listing, "");
  const entries: EntryFacts[] = [];
  for (const entry of outcome.marketplace.plugins) {
    const entryListing = subtree(listing, entry.dir);
    const folderLicence = findLicence(listing, entry.dir);
    const facts: EntryFacts = {
      source,
      commit: tree.commit,
      name: entry.name,
      dir: entry.dir,
      ...(entry.description !== undefined && { catalogueDescription: entry.description }),
      licence: folderLicence.licence === "none" ? rootLicence : folderLicence,
      read: await readEntry(entryListing),
    };
    entries.push(facts);
  }

  return {
    source,
    commit: tree.commit,
    marketplacePath: outcome.marketplace.path,
    dialect: outcome.marketplace.dialect,
    entries,
    dropped: outcome.warnings.map((finding) => ({
      source,
      finding: render(finding),
      ...(finding.subject !== undefined && { subject: finding.subject }),
    })),
    rootLicence,
  };
}

async function readEntry(listing: DirectoryListing): Promise<EntryRead> {
  const prepared = await preparePluginFromTree(listing.candidates, { respectGitignore: true });
  if (!prepared.ok) {
    switch (prepared.kind) {
      case "refused":
        return { ok: false, kind: "refused", errors: prepared.errors.map(render), warnings: prepared.warnings.map(render) };
      case "too-large":
        return { ok: false, kind: "too-large", selectedBytes: prepared.selectedBytes, maxBytes: prepared.maxBytes };
      default: {
        const exhaustive: never = prepared;
        return exhaustive;
      }
    }
  }
  const { plugin, warnings, digest, stats } = prepared.prepared;
  const hints = vendorAuthHints(listing);
  const servers: EntryServer[] = plugin.mcpServers.map((server) => {
    switch (server.transport) {
      case "http": {
        const hint = hints.get(server.name);
        return {
          name: server.name,
          transport: "http",
          url: server.url,
          headers: server.headers,
          env: server.env,
          ...(hint !== undefined && { vendorAuthHint: hint }),
        };
      }
      case "stdio":
        return { name: server.name, transport: "stdio", command: server.command, env: server.env };
      default: {
        const exhaustive: never = server;
        return exhaustive;
      }
    }
  });
  return {
    ok: true,
    dialect: plugin.dialect,
    ...(plugin.version !== undefined && { version: plugin.version }),
    ...(plugin.description !== undefined && { description: plugin.description }),
    skills: plugin.skills.map((skill) => skill.name),
    subAgents: plugin.subAgents.map((agent) => agent.name),
    servers,
    variables: plugin.variables,
    ignored: plugin.ignored.map((component) => ({ kind: component.kind, path: component.path })),
    warnings: warnings.map(render),
    digest,
    filesIncluded: stats.filesIncluded,
  };
}

function render(finding: PluginFinding | MarketplaceFinding): RenderedFinding {
  return { kind: finding.kind, message: finding.message };
}

/** The first licence file under `dir` (the tree root when empty), classified. */
function findLicence(listing: DirectoryListing, dir: string): LicenceFact {
  const prefix = dir === "" ? "" : `${dir}/`;
  const present = new Set(listing.candidates.map((candidate) => candidate.path));
  for (const name of LICENCE_FILE_NAMES) {
    const path = `${prefix}${name}`;
    if (!present.has(path)) continue;
    return { licence: classifyLicenceText(new TextDecoder().decode(listing.read(path))), path };
  }
  return { licence: "none" };
}

/**
 * Cursor's `auth` blocks by server name, from any JSON document in the
 * entry whose `mcpServers` map carries them. The reader drops the block and
 * says so; this keeps it as the vendor's hint, nothing more.
 */
function vendorAuthHints(listing: DirectoryListing): ReadonlyMap<string, unknown> {
  const hints = new Map<string, unknown>();
  for (const candidate of listing.candidates) {
    if (!candidate.path.endsWith(".json")) continue;
    let document: unknown;
    try {
      document = JSON.parse(new TextDecoder().decode(listing.read(candidate.path)));
    } catch {
      continue;
    }
    if (!isRecord(document) || !isRecord(document["mcpServers"])) continue;
    for (const [name, server] of Object.entries(document["mcpServers"])) {
      if (isRecord(server) && server["auth"] !== undefined && !hints.has(name)) hints.set(name, server["auth"]);
    }
  }
  return hints;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
