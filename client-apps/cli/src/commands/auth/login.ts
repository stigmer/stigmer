// `stigmer auth login` — the browser PKCE flow, then the account.
//
// The auth module's login() persists the tokens and switches the backend to
// cloud. This command then runs the SDK's ensureMyIdentityAccount — the
// console's first-sign-in flow (20260911.11 A3) — so a person who signs in
// from the CLI alone is provisioned, not left for entry 3's authorizer to
// lock out as an unknown principal.
//
// The order matters for the result: the tokens are already saved when the
// account step runs, so its failure is a WARNING that says the login stood
// and how to finish (`auth whoami` runs the same flow), never an error that
// sends the person back to the browser.

import { ensureMyIdentityAccount } from "@stigmer/sdk";
import { classify } from "../../errors/index.js";
import { CommandResult } from "../../output/index.js";

/** How the account step went, after the tokens were persisted. */
export type AccountSetup =
  | { readonly status: "ensured"; readonly created: boolean }
  | { readonly status: "failed"; readonly message: string };

const CLOUD_HINTS = [
  "Run commands against the cloud backend, e.g.:",
  "  stigmer list agents",
];

/** Render the login outcome. Pure: the command layer supplies `setup`. */
export function loginResult(setup: AccountSetup): CommandResult {
  switch (setup.status) {
    case "ensured": {
      const result = CommandResult.success(
        setup.created
          ? "Authenticated with Stigmer Cloud — your account was created on this first sign-in"
          : "Authenticated with Stigmer Cloud",
      );
      for (const hint of CLOUD_HINTS) result.hint(hint);
      return result;
    }
    case "failed":
      return CommandResult.warning(
        `Authenticated with Stigmer Cloud, but your account could not be set up: ${setup.message}`,
      ).hint("Run 'stigmer auth whoami' to finish setting up your account.");
    default: {
      const _exhaustive: never = setup;
      throw new Error(`unknown account setup: ${String(_exhaustive)}`);
    }
  }
}

export async function runLogin(): Promise<CommandResult> {
  const { login } = await import("../../auth/index.js");
  await login();
  return loginResult(await ensureAccount());
}

// The tokens are on disk by now; connectBackend() reads them fresh.
async function ensureAccount(): Promise<AccountSetup> {
  const { connectBackend } = await import("../../backend.js");
  const client = connectBackend();
  try {
    const { created } = await ensureMyIdentityAccount(client.stigmer, {
      onProvisioning: () =>
        process.stderr.write("Setting up your account...\n"),
    });
    return { status: "ensured", created };
  } catch (err: unknown) {
    return { status: "failed", message: classify(err)?.message ?? String(err) };
  }
}
