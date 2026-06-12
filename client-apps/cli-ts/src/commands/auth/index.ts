// `stigmer auth login|logout|whoami` — manage Stigmer Cloud authentication.
//
// login is interactive (browser PKCE) and human-only; logout and whoami honor
// the standard mutating-output flags.

import type { Command } from "commander";
import { ensureAuthenticated, load, resolveContextOrganization, save } from "../../config/index.js";
import { CommandResult, type OutputFlags, renderResult } from "../../output/index.js";
import { addResultFlags, resultFormat } from "../shared.js";

export function registerAuth(program: Command): void {
  const auth = program.command("auth").description("manage authentication with Stigmer Cloud");

  auth
    .command("login")
    .description("log in to Stigmer Cloud via browser (PKCE OAuth)")
    .action(async () => {
      const { login } = await import("../../auth/index.js");
      await login();
      renderResult(
        CommandResult.success("Authenticated with Stigmer Cloud")
          .hint("Run commands against the cloud backend, e.g.:")
          .hint("  stigmer list agents"),
        "human",
      );
    });

  const logout = auth
    .command("logout")
    .description("clear the stored authentication token")
    .action((options: OutputFlags) => {
      renderResult(runLogout(), resultFormat(options));
    });
  addResultFlags(logout);

  const whoami = auth
    .command("whoami")
    .description("show the currently authenticated account")
    .action(async (options: OutputFlags) => {
      renderResult(await runWhoami(), resultFormat(options));
    });
  addResultFlags(whoami);
}

function runLogout(): CommandResult {
  const config = load();
  const cloud = config.backend.cloud;
  if (cloud === undefined || (cloud.token === undefined && cloud.refresh_token === undefined)) {
    return CommandResult.warning("Not currently logged in").hint("Run 'stigmer auth login' to authenticate.");
  }
  cloud.token = undefined;
  cloud.refresh_token = undefined;
  cloud.token_expiry = undefined;
  save(config);
  return CommandResult.success("Logged out from Stigmer Cloud").hint("Run 'stigmer auth login' to authenticate again.");
}

async function runWhoami(): Promise<CommandResult> {
  const { connectBackend } = await import("../../backend.js");
  const client = connectBackend();
  ensureAuthenticated(client.config);

  const account = await client.stigmer.identityAccount.whoAmI();
  const result = CommandResult.success("Authenticated");
  const section = result.addSection("");

  if (account.metadata !== undefined) {
    section.field("Account ID", account.metadata.id);
    if (account.metadata.name !== "") section.field("Name", account.metadata.name);
  }
  if (account.spec !== undefined) {
    if (account.spec.email !== "") section.field("Email", account.spec.email);
    if (account.spec.firstName !== "" || account.spec.lastName !== "") {
      section.field("Full Name", `${account.spec.firstName} ${account.spec.lastName}`.trim());
    }
    section.field("Account Type", account.spec.isMachineAccount ? "Machine Account" : "User Account");
  }

  const org = resolveContextOrganization(client.config);
  if (org !== "") {
    section.field("Organization", org);
  } else {
    result.hint("No organization set. Use: stigmer config context set --org <slug>");
  }

  return result;
}
