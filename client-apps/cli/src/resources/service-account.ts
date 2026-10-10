// `stigmer service-account` dispatch: list an organization's service
// accounts, create one with its role, list one's API keys, delete one, and
// find one by name for `stigmer apikey create --service-account`.
//
// A service account is an organization's own non-person account that its
// automation (a CI job, a script) acts as through API keys, so the automation
// keeps working when the person who set it up leaves. It is an identity
// account, not a resource kind, so the generic verbs do not name it; these
// helpers drive the identity-account and key clients directly. A service
// account's keys are listed here (`findByAccount`), not by `stigmer list
// apikeys`, which answers the caller's own keys; one is revoked with
// `stigmer delete apikey <id>`.
//
// A service account is named by its name, unique among its organization's
// service accounts; its id (`ida_…`) is accepted too, so a script that kept
// the id from `create --json` can address it after a rename. The server
// lists them newest first and an organization has few, so every page is read
// and the name matched here. A bounded page count keeps a server that
// misreports its total from looping the CLI.
//
// Deleting one ends every key it has at once, so a delete is staged as a
// DeletePlan (delete.ts's shape): the account is resolved and named first,
// the command layer confirms, and only then is the delete sent.

import { create } from "@bufbuild/protobuf";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import { PageInfoSchema } from "@stigmer/protos/ai/stigmer/commons/rpc/pagination_pb";
import type { ApiKey } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/api_pb";
import {
  type IdentityAccount,
  IdentityAccountSchema,
} from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import {
  CreateServiceAccountInputSchema,
  ListWithIdentityOrgSchema,
} from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/io_pb";
import { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";
import { iamRoleDisplayName, type Stigmer } from "@stigmer/sdk";
import { CliExitError } from "../errors/cli-exit-error.js";
import { ExitCode } from "../errors/exit-codes.js";
import { UsageError } from "../errors/usage-error.js";
import { CommandResult, protoToJsonValue } from "../output/index.js";
import type { DeletePlan } from "./delete.js";

/** The clients these helpers call: the identity-account and API key clients. */
export type ServiceAccountClient = Pick<Stigmer, "identityAccount" | "apiKey">;

/** The roles `--role` accepts, by the word a person types. */
const ROLES: ReadonlyMap<string, IamRole> = new Map([
  ["admin", IamRole.admin],
  ["member", IamRole.member],
  ["viewer", IamRole.viewer],
]);

const PAGE_SIZE = 100;
const MAX_PAGES = 20;

/**
 * The organization role `--role` names. Owner is refused here as the server
 * refuses it: an owner decides who owns the organization, and a key in a CI
 * job must never be able to.
 */
export function parseServiceAccountRole(value: string): IamRole {
  const role = ROLES.get(value.trim().toLowerCase());
  if (role !== undefined) return role;
  if (value.trim().toLowerCase() === "owner") {
    throw new UsageError(
      "a service account cannot be an owner\n\nUse --role admin, member or viewer.",
    );
  }
  throw new UsageError(`unknown role "${value}"\n\nUse --role admin, member or viewer.`);
}

/** Every service account of the organization, newest first. */
export async function listServiceAccounts(
  client: ServiceAccountClient,
  org: string,
): Promise<IdentityAccount[]> {
  const accounts: IdentityAccount[] = [];
  for (let num = 1; num <= MAX_PAGES; num++) {
    const page = await client.identityAccount.listServiceAccounts(
      create(ListWithIdentityOrgSchema, {
        org,
        page: create(PageInfoSchema, { num, size: PAGE_SIZE }),
      }),
    );
    accounts.push(...page.entries);
    if (page.entries.length === 0 || num >= page.totalPages) break;
  }
  return accounts;
}

/**
 * The organization's service account named `ref` (its name, or its id).
 * None answers NotFound (exit 5) with the command that lists them.
 */
export async function findServiceAccount(
  client: ServiceAccountClient,
  org: string,
  ref: string,
): Promise<IdentityAccount> {
  const wanted = ref.trim();
  const accounts = await listServiceAccounts(client, org);
  const found =
    accounts.find((account) => account.metadata?.name === wanted) ??
    accounts.find((account) => account.metadata?.id === wanted);
  if (found !== undefined) return found;
  throw new CliExitError(`no service account named "${wanted}" in this organization`, ExitCode.NotFound, [
    "List them with: stigmer service-account list",
  ]);
}

/** The API keys of the organization's service account named `ref`, newest first. */
export async function listServiceAccountKeys(
  client: ServiceAccountClient,
  org: string,
  ref: string,
): Promise<ApiKey[]> {
  const account = await findServiceAccount(client, org, ref);
  return (await client.apiKey.findByAccount(account.metadata?.id ?? "")).entries;
}

/** The key list's table: one row per key, as `stigmer list apikeys` renders it. */
export function serviceAccountKeyRows(keys: readonly ApiKey[]): string[][] {
  return keys.map((key) => {
    const fingerprint = key.spec?.fingerprint ?? "";
    const expiresAt = key.spec?.expiresAt;
    return [
      key.metadata?.id ?? "",
      key.metadata?.name || "-",
      fingerprint === "" ? "" : `***${fingerprint}`,
      key.spec?.neverExpires === true || expiresAt === undefined
        ? "Never"
        : timestampDate(expiresAt).toISOString().slice(0, 10),
    ];
  });
}

export const SERVICE_ACCOUNT_KEY_TABLE_HEADERS = ["ID", "NAME", "FINGERPRINT", "EXPIRES"] as const;

/** Create a service account holding `role`, and say how to give it a key. */
export async function createServiceAccount(
  client: ServiceAccountClient,
  org: string,
  name: string,
  role: IamRole,
): Promise<CommandResult> {
  const account = await client.identityAccount.createServiceAccount(
    create(CreateServiceAccountInputSchema, { org, name: name.trim(), role }),
  );
  const created = account.metadata?.name ?? name.trim();
  const result = CommandResult.success(
    `Service account ${created} created with the ${iamRoleDisplayName(role)} role`,
  );
  result.addSection().field("ID", account.metadata?.id ?? "");
  result.hint(`Create its first API key: stigmer apikey create --service-account ${created}`);
  return result.withData(protoToJsonValue(IdentityAccountSchema, account));
}

/**
 * Stage the delete of a service account: resolve it by name, say that its
 * keys stop working at once, and delete it only once the caller confirms.
 */
export async function planDeleteServiceAccount(
  client: ServiceAccountClient,
  org: string,
  ref: string,
): Promise<DeletePlan> {
  const account = await findServiceAccount(client, org, ref);
  const id = account.metadata?.id ?? "";
  const name = account.metadata?.name ?? id;
  const warning = CommandResult.warning("You are about to delete this service account:");
  warning.addSection().item(`${name} (${id})`);
  warning.hint("Every API key it has stops working at once, and it loses every role it holds.");
  warning.hint("What it created stays with the organization.");
  return {
    warning,
    confirmPrompt: "Proceed with deletion? [y/N]",
    perform: async () => {
      await client.identityAccount.delete(id);
      return CommandResult.success(`Deleted service account ${name}; its API keys no longer work`);
    },
  };
}

/** The list's table: one row per service account. */
export function serviceAccountRows(accounts: readonly IdentityAccount[]): string[][] {
  return accounts.map((account) => [
    account.metadata?.name ?? "",
    account.metadata?.id ?? "",
    formatCreated(account),
  ]);
}

export const SERVICE_ACCOUNT_TABLE_HEADERS = ["NAME", "ID", "CREATED"] as const;

function formatCreated(account: IdentityAccount): string {
  const at = account.status?.audit?.specAudit?.createdAt;
  return at === undefined ? "" : timestampDate(at).toISOString();
}
