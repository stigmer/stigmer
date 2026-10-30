// Version history (`get agent --version-history`) and single version
// retrieval (`get agent --version <hashOrTag>`): every apply that changes an
// agent records an immutable, hash-addressed version that can be tagged. The
// history is one table, and its empty-history guidance names the
// organization by slug where the caller can see it. A version prints the
// agent as that version stored it.
//
// The table prints a 12-character hash, so wherever the CLI takes a version
// hash (`tag`, `get --version`) it takes that short form too, as git takes
// an abbreviated commit: a unique prefix of at least 4 hex characters, any
// case, matched against the agent's whole history on the client. The
// server's contract stays the full lower-case hash, so no SDK learns to
// accept an ambiguous one.

import { create } from "@bufbuild/protobuf";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { Agent } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import {
  type AgentVersionEntry,
  ListAgentVersionsInputSchema,
} from "@stigmer/apis/ai/stigmer/agentic/agent/v1/version_pb";
import type { Stigmer } from "@stigmer/client";
import { organizationLabel } from "../client/organizations.js";
import { CliExitError, classify, ExitCode, UsageError } from "../errors/index.js";

// The history view shows one page of at most 50 entries.
const VERSION_HISTORY_PAGE_SIZE = 50;

// A prefix lookup reads every page at the largest size the server serves
// (a larger one reads as 100).
const VERSION_LOOKUP_PAGE_SIZE = 100;

/** How many leading hex characters of a version hash the CLI prints. */
export const SHORT_HASH_LENGTH = 12;

// The shortest prefix taken for a hash: git's floor for an abbreviated one.
const MIN_HASH_PREFIX_LENGTH = 4;

const FULL_HASH = /^[0-9a-f]{64}$/;
const HASH_PREFIX = new RegExp(`^[0-9a-f]{${MIN_HASH_PREFIX_LENGTH},63}$`);
// What `get --version` may read as a hash once the server finds no such tag.
const HASH_SHAPED = new RegExp(`^[0-9a-f]{${MIN_HASH_PREFIX_LENGTH},64}$`, "i");

/** The columns the history table shows. */
type VersionRow = Pick<AgentVersionEntry, "versionHash" | "tag" | "appliedAt" | "isCurrent" | "message">;

/** Render the agent's version history table, or empty-history guidance. */
export async function renderAgentVersionHistory(client: Stigmer, org: string, slug: string): Promise<string> {
  const response = await client.agent.listVersions(
    create(ListAgentVersionsInputSchema, { org, slug, pageSize: VERSION_HISTORY_PAGE_SIZE }),
  );
  if (response.entries.length === 0) {
    return emptyHistory(client, org, slug);
  }
  return renderVersionsTable(response.entries, response.nextPageToken !== "");
}

/**
 * The agent as a version (a hash, a short hash, a tag, or "latest") stored
 * it. The argument is asked for as written first, so a tag that looks like
 * hex wins over a hash it happens to prefix, as a ref wins over a short hash
 * in git; only a hash-shaped argument the server did not find is then read
 * as a short hash. One that matches no version answers the server's own
 * not-found.
 */
export async function getAgentAtVersion(client: Stigmer, org: string, slug: string, hashOrTag: string): Promise<Agent> {
  try {
    return await client.agent.getByReference({ org, slug, version: hashOrTag });
  } catch (err) {
    if (!isNotFound(err) || !HASH_SHAPED.test(hashOrTag)) throw err;
    let hash: string;
    try {
      hash = await resolveAgentVersionHash(client, org, slug, hashOrTag);
    } catch (lookup) {
      if (isNotFound(lookup)) throw err;
      throw lookup;
    }
    if (hash === hashOrTag) throw err;
    return client.agent.getByReference({ org, slug, version: hash });
  }
}

/**
 * The full hash of the agent's version `hashArg` names: a full hash in any
 * case as it is, without a read, or a unique prefix of one, matched against
 * every page of the history. No match is NotFound; several are a usage
 * error listing each, since only more of the hash can say which.
 */
