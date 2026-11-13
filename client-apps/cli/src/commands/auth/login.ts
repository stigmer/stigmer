// `stigmer auth login` — sign in where the server says, then the account.
//
// The auth module's login() signs in through the server's announced native
// client, persists the tokens into the backend's entry and makes it active.
// This command then runs the SDK's ensureMyIdentityAccount — the console's
// first-sign-in flow — so a person who signs in from the CLI alone is
// provisioned, not left for the server's authorizer to lock out as an unknown
// principal.
//
// The order matters for the result: the tokens are already saved when the
// account step runs, so its failure is a WARNING that says the login stood
// and how to finish (`auth whoami` runs the same flow), never an error that
// sends the person back to the browser.

import { ensureMyIdentityAccount } from "@stigmer/client";
import type { LoginOptions, LoginOutcome } from "../../auth/index.js";
import { DEFAULT_CLOUD_ENDPOINT } from "../../config/resolve.js";
import { classify } from "../../errors/index.js";
import { CommandResult } from "../../output/index.js";

/** How the account step went, after the tokens were persisted. */
export type AccountSetup =
  | { readonly status: "ensured"; readonly created: boolean }
  | { readonly status: "failed"; readonly message: string };

/** Where the sign-in landed, as the result names it. */
export type SignedIn = Pick<LoginOutcome, "backendName" | "type" | "address">;

/** "Stigmer Cloud" for Cloud's own address, else the server's host. */
export function serverLabel(signedIn: SignedIn): string {
  if (signedIn.type === "cloud" && signedIn.address === DEFAULT_CLOUD_ENDPOINT) return "Stigmer Cloud";
  return signedIn.address.replace(/:443$/, "");
}

/** Render the login outcome. Pure: the command layer supplies `setup`. */
export function loginResult(signedIn: SignedIn, setup: AccountSetup): CommandResult {
  const label = serverLabel(signedIn);
  switch (setup.status) {
    case "ensured":
      return CommandResult.success(
        setup.created
          ? `Authenticated with ${label} — your account was created on this first sign-in`
          : `Authenticated with ${label}`,
      )
        .hint(`Run commands against backend "${signedIn.backendName}", e.g.:`)
        .hint("  stigmer list agents");
    case "failed":
      return CommandResult.warning(
        `Authenticated with ${label}, but your account could not be set up: ${setup.message}`,
      ).hint("Run 'stigmer auth whoami' to finish setting up your account.");
    default: {
      const _exhaustive: never = setup;
      throw new Error(`unknown account setup: ${String(_exhaustive)}`);
    }
  }
}

export async function runLogin(options: LoginOptions = {}): Promise<CommandResult> {
  const { login } = await import("../../auth/index.js");
  const outcome = await login(options);
  return loginResult(outcome, await ensureAccount());
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
