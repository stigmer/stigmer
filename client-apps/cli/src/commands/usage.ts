// `stigmer usage {session,agent,org}` — token/cost/model reports at three
// granularities. Thin handlers: validate flags, fetch the report, render. Heavy
// modules are lazy-imported inside actions so `--help` stays fast (DD-001).

import type { Command } from "commander";
import { ensureAuthenticated, resolveOrganization } from "../config/index.js";
import { UsageError } from "../errors/index.js";
import type { OutputFlags } from "../output/index.js";
import { globalOrg, readFormat } from "./shared.js";

interface UsageFlags extends OutputFlags {
  from?: string;
  to?: string;
}

export function registerUsage(program: Command): void {
  const usage = program.command("usage").description("view token usage and cost reports");

  usage
    .command("session <session-id>")
    .description("view the usage report for a session")
    .option("-o, --output <format>", "output format: table, json, or yaml")
    .action((sessionId: string, options: UsageFlags) => runSessionUsage(sessionId, options));

  usage
    .command("agent <agent-id>")
    .description("view the aggregated usage report for an agent within your organization")
    .option("--from <date>", "start date (ISO 8601, e.g. 2026-03-01)")
    .option("--to <date>", "end date (ISO 8601, e.g. 2026-03-13)")
    .option("-o, --output <format>", "output format: table, json, or yaml")
    .action((agentId: string, options: UsageFlags, command: Command) => runAgentUsage(agentId, options, command));

  usage
    .command("org")
    .description("view the organization-wide usage report")
    .option("--from <date>", "start date (ISO 8601, required)")
    .option("--to <date>", "end date (ISO 8601, required)")
    .option("-o, --output <format>", "output format: table, json, or yaml")
    .action((options: UsageFlags, command: Command) => runOrgUsage(options, command));
}

async function runSessionUsage(sessionId: string, options: UsageFlags): Promise<void> {
  const [{ connectBackend }, usage] = await Promise.all([import("../backend.js"), import("../resources/usage.js")]);
  const client = connectBackend();
  ensureAuthenticated(client.config);

  const report = await usage.getSessionUsageReport(client.stigmer, sessionId);
  process.stdout.write(usage.renderSessionUsage(report, readFormat(options)));
}

async function runAgentUsage(agentId: string, options: UsageFlags, command: Command): Promise<void> {
  const [{ connectBackend }, usage] = await Promise.all([import("../backend.js"), import("../resources/usage.js")]);
  const client = connectBackend();
  ensureAuthenticated(client.config);
  // The report is org-scoped (usage of the agent within one org), so the org
  // resolves exactly as `usage org` does: global --org flag or config default.
  const org = resolveOrganization(client.config, globalOrg(command));

  const range = { from: options.from ?? "", to: options.to ?? "" };
  const report = await usage.getAgentUsageReport(client.stigmer, agentId, org, range);
  process.stdout.write(usage.renderAgentUsage(report, range, readFormat(options)));
}

async function runOrgUsage(options: UsageFlags, command: Command): Promise<void> {
  const range = { from: options.from ?? "", to: options.to ?? "" };
  if (range.from === "" || range.to === "") {
    throw new UsageError("usage org requires both --from and --to");
  }

  const [{ connectBackend }, usage] = await Promise.all([import("../backend.js"), import("../resources/usage.js")]);
  const client = connectBackend();
  ensureAuthenticated(client.config);
  const org = resolveOrganization(client.config, globalOrg(command));

  const report = await usage.getOrgUsageReport(client.stigmer, org, range);
  process.stdout.write(usage.renderOrgUsage(report, range, readFormat(options)));
}
