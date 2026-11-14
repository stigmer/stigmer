// `stigmer usage {session,agent,org}` — token, model and working-time reports
// at three granularities — `stigmer usage hours`, the organization's agent
// hours against its plan, and `stigmer usage onboarding`, a platform
// operator's count of how far new organizations got on the journey from a
// first agent to their users. Thin handlers: validate flags, fetch the
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
import { CliExitError } from "../errors/cli-exit-error.js";

interface UsageFlags extends OutputFlags {
  from?: string;
  to?: string;
}

const FROM_HELP = "start: a UTC day, inclusive (e.g. 2026-03-01), or an RFC 3339 instant";
const TO_HELP = "end: a UTC day, inclusive (e.g. 2026-03-13), or an RFC 3339 instant";

/** What `usage hours` says on a server that serves no subscriptions. */
export const AGENT_HOURS_NOT_SERVED =
  "This server does not count agent hours: they are a Stigmer Cloud plan's. `stigmer usage org` shows working time.";

/** What `usage onboarding` says to a caller who is no platform operator. */
export const ONBOARDING_NOT_PERMITTED = "Only a platform operator can read onboarding counts.";

/** What `usage onboarding` says on a server older than the count. */
export const ONBOARDING_NOT_SERVED =
  "This server does not count onboarding yet: it is older than this command. Upgrade the server to read where newcomers stop.";

/** How many days `usage onboarding` counts when no --from is given: the last week, today included. */
const ONBOARDING_DEFAULT_DAYS = 7;

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
    .command("onboarding")
    .description("view how far new organizations got, from a first agent to their users (platform operators)")
    .option("--from <date>", `${FROM_HELP}; default: ${ONBOARDING_DEFAULT_DAYS - 1} days before --to`)
    .option("--to <date>", `${TO_HELP}; default: today`)
    .option("-o, --output <format>", "output format: table, json, or yaml")
    .action((options: UsageFlags) => runOnboardingFunnel(options));

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
    import("@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb"),
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

async function runOnboardingFunnel(options: UsageFlags): Promise<void> {
  const range = onboardingRange(options, new Date());
  const [{ connectBackend }, usage, { isPermissionDenied, isUnimplemented }, { ExitCode }] = await Promise.all([
    import("../backend.js"),
    import("../resources/usage.js"),
    import("@stigmer/client"),
    import("@stigmer/client/exit-codes"),
  ]);
  const client = connectBackend();
  ensureAuthenticated(client.config);

  let funnel: Awaited<ReturnType<typeof usage.getOnboardingFunnel>>;
  try {
    funnel = await usage.getOnboardingFunnel(client.stigmer, range);
  } catch (err) {
    if (isPermissionDenied(err)) throw new CliExitError(ONBOARDING_NOT_PERMITTED, ExitCode.Auth, undefined, { cause: err });
    if (isUnimplemented(err)) throw new CliExitError(ONBOARDING_NOT_SERVED, ExitCode.Usage, undefined, { cause: err });
    throw err;
  }
  process.stdout.write(usage.renderOnboardingFunnel(funnel, range, readFormat(options)));
}

/** The window `usage onboarding` counts: as typed, else the last week to today (UTC days). */
export function onboardingRange(options: UsageFlags, now: Date): { readonly from: string; readonly to: string } {
  const to = options.to ?? now.toISOString().slice(0, 10);
  if (options.from !== undefined) return { from: options.from, to };
  const end = /^\d{4}-\d{2}-\d{2}$/.test(to) ? Date.parse(`${to}T00:00:00Z`) : Date.parse(to);
  if (Number.isNaN(end)) return { from: "", to };
  const from = new Date(end - (ONBOARDING_DEFAULT_DAYS - 1) * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return { from, to };
}
