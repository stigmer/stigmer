// `stigmer search <type> <query>` — relevance-ranked text search over agents.
// Thin handler: validate type/verb/flags, delegate to the resource
// layer, then append the footer for human output: how many results match,
// and the command that reads the next page when one follows.

import type { Command } from "commander";
import { ensureAuthenticated } from "../config/index.js";
import { UsageError } from "../errors/index.js";
import type { OutputFlags } from "../output/index.js";
import { defaultRegistry, Verb } from "../registry/index.js";
import { addReadFlags, globalOrg, readFormat } from "./shared.js";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

interface SearchFlags extends OutputFlags {
  pageSize?: string;
  pageToken?: string;
}

export function registerSearch(program: Command): void {
  const search = program
    .command("search <type> <query>")
    .description("search resources by text query (supported types: agent)")
    .option("--page-size <n>", "results per page (max 100)", String(DEFAULT_PAGE_SIZE))
    .option("--page-token <token>", "continue a search from the token the previous page printed")
    .action((type: string, query: string, options: SearchFlags, command: Command) =>
      runSearch(type, query, options, command),
    );
  addReadFlags(search);
}

async function runSearch(type: string, query: string, options: SearchFlags, command: Command): Promise<void> {
  const info = defaultRegistry().getByAlias(type);
  if (info === undefined) {
    throw new UsageError(`unknown resource type: ${type}\n\nAvailable types: agent`);
  }
  if (!info.supportedVerbs.has(Verb.Search)) {
    throw new UsageError(`${info.displayName} does not support 'search'`);
  }
  if (query.trim() === "") {
    throw new UsageError("search query is required");
  }

  const pageSize = parsePositive(options.pageSize, DEFAULT_PAGE_SIZE, "--page-size");
  if (pageSize > MAX_PAGE_SIZE) {
    throw new UsageError(`--page-size cannot exceed ${MAX_PAGE_SIZE}`);
  }

  const [{ connectBackend }, { searchResources }] = await Promise.all([
    import("../backend.js"),
    import("../resources/search.js"),
  ]);

  const client = connectBackend();
  ensureAuthenticated(client.config);
  // Search defaults to all accessible orgs; only an explicit --org scopes it
  // (mirrors the Go CLI, which leaves the org empty unless overridden).
  const org = globalOrg(command) ?? "";
  const format = readFormat(options);

  const outcome = await searchResources(client.stigmer, info.kind, query, {
    org,
    pageSize,
    pageToken: options.pageToken ?? "",
  }, format);

  process.stdout.write(outcome.rendered);

  // The footer is human-only: appending it to json/yaml would corrupt the
  // machine-readable payload (a latent wart in the Go CLI we don't copy).
  if (format !== "json" && format !== "yaml" && outcome.nextPageToken !== "") {
    process.stdout.write(`\n${outcome.matches} results match.\n`);
    // The token belongs to this query in this organization, so the command
    // repeats both; --org is the program's own flag and leads.
    const orgFlag = org === "" ? "" : ` --org ${shellQuote(org)}`;
    const sizeFlag = pageSize === DEFAULT_PAGE_SIZE ? "" : ` --page-size ${pageSize}`;
    process.stdout.write(
      `See the next page with: stigmer${orgFlag} search ${type} ${shellQuote(query)}${sizeFlag} --page-token ${outcome.nextPageToken}\n`,
    );
  }
}

// A query as one shell word, so the printed next-page command runs as shown.
function shellQuote(value: string): string {
  return /^[A-Za-z0-9._\/-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;
}

function parsePositive(raw: string | undefined, fallback: number, flag: string): number {
  if (raw === undefined || raw === "") return fallback;
  if (!/^\d+$/.test(raw)) throw new UsageError(`invalid ${flag} value "${raw}"`);
  const value = Number.parseInt(raw, 10);
  if (value < 1) throw new UsageError(`${flag} must be at least 1`);
  return value;
}
