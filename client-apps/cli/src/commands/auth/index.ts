// `stigmer auth login|logout|whoami` — manage Stigmer Cloud authentication.
//
// login is interactive (browser PKCE) and human-only; logout and whoami honor
// the standard mutating-output flags. login and whoami both end in the SDK's
// ensureMyIdentityAccount (login.ts, whoami.ts): the first-sign-in flow the
// console runs, so the CLI provisions an account exactly as the console does.

import type { Command } from "commander";
import { activeBackend, load, save } from "../../config/index.js";
import {
  CommandResult,
  type OutputFlags,
  renderResult,
} from "../../output/index.js";
import { addResultFlags, resultFormat } from "../shared.js";

export function registerAuth(program: Command): void {
  const auth = program
    .command("auth")
    .description("manage authentication with Stigmer Cloud");

  auth
    .command("login")
    .description("log in to Stigmer Cloud via browser (PKCE OAuth)")
    .action(async () => {
      const { runLogin } = await import("./login.js");
      renderResult(await runLogin(), "human");
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
      const { runWhoami } = await import("./whoami.js");
      renderResult(await runWhoami(), resultFormat(options));
    });
  addResultFlags(whoami);
}

function runLogout(): CommandResult {
  const config = load();
  const { name, entry } = activeBackend(config);
  if (entry?.type === "selfhost") {
    if (entry.api_key === undefined) {
      return CommandResult.warning("No API key stored for this backend");
    }
    entry.api_key = undefined;
    save(config);
    return CommandResult.success(
      `Cleared the stored API key for backend "${name}"`,
    );
  }
  if (
    entry === undefined ||
    (entry.token === undefined && entry.refresh_token === undefined)
  ) {
    return CommandResult.warning("Not currently logged in").hint(
      "Run 'stigmer auth login' to authenticate.",
    );
  }
  entry.token = undefined;
  entry.refresh_token = undefined;
  entry.token_expiry = undefined;
  save(config);
  return CommandResult.success("Logged out from Stigmer Cloud").hint(
    "Run 'stigmer auth login' to authenticate again.",
  );
}
