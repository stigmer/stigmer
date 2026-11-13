// `stigmer auth login|logout|whoami` — sign in to the server the CLI points at.
//
// login signs in wherever the active backend's server says (its announced
// native client): through the browser, or with `--device`, a code typed on
// any device; all three honor the standard
// mutating-output flags, login's result printed once the browser returns. login and whoami both end in the SDK's
// ensureMyIdentityAccount (login.ts, whoami.ts): the first-sign-in flow the
// console runs, so the CLI provisions an account exactly as the console does.

import type { Command } from "commander";
import { activeBackend, hasSignIn, load, save } from "../../config/index.js";
import {
  CommandResult,
  type OutputFlags,
  renderResult,
} from "../../output/index.js";
import { addResultFlags, resultFormat } from "../shared.js";

export function registerAuth(program: Command): void {
  const auth = program
    .command("auth")
    .description("sign in to the server the CLI points at");

  const login = auth
    .command("login")
    .description("sign in to the active backend's server, in your browser or with a code")
    .option("--device", "sign in with a code typed on any device (where no browser opens here)")
    .option("--trust-provider", "sign in even though the server's sign-in provider is on another site")
    .action(async (options: OutputFlags & { device?: boolean; trustProvider?: boolean }) => {
      const format = resultFormat(options);
      const { runLogin } = await import("./login.js");
      renderResult(await runLogin({ device: options.device, trustProvider: options.trustProvider }), format);
    });
  addResultFlags(login);

  const logout = auth
    .command("logout")
    .description("clear the stored sign-in (or, with none, a self-hosted backend's API key)")
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
  if (entry?.type === "selfhost" && !hasSignIn(entry)) {
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
  entry.oidc_issuer = undefined;
  entry.oidc_client_id = undefined;
  save(config);
  return CommandResult.success(`Logged out from backend "${name}"`).hint(
    "Run 'stigmer auth login' to authenticate again.",
  );
}
