// `stigmer usage {session,agent,org}` — token, model and working-time reports
// at three granularities — and `stigmer usage hours`, the organization's
// agent hours against its plan. Thin handlers: validate flags, fetch the
// report, render. The dates pass through as typed: the server reads a UTC
// calendar day (the whole day, both bounds inclusive) or an RFC 3339
// instant. Heavy modules are lazy-imported inside actions so `--help` stays
// fast.
//
// Agent hours are a Stigmer Cloud plan's (the subscription kind's), so
// `usage hours` asks the server whether it serves that kind before calling
// it, the question `stigmer run` asks of account preferences, and a server
// that does not gets a plain sentence instead of an Unimplemented error.

import type { Command } from "commander";
import { ensureAuthenticated, resolveOrganization } from "../config/index.js";
import { UsageError } from "../errors/index.js";
import type { OutputFlags } from "../output/index.js";
import { globalOrg, readFormat } from "./shared.js";

interface UsageFlags extends OutputFlags {
  from?: string;
  to?: string;
}

const FROM_HELP = "start: a UTC day, inclusive (e.g. 2026-03-01), or an RFC 3339 instant";
const TO_HELP = "end: a UTC day, inclusive (e.g. 2026-03-13), or an RFC 3339 instant";

/** What `usage hours` says on a server that serves no subscriptions. */
export const AGENT_HOURS_NOT_SERVED =
  "This server does not count agent hours: they are a Stigmer Cloud plan's. `stigmer usage org` shows working time.";

export function registerUsage(program: Command): void {
  const usage = program.command("usage").description("view token and working-time usage reports");

  usage
    .command("session <session-id>")
    .description("view the usage report for a session")
    .option("-o, --output <format>", "output format: table, json, or yaml")
    .action((sessionId: string, options: UsageFlags) => runSessionUsage(sessionId, options));

  usage
    .command("agent <agent-id>")
    .description("view the aggregated usage report for an agent within your organization")
    .option("--from <date>", FROM_HELP)
    .option("--to <date>", TO_HELP)
    .option("-o, --output <format>", "output format: table, json, or yaml")
    .action((agentId: string, options: UsageFlags, command: Command) => runAgentUsage(agentId, options, command));

  usage
    .command("org")
    .description("view the organization-wide usage report")
    .option("--from <date>", `${FROM_HELP}, required`)
    .option("--to <date>", `${TO_HELP}, required`)
    .option("-o, --output <format>", "output format: table, json, or yaml")
    .action((options: UsageFlags, command: Command) => runOrgUsage(options, command));

  usage
    .command("hours")
    .description("view the organization's agent hours against its plan (Stigmer Cloud)")
    .option("-o, --output <format>", "output format: table, json, or yaml")
    .action((options: UsageFlags, command: Command) => runAgentHours(options, command));
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

async function runAgentHours(options: UsageFlags, command: Command): Promise<void> {
  const [{ connectBackend }, usage, { ApiResourceKind }] = await Promise.all([
    import("../backend.js"),
    import("../resources/usage.js"),
    import("@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb"),
  ]);
  const client = connectBackend();
  ensureAuthenticated(client.config);
  if (!(await client.isResourceAvailable(ApiResourceKind.subscription))) {
    throw new UsageError(AGENT_HOURS_NOT_SERVED);
  }
  const org = resolveOrganization(client.config, globalOrg(command));

  const hours = await usage.getAgentHours(client.stigmer, org);
  process.stdout.write(usage.renderAgentHours(hours, readFormat(options)));
}