export async function resolveAgentVersionHash(
  client: Stigmer,
  org: string,
  slug: string,
  hashArg: string,
): Promise<string> {
  const wanted = hashArg.trim().toLowerCase();
  if (FULL_HASH.test(wanted)) return wanted;
  const handle = org === "" ? slug : `${org}/${slug}`;
  if (!HASH_PREFIX.test(wanted)) {
    throw new UsageError(
      `"${hashArg}" is not a version hash\n\n` +
        `Give the full 64-character hash, or at least its first ${MIN_HASH_PREFIX_LENGTH} characters ` +
        `as \`stigmer get agent ${handle} --version-history\` prints them`,
    );
  }
  const matches = (await listAllVersions(client, org, slug)).filter((entry) => entry.versionHash.startsWith(wanted));
  if (matches.length === 1) return matches[0]!.versionHash;
  if (matches.length === 0) {
    throw new CliExitError(`no version of ${handle} has a hash starting with ${wanted}`, ExitCode.NotFound, [
      `List them with: stigmer get agent ${handle} --version-history`,
    ]);
  }
  throw new UsageError(
    [
      `${wanted} matches ${matches.length} versions of ${handle}:`,
      ...matches.map((entry) => `  ${shortHash(entry.versionHash)}  ${entry.tag === "" ? "-" : entry.tag}`),
      "",
      "Give more of the hash.",
    ].join("\n"),
  );
}

/** A version hash as the CLI prints it: its first SHORT_HASH_LENGTH characters. */
export function shortHash(hash: string): string {
  return hash.slice(0, SHORT_HASH_LENGTH);
}

// Every version of the agent, following the page token until it is empty:
// a page may be short, even empty, and still carry one.
async function listAllVersions(client: Stigmer, org: string, slug: string): Promise<AgentVersionEntry[]> {
  const entries: AgentVersionEntry[] = [];
  let pageToken = "";
  do {
    const page = await client.agent.listVersions(
      create(ListAgentVersionsInputSchema, { org, slug, pageSize: VERSION_LOOKUP_PAGE_SIZE, pageToken }),
    );
    entries.push(...page.entries);
    pageToken = page.nextPageToken;
  } while (pageToken !== "");
  return entries;
}

function isNotFound(err: unknown): boolean {
  return classify(err)?.exitCode === ExitCode.NotFound;
}

async function emptyHistory(client: Stigmer, org: string, slug: string): Promise<string> {
  return [
    "",
    // An empty org is a server that holds one: it is never named.
    `No version history found for ${org === "" ? slug : `${await organizationLabel(client, org)}/${slug}`}`,
    "Tip: Apply an agent to create the first version:",
    "  stigmer apply -f agent.yaml",
    "",
  ].join("\n");
}

// --- Rendering ---

// The history is one page, newest first: a list says whether more follow,
// not how many there are, so the header counts the page and adds "+" when
// older versions follow it.
function renderVersionsTable(entries: readonly VersionRow[], olderFollow: boolean): string {
  const lines: string[] = [
    "",
    `Version History (${entries.length}${olderFollow ? "+" : ""})`,
    "",
    `  ${pad("HASH", 14)} ${pad("TAG", 10)} ${pad("APPLIED AT", 20)} ${pad("CURRENT", 8)} MESSAGE`,
    `  ${"─".repeat(14)} ${"─".repeat(10)} ${"─".repeat(20)} ${"─".repeat(8)} ───────`,
  ];

  for (const entry of entries) {
    const hash = shortHash(entry.versionHash);
    const tag = entry.tag === "" ? "-" : entry.tag;
    const appliedAt = entry.appliedAt === undefined ? "-" : formatAppliedAt(entry.appliedAt);
    const current = entry.isCurrent ? "*" : "";
    const message = truncateMessage(entry.message);
    lines.push(`  ${pad(hash, 14)} ${pad(tag, 10)} ${pad(appliedAt, 20)} ${pad(current, 8)} ${message}`);
  }

  lines.push("");
  return `${lines.join("\n")}\n`;
}

function truncateMessage(message: string): string {
  if (message === "") return "-";
  return message.length > 40 ? `${message.slice(0, 37)}...` : message;
}

// YYYY-MM-DD HH:mm, local time.
function formatAppliedAt(timestamp: Parameters<typeof timestampDate>[0]): string {
  const date = timestampDate(timestamp);
  const pad2 = (n: number): string => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ` +
    `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
  );
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}
