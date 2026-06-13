// Workflow version history (`get <workflow> --version-history`) and single
// version retrieval (`get <workflow> --version <hashOrTag>`). Versioning is a
// workflow-only feature: applies create immutable, hash-addressed versions that
// can be tagged and diffed. Mirrors Go's workflow.RunVersionsList /
// RunVersionsGet, including the table layout and the empty-history guidance.

import { create } from "@bufbuild/protobuf";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import {
  GetWorkflowVersionInputSchema,
  ListWorkflowVersionsInputSchema,
  type WorkflowVersionEntry,
} from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/version_pb";
import type { Stigmer } from "@stigmer/sdk";
import { CliExitError, ExitCode } from "../errors/index.js";

// Go caps the history view at 50 entries (workflow.getWorkflow → RunVersionsList).
const VERSION_HISTORY_PAGE_SIZE = 50;

/** Render the workflow's version history table, or empty-history guidance. */
export async function renderWorkflowVersionHistory(client: Stigmer, org: string, slug: string): Promise<string> {
  const response = await client.workflow.listVersions(
    create(ListWorkflowVersionsInputSchema, { org, slug, pageSize: VERSION_HISTORY_PAGE_SIZE }),
  );

  if (response.versions.length === 0) {
    return [
      "",
      `No version history found for ${org}/${slug}`,
      "Tip: Apply a workflow to create the first version:",
      "  stigmer apply -f workflow.yaml",
      "",
    ].join("\n");
  }

  return renderVersionsTable(response.versions, response.totalCount);
}

/** Fetch the validated YAML for a specific version (by hash or tag). */
export async function getWorkflowVersionYaml(
  client: Stigmer,
  org: string,
  slug: string,
  hashOrTag: string,
): Promise<string> {
  const workflow = await client.workflow.getByReference({ org, slug });
  const workflowId = workflow.metadata?.id ?? "";

  const entry = await client.workflow.getVersion(
    create(GetWorkflowVersionInputSchema, { workflowId, versionHash: hashOrTag }),
  );

  if (entry.validatedYaml === "") {
    throw new CliExitError(`version ${truncateHash(hashOrTag)} has no validated YAML`, ExitCode.General);
  }
  // Go uses fmt.Print (no added newline) — the YAML carries its own.
  return entry.validatedYaml;
}

// --- Rendering (mirrors Go's displayVersionsTable) ---

function renderVersionsTable(entries: readonly WorkflowVersionEntry[], totalCount: number): string {
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
