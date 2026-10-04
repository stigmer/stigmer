// `stigmer auth whoami` — who the connected server says you are.
//
// Runs the SDK's ensureMyIdentityAccount, the same first-sign-in flow the
// console's gate runs: an authenticated caller with no
// account yet is provisioned here rather than told "not found", so a person
// who only ever uses the CLI is never left without an account. The result
// says when THIS call created it — a first sign-in is visible, never silent.
//
// It names the context organization by the slug the backend answers now,
// not the one `config context set` stored, and stores the current one when
// the organization was renamed since.
//
// whoamiResult is the pure half (given the account and what the call learned,
// the CommandResult a person reads); runWhoami is the I/O half.

import type { IdentityAccount } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { ensureMyIdentityAccount, type Stigmer } from "@stigmer/sdk";
import {
  type Config,
  ensureAuthenticated,
  load,
  resolveContextOrganization,
  save,
} from "../../config/index.js";
import { CommandResult } from "../../output/index.js";
import { organizationNamed, type OrganizationNames } from "../../client/organizations.js";
import { omitsOrganization } from "../../client/single-org.js";

/** What the call learned beyond the account itself. */
export interface WhoamiContext {
  /** `true` when this call created the account (a first sign-in). */
  readonly created: boolean;
  /** The organization the CLI context resolves to, by slug when known; "" when none is set. */
  readonly org: string;
  /** Its id, when `org` is its slug; "" otherwise. */
  readonly orgId?: string;
  /** The server holds one organization and fills it, so the CLI never names one. */
  readonly singleOrg: boolean;
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

  // A server that holds one organization fills it: nothing to show or set.
  if (!context.singleOrg) {
    if (context.org !== "") {
      section.field("Organization", context.org);
      if (context.orgId) section.field("Organization ID", context.orgId);
    } else {
      result.hint(
        "No organization set. Use: stigmer config context set --org <slug>",
      );
    }
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
  const singleOrg = await omitsOrganization(client.stigmer);
  const org = singleOrg ? { label: "", id: "" } : await liveContextOrganization(client.stigmer, client.config);
  return whoamiResult(account, { created, org: org.label, orgId: org.id, singleOrg });
}

/**
 * The context organization as the backend names it now: its live slug and
 * id when the caller can see it, else the slug `context set` stored, else
 * the value as configured. The config catches up with what the backend
 * answers: a context an older CLI wrote by slug is rewritten to the id (with
 * the slug beside it), and a stored slug the organization was renamed from
 * is replaced, so `config context show` shows it too. Printing never fails
 * the command: any failure of the lookup falls back to what is stored.
 */
async function liveContextOrganization(
  stigmer: Stigmer,
  config: Config,
): Promise<{ readonly label: string; readonly id: string }> {
  const org = resolveContextOrganization(config);
  if (org === "") return { label: "", id: "" };
  const stored = config.context?.org_slug ?? "";
  let named: OrganizationNames | undefined;
  try {
    named = await organizationNamed(stigmer, org);
  } catch {
    named = undefined;
  }
  if (named === undefined) {
    const label = stored || org;
    return { label, id: label === org ? "" : org };
  }
  if (named.id !== org) {
    rememberContext(org, { org: named.id, org_slug: named.slug });
  } else if (stored !== "" && stored !== named.slug) {
    rememberContext(org, { org: named.id, org_slug: named.slug });
  }
  const label = named.slug || named.id;
  return { label, id: label === named.id ? "" : named.id };
}

/** Store what the backend answers for the context organization, unless the file names another organization by now. */
function rememberContext(org: string, context: { readonly org: string; readonly org_slug: string }): void {
  const config = load();
  if (config.context?.org !== org) return;
  config.context.org = context.org;
  config.context.org_slug = context.org_slug;
  save(config);
}
