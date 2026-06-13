// `stigmer search <type> <query>` — relevance-ranked text search over agents and
// workflows. Thin handler: validate type/verb/flags, delegate to the resource
// layer, then append the pagination footer for human output.

import type { Command } from "commander";
import { ensureAuthenticated } from "../config/index.js";
import { UsageError } from "../errors/index.js";
import type { OutputFlags } from "../output/index.js";
import { defaultRegistry, Verb } from "../registry/index.js";
import { addReadFlags, globalOrg, readFormat } from "./shared.js";

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

interface SearchFlags extends OutputFlags {
  excludePublic?: boolean;
  page?: string;
  pageSize?: string;
}

export function registerSearch(program: Command): void {
  const search = program
    .command("search <type> <query>")
    .description("search resources by text query (supported types: agent, workflow)")
    .option("--exclude-public", "exclude public/platform resources")
    .option("--page <n>", "page number (1-indexed)", String(DEFAULT_PAGE))
    .option("--page-size <n>", "results per page (max 100)", String(DEFAULT_PAGE_SIZE))
    .action((type: string, query: string, options: SearchFlags, command: Command) =>
      runSearch(type, query, options, command),
    );
  addReadFlags(search);
}

async function runSearch(type: string, query: string, options: SearchFlags, command: Command): Promise<void> {
  const info = defaultRegistry().getByAlias(type);
  if (info === undefined) {
    throw new UsageError(`unknown resource type: ${type}\n\nAvailable types: agent, workflow`);
  }
  if (!info.supportedVerbs.has(Verb.Search)) {
    throw new UsageError(`${info.displayName} does not support 'search'`);
  }
  if (query.trim() === "") {
    throw new UsageError("search query is required");
  }

  const page = parsePositive(options.page, DEFAULT_PAGE, "--page");
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
    excludePublic: options.excludePublic === true,
    page,
    pageSize,
  }, format);

  process.stdout.write(outcome.rendered);

  // Pagination footer is human-only: appending it to json/yaml would corrupt
  // the machine-readable payload (a latent wart in the Go CLI we don't copy).
  if (format !== "json" && format !== "yaml" && outcome.totalPages > 1) {
    process.stdout.write(`\nPage ${outcome.page} of ${outcome.totalPages} (total: ${outcome.totalCount})\n`);
    if (outcome.page < outcome.totalPages) {
      process.stdout.write(`Use --page ${outcome.page + 1} to see more results\n`);
    }
  }
}

function parsePositive(raw: string | undefined, fallback: number, flag: string): number {
  if (raw === undefined || raw === "") return fallback;
  if (!/^\d+$/.test(raw)) throw new UsageError(`invalid ${flag} value "${raw}"`);
  const value = Number.parseInt(raw, 10);
  if (value < 1) throw new UsageError(`${flag} must be at least 1`);
  return value;
}
