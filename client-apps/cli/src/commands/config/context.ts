// `stigmer config context show|set` — the active CLI context: the
// organization every command targets when neither `--org` nor
// STIGMER_ORG_ID names one.
//
// `set --org <slug>` checks the slug against the active backend before it
// persists: the organization must be one the caller belongs to there
// (findMyOrganizations), so a typo or a stranger's slug is refused at the
// moment it is typed, not on the next command. An empty slug clears the
// context without asking the backend, and the resolver falls back to its
// default again. The raw `config set context.organization` stays the
// unchecked escape hatch.

import type { Command } from "commander";
import { type Config, activeBackendName, ensureAuthenticated, load, resolveContextOrganization, save } from "../../config/index.js";
import { CliExitError, ExitCode, UsageError } from "../../errors/index.js";
import { CommandResult, type OutputFlags, renderResult } from "../../output/index.js";
import { addResultFlags, resultFormat } from "../shared.js";

export function addContextCommands(context: Command): void {
  const show = context
    .command("show")
    .description("show the active context")
    .action((options: OutputFlags) => {
      renderResult(buildShow(load()), resultFormat(options));
    });
  addResultFlags(show);

  const set = context
    .command("set")
    .description("set the active context's organization, checked against the backend")
    .option("--org <slug>", "an organization you belong to on the active backend (empty clears it)")
    .action((options: OutputFlags & { org?: string }) => runSet(options));
  addResultFlags(set);
}

function buildShow(config: Config): CommandResult {
  const organization = resolveContextOrganization(config) || "(not set)";
  const result = CommandResult.success("CLI context");
  result.addSection("").field("Organization", organization).field("Backend", config.backend.type);
  return result;
}

async function runSet(flags: OutputFlags & { org?: string }): Promise<void> {
  const org = flags.org;
  if (org === undefined) {
    throw new UsageError(
      "--org is required\n\nSet it with:\n  stigmer config context set --org <org>\nClear it with:\n  stigmer config context set --org \"\"",
    );
  }

  const config = load();
  if (org !== "") await assertMembership(config, org);

  (config.context ??= {}).organization = org;
  save(config);
  const message = org === "" ? "Context organization cleared" : `Context organization set to '${org}'`;
  renderResult(CommandResult.success(message), resultFormat(flags));
}

async function assertMembership(config: Config, org: string): Promise<void> {
  const { connectBackend } = await import("../../backend.js");
  const client = connectBackend(config);
  ensureAuthenticated(client.config);
  const mine = await client.stigmer.organization.findMyOrganizations();
  if (mine.entries.some((entry) => entry.metadata?.slug === org)) return;
  throw new CliExitError(
    `organization '${org}' is not one you belong to on the '${activeBackendName(config)}' backend`,
    ExitCode.NotFound,
    ["See the organizations you belong to with: stigmer list organizations"],
  );
}
