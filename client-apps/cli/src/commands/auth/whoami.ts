// `stigmer auth whoami` — who the connected server says you are.
//
// Runs the SDK's ensureMyIdentityAccount, the same first-sign-in flow the
// console's gate runs (20260911.11 A3): an authenticated caller with no
// account yet is provisioned here rather than told "not found", so a person
// who only ever uses the CLI is never left without an account. The result
// says when THIS call created it — a first sign-in is visible, never silent.
//
// whoamiResult is the pure half (given the account and what the call learned,
// the CommandResult a person reads); runWhoami is the I/O half.

import type { IdentityAccount } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { ensureMyIdentityAccount } from "@stigmer/sdk";
import {
  ensureAuthenticated,
  resolveContextOrganization,
} from "../../config/index.js";
import { CommandResult } from "../../output/index.js";

/** What the call learned beyond the account itself. */
export interface WhoamiContext {
  /** `true` when this call created the account (a first sign-in). */
  readonly created: boolean;
  /** The organization the CLI context resolves to; "" when none is set. */
  readonly org: string;
}

/**
 * Render the caller's account. Every field is optional on the wire and an
 * empty profile (the unconfigured laptop's operator) renders only what it
 * has; a missing organization is a hint with the command that sets it, not a
 * failure.
 */
export function whoamiResult(
  account: IdentityAccount,
  context: WhoamiContext,
): CommandResult {
  const result = CommandResult.success(
    context.created
      ? "Authenticated — your account was created on this first sign-in"
      : "Authenticated",
  );
  const section = result.addSection("");

  if (account.metadata !== undefined) {
    section.field("Account ID", account.metadata.id);
    if (account.metadata.name !== "")
      section.field("Name", account.metadata.name);
  }
  if (account.spec !== undefined) {
    if (account.spec.email !== "") section.field("Email", account.spec.email);
    if (account.spec.firstName !== "" || account.spec.lastName !== "") {
      section.field(
        "Full Name",
        `${account.spec.firstName} ${account.spec.lastName}`.trim(),
      );
    }
    section.field(
      "Account Type",
      account.spec.isMachineAccount ? "Machine Account" : "User Account",
    );
  }

  if (context.org !== "") {
    section.field("Organization", context.org);
  } else {
    result.hint(
      "No organization set. Use: stigmer config context set --org <slug>",
    );
  }

  return result;
}

export async function runWhoami(): Promise<CommandResult> {
  const { connectBackend } = await import("../../backend.js");
  const client = connectBackend();
  ensureAuthenticated(client.config);

  const { account, created } = await ensureMyIdentityAccount(client.stigmer, {
    onProvisioning: () => process.stderr.write("Setting up your account...\n"),
  });
  return whoamiResult(account, {
    created,
    org: resolveContextOrganization(client.config),
  });
}
