// `stigmer embedding [set]` — how people sign in to the organization from your own app.
//
//   embedding                                      the settings as they stand
//   embedding set [--create-accounts-on-sign-in on|off]
//                 [--sign-in-role member|admin|viewer|none]
//
// When your app's backend mints a token for one of its users (the token
// route `stigmer app-handover` writes), the server makes that person's
// account on their first sign-in only while account creation is on, and
// gives it the sign-in role. `set` changes those two and keeps everything
// else as it stands (the allowed origins and the vaults), the rule the
// console's In your app tab follows, since the server replaces the settings
// whole (`updateEmbedding`). A role needs account creation on, so turning it
// off clears the role. Only the organization's admins may change them; the
// refusal says so.

import type { Command } from "commander";
import type { Organization } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/api_pb";
import { IamRole } from "@stigmer/apis/ai/stigmer/iam/v1/enum_pb";
import { ensureAuthenticated, resolveOrganization } from "../config/index.js";
import { Code } from "@connectrpc/connect";
import { CliExitError, ExitCode, UsageError, classify } from "../errors/index.js";
import { type OutputFlags, CommandResult, renderResult } from "../output/index.js";
import { addResultFlags, globalOrg, resultFormat } from "./shared.js";

interface SetFlags extends OutputFlags {
  createAccountsOnSignIn?: string;
  signInRole?: string;
}

const SET_ORG_WITH = ["stigmer embedding --org <org>", "stigmer config context set --org <org>"];

/** The roles `--sign-in-role` takes, by the word a person types. */
const ROLES: ReadonlyMap<string, IamRole> = new Map([
  ["member", IamRole.member],
  ["admin", IamRole.admin],
  ["viewer", IamRole.viewer],
  ["none", IamRole.iam_role_unspecified],
]);

/** The two settings `set` changes, as they stand or should stand. */
export interface SignInSettings {
  readonly createAccountsOnSignIn: boolean;
  readonly signInRole: IamRole;
}

export function registerEmbedding(program: Command): void {
  const group = program
    .command("embedding")
    .description("how people sign in to the organization from your own app: account creation and their role")
    .action(async (options: OutputFlags, command: Command) => {
      const { organization } = await openSession(command);
      renderResult(embeddingResult(organization, "Embedding settings"), resultFormat(options));
    });
  addResultFlags(group);

  const set = group
    .command("set")
    .description("change account creation on sign-in and the role it gives, keeping origins and vaults (organization admins)")
    .option("--create-accounts-on-sign-in <on|off>", "make a person's account the first time your app signs them in")
    .option("--sign-in-role <role>", "the role those accounts get: member, admin, viewer or none")
    .action(async (options: SetFlags, command: Command) => {
      const format = resultFormat(options);
      const wanted = parseSetFlags(options);
      const { stigmer, organization } = await openSession(command);
      const next = nextSettings(signInSettingsOf(organization), wanted);
      const { create } = await import("@bufbuild/protobuf");
      const { UpdateOrganizationEmbeddingInputSchema } = await import(
        "@stigmer/apis/ai/stigmer/tenancy/organization/v1/io_pb"
      );
      const { OrganizationEmbeddingSchema } = await import("@stigmer/apis/ai/stigmer/tenancy/organization/v1/spec_pb");
      const current = organization.spec?.embedding;
      let updated: Organization;
      try {
        updated = await stigmer.organization.updateEmbedding(
          create(UpdateOrganizationEmbeddingInputSchema, {
            orgId: organization.metadata?.id ?? "",
            embedding: create(OrganizationEmbeddingSchema, {
              allowedOrigins: [...(current?.allowedOrigins ?? [])],
              vaults: [...(current?.vaults ?? [])],
              createAccountsOnSignIn: next.createAccountsOnSignIn,
              signInRole: next.signInRole,
            }),
          }),
        );
      } catch (err) {
        throw refusalOf(err) ?? err;
      }
      renderResult(embeddingResult(updated, "Embedding settings saved"), format);
    });
  addResultFlags(set);
}

