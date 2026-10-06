// Version history (`get agent --version-history`) and single version
// retrieval (`get agent --version <hashOrTag>`): every apply that changes an
// agent records an immutable, hash-addressed version that can be tagged. The
// history table mirrors Go's RunVersionsList layout and empty-history
// guidance, which names the organization by slug where the caller can see it.
// A version prints the agent as that version stored it.

import { create } from "@bufbuild/protobuf";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import {
  type AgentVersionEntry,
  ListAgentVersionsInputSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agent/v1/version_pb";
import type { Stigmer } from "@stigmer/sdk";
import { organizationLabel } from "../client/organizations.js";

// Go caps the history view at 50 entries (RunVersionsList).
const VERSION_HISTORY_PAGE_SIZE = 50;

/** The columns the history table shows. */
type VersionRow = Pick<AgentVersionEntry, "versionHash" | "tag" | "appliedAt" | "isCurrent" | "message">;

/** Render the agent's version history table, or empty-history guidance. */
export async function renderAgentVersionHistory(client: Stigmer, org: string, slug: string): Promise<string> {
  const response = await client.agent.listVersions(
    create(ListAgentVersionsInputSchema, { org, slug, pageSize: VERSION_HISTORY_PAGE_SIZE }),
  );
  if (response.versions.length === 0) {
    return emptyHistory(client, org, slug);
  }
  return renderVersionsTable(response.versions, response.totalCount);
}

/**
 * The agent as a version (a hash, a tag, or "latest") stored it. An agent last
 * written before agents were versioned has no history yet; its next apply
 * records one.
 */
export async function getAgentAtVersion(client: Stigmer, org: string, slug: string, hashOrTag: string): Promise<Agent> {
  return client.agent.getByReference({ org, slug, version: hashOrTag });
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

// --- Rendering (mirrors Go's displayVersionsTable) ---

function renderVersionsTable(entries: readonly VersionRow[], totalCount: number): string {
  const lines: string[] = [
    "",
    `Version History (${totalCount} total)`,
    "",
    `  ${pad("HASH", 14)} ${pad("TAG", 10)} ${pad("APPLIED AT", 20)} ${pad("CURRENT", 8)} MESSAGE`,
    `  ${"─".repeat(14)} ${"─".repeat(10)} ${"─".repeat(20)} ${"─".repeat(8)} ───────`,
  ];

  for (const entry of entries) {
    const hash = truncateHash(entry.versionHash);
    const tag = entry.tag === "" ? "-" : entry.tag;
    const appliedAt = entry.appliedAt === undefined ? "-" : formatAppliedAt(entry.appliedAt);
    const current = entry.isCurrent ? "*" : "";
    const message = truncateMessage(entry.message);
    lines.push(`  ${pad(hash, 14)} ${pad(tag, 10)} ${pad(appliedAt, 20)} ${pad(current, 8)} ${message}`);
  }

  lines.push("");
  return `${lines.join("\n")}\n`;
}

function truncateHash(hash: string): string {
  return hash.length > 12 ? hash.slice(0, 12) : hash;
}

function truncateMessage(message: string): string {
  if (message === "") return "-";
  return message.length > 40 ? `${message.slice(0, 37)}...` : message;
}

// Matches Go's "2006-01-02 15:04" local-time layout.
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