/** The flags as settings to apply; an omitted flag is undefined. Throws on a word it does not know. */
export function parseSetFlags(options: SetFlags): Partial<SignInSettings> {
  const out: { createAccountsOnSignIn?: boolean; signInRole?: IamRole } = {};
  if (options.createAccountsOnSignIn !== undefined) {
    const word = options.createAccountsOnSignIn.trim().toLowerCase();
    if (word !== "on" && word !== "off") {
      throw new UsageError(`--create-accounts-on-sign-in takes on or off, not "${options.createAccountsOnSignIn}"`);
    }
    out.createAccountsOnSignIn = word === "on";
  }
  if (options.signInRole !== undefined) {
    const word = options.signInRole.trim().toLowerCase();
    const role = ROLES.get(word);
    if (role === undefined) {
      throw new UsageError(
        word === "owner"
          ? "the sign-in role cannot be owner\n\nOwnership is given by hand. Use member, admin, viewer or none."
          : `unknown role "${options.signInRole}"\n\nUse member, admin, viewer or none.`,
      );
    }
    out.signInRole = role;
  }
  if (out.createAccountsOnSignIn === undefined && out.signInRole === undefined) {
    throw new UsageError(
      "nothing to change\n\nPass --create-accounts-on-sign-in on|off, --sign-in-role <role>, or both.",
    );
  }
  return out;
}

/**
 * The settings after a change: a role needs account creation on, so a role
 * asked for turns it on when the flag left it unsaid, and turning it off
 * clears the role. Pure.
 */
export function nextSettings(current: SignInSettings, wanted: Partial<SignInSettings>): SignInSettings {
  const roleAsked = wanted.signInRole !== undefined && wanted.signInRole !== IamRole.iam_role_unspecified;
  const create = wanted.createAccountsOnSignIn ?? (roleAsked ? true : current.createAccountsOnSignIn);
  if (!create && roleAsked) {
    throw new UsageError(
      "a sign-in role needs account creation on\n\nOnly an account the sign-in makes gets the role. Drop --sign-in-role, or use --create-accounts-on-sign-in on.",
    );
  }
  const role = create ? (wanted.signInRole ?? current.signInRole) : IamRole.iam_role_unspecified;
  return { createAccountsOnSignIn: create, signInRole: role };
}

/** The two settings as the organization holds them. */
export function signInSettingsOf(organization: Organization): SignInSettings {
  const embedding = organization.spec?.embedding;
  return {
    createAccountsOnSignIn: embedding?.createAccountsOnSignIn === true,
    signInRole: embedding?.signInRole ?? IamRole.iam_role_unspecified,
  };
}

/** The settings as a person reads them. Pure. */
export function embeddingResult(organization: Organization, message: string): CommandResult {
  const embedding = organization.spec?.embedding;
  const settings = signInSettingsOf(organization);
  const origins = embedding?.allowedOrigins ?? [];
  const vaults = embedding?.vaults ?? [];
  const role = roleWord(settings.signInRole);
  const result = CommandResult.success(message).withData({
    org: organization.metadata?.slug ?? "",
    createAccountsOnSignIn: settings.createAccountsOnSignIn,
    signInRole: role,
    allowedOrigins: [...origins],
    vaults: vaults.length,
  });
  result
    .addSection("")
    .field("Organization", organization.metadata?.slug ?? organization.metadata?.id ?? "")
    .field("Accounts on sign-in", settings.createAccountsOnSignIn ? "made on a person's first sign-in" : "off: your app makes them first")
    .field("Their role", settings.createAccountsOnSignIn ? role : "none")
    .field("Allowed origins", origins.length === 0 ? "any (not checked)" : origins.join(", "))
    .field("Vaults", vaults.length === 0 ? "none" : `${vaults.length}`);
  if (!settings.createAccountsOnSignIn) {
    result.hint("Let your app's users in on their first sign-in:  stigmer embedding set --create-accounts-on-sign-in on --sign-in-role member");
  }
  return result;
}

function roleWord(role: IamRole): string {
  for (const [word, value] of ROLES) if (value === role) return word;
  // A role `set` does not offer (an organization that holds one from before): its own name.
  return IamRole[role] ?? "none";
}

/** A refusal in plain words, or undefined for any other failure. */
function refusalOf(err: unknown): CliExitError | undefined {
  if (classify(err)?.code === Code.PermissionDenied) {
    return new CliExitError(
      "only the organization's admins can change how people sign in from your app",
      ExitCode.Auth,
      ["Ask an admin to run: stigmer embedding set ..."],
      { cause: err },
    );
  }
  return undefined;
}

async function openSession(command: Command): Promise<{
  stigmer: import("@stigmer/client").Stigmer;
  organization: Organization;
}> {
  const [{ connectBackend }, { currentOrganization }] = await Promise.all([
    import("../backend.js"),
    import("../client/current-organization.js"),
  ]);
  const client = connectBackend();
  ensureAuthenticated(client.config);
  const org = resolveOrganization(client.config, globalOrg(command));
  const organization = await currentOrganization(client.stigmer, org, SET_ORG_WITH);
  return { stigmer: client.stigmer, organization };
}
