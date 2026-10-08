// `stigmer vault` dispatch: create a shared vault, show your own, and save or
// remove the secrets (by name) and logins (by address) a vault holds.
//
// A vault is write-only: no RPC returns a saved value, so nothing here ever
// prints one, and a value never rides the command line by default — it is
// read from an environment variable the caller names, a file, or stdin (a
// hidden prompt on a terminal). Entry writes name their vault through
// VaultTarget: a vault by id, or the caller's own My vault, which the first
// write that names it creates. A reference (org/slug or slug) is resolved to
// its id first, so the write is addressed exactly.
//
// Removing an entry destroys a value no one can read back, so a removal is
// staged as a DeletePlan (delete.ts's shape): the vault is resolved and named
// first, the command layer confirms, and only then is the write sent.
//
// The raw controllers are driven directly (the run path's seam, create.ts):
// the entry RPCs take their request messages as-is, and the generic get, list
// and delete verbs cover the rest through the SDK.

import { readFileSync } from "node:fs";
import { create } from "@bufbuild/protobuf";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import { type Vault, VaultSchema } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/api_pb";
import { VaultCommandController } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/command_pb";
import {
  GetMyVaultInputSchema,
  RemoveVaultConnectionsInputSchema,
  RemoveVaultSecretsInputSchema,
  SetVaultConnectionInputSchema,
  SetVaultSecretsInputSchema,
  type VaultTarget,
  VaultTargetSchema,
} from "@stigmer/protos/ai/stigmer/agentic/vault/v1/io_pb";
import { VaultQueryController } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/query_pb";
import { VaultConnectionSource } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/spec_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceIdSchema, ApiResourceReferenceSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import { Code, ConnectError } from "@connectrpc/connect";
import { UsageError } from "../errors/index.js";
import { CommandResult } from "../output/index.js";
import type { DeletePlan } from "./delete.js";
import { parseReference } from "./reference.js";
import type { ControllerFn } from "./run/create.js";

/** The vault kind's canonical id prefix (proto kind_meta). */
const VAULT_ID_PREFIX = "vlt";

/** Which vault an entry command changes: a reference, or the caller's own. */
export type VaultChoice =
  | { readonly kind: "mine" }
  | { readonly kind: "ref"; readonly ref: string };

/** Where an entry's value comes from; never the command line itself. */
export interface ValueSource {
  /** Read the value from this environment variable. */
  readonly fromEnv?: string;
  /** Read the value from this file (one trailing newline dropped). */
  readonly fromFile?: string;
}

/** The streams and environment value reading touches, injectable for tests. */
export interface ValueIo {
  readonly env: NodeJS.ProcessEnv;
  readonly readStdin: () => Promise<string>;
  readonly promptHidden: (question: string) => Promise<string>;
  readonly stdinIsTty: boolean;
}

/** Pick the vault from `--mine` / `--vault`: exactly one is required. */
export function vaultChoiceOf(options: { mine?: boolean; vault?: string }): VaultChoice {
  const mine = options.mine === true;
  const ref = options.vault ?? "";
  if (mine && ref !== "") {
    throw new UsageError("name one vault: --mine or --vault <ref>, not both");
  }
  if (mine) return { kind: "mine" };
  if (ref !== "") return { kind: "ref", ref };
  throw new UsageError("name the vault: --mine for your own, or --vault <ref> for a shared vault");
}

/**
 * Read an entry's value from the named source: an environment variable, a
 * file, or stdin (a hidden prompt on a terminal). An empty value is refused:
 * removing an entry is its own command.
 */
export async function readValue(label: string, source: ValueSource, io: ValueIo): Promise<string> {
  if (source.fromEnv !== undefined && source.fromFile !== undefined) {
    throw new UsageError("read the value from one place: --from-env or --from-file, not both");
  }
  let value: string;
  if (source.fromEnv !== undefined) {
    value = io.env[source.fromEnv] ?? "";
    if (value === "") {
      throw new UsageError(`environment variable ${source.fromEnv} is not set or empty`);
    }
    return value;
  }
  if (source.fromFile !== undefined) {
    try {
      value = readFileSync(source.fromFile, "utf8");
    } catch (err) {
      throw new UsageError(`failed to read ${source.fromFile}: ${(err as Error).message}`);
    }
  } else if (io.stdinIsTty) {
    value = await io.promptHidden(`Value for ${label}`);
  } else {
    value = await io.readStdin();
  }
  value = value.replace(/\r?\n$/, "");
  if (value === "") {
    throw new UsageError(`no value given for ${label}`);
  }
  return value;
}

/** Create a shared vault in `org`: the organization's, empty and private. */
export async function createSharedVault(
  controller: ControllerFn,
  org: string,
  name: string,
  options: { readonly description?: string; readonly externalId?: string },
): Promise<CommandResult> {
  const created = await controller(VaultCommandController).create(
    create(VaultSchema, {
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "Vault",
      metadata: create(ApiResourceMetadataSchema, { name, org }),
      spec: {
        description: options.description ?? "",
        externalId: options.externalId ?? "",
      },
    }),
  );
  const result = CommandResult.success(`Shared vault '${created.metadata?.name ?? name}' created`);
  const section = result.addSection();
  section.field("ID", created.metadata?.id ?? "");
  section.field("Slug", created.metadata?.slug ?? "");
  result.hint(
    `Only the organization's admins may use it until it is shared. Add a key with: stigmer vault set-secret <NAME> --vault ${created.metadata?.slug ?? "<slug>"}`,
  );
  return result;
}

/** Show the caller's own My vault in `org`: its entry names, never a value. */
export async function showMyVault(controller: ControllerFn, org: string): Promise<CommandResult> {
  let vault: Vault;
  try {
    vault = await controller(VaultQueryController).getMine(create(GetMyVaultInputSchema, { org }));
  } catch (err) {
    if (err instanceof ConnectError && err.code === Code.NotFound) {
      const result = CommandResult.success("Your vault is empty");
      result.hint("Save a key with: stigmer vault set-secret <NAME> --mine");
      return result;
    }
    throw err;
  }
  return describeVault(vault, "Your vault");
}

/**
 * Save one secret in the chosen vault, replacing any saved under its name.
 * The value is read only once the vault resolves, so a mistyped reference
 * refuses before anyone types or pipes a secret.
 */
export async function setSecret(
  controller: ControllerFn,
  org: string,
  choice: VaultChoice,
  name: string,
  value: () => Promise<string>,
  description: string,
): Promise<CommandResult> {
  const { target } = await targetOf(controller, org, choice);
  const vault = await controller(VaultCommandController).setSecrets(
    create(SetVaultSecretsInputSchema, {
      vault: target,
      secrets: { [name]: { value: await value(), description } },
    }),
  );
  return CommandResult.success(`Secret ${name} saved in ${vaultLabel(vault, choice)}`);
}

/**
 * Stage the removal of secrets from the chosen vault by name: the warning
 * names each secret and the vault, and `perform` sends the write. Names not
 * saved are ignored.
 */
export async function planRemoveSecrets(
  controller: ControllerFn,
  org: string,
  choice: VaultChoice,
  names: readonly string[],
): Promise<DeletePlan> {
  const { target, label } = await targetOf(controller, org, choice);
  const what = names.length === 1 ? "this secret" : "these secrets";
  return {
    warning: removalWarning(`You are about to remove ${what} from ${label}:`, names),
    confirmPrompt: REMOVAL_PROMPT,
    perform: async () => {
      await controller(VaultCommandController).removeSecrets(
        create(RemoveVaultSecretsInputSchema, { vault: target, names: [...names] }),
      );
      return CommandResult.success(`Removed ${names.join(", ")} from ${label}`);
    },
  };
}

/**
 * Save a login at an address (a tool's URL or a Git host) in the chosen
 * vault. The token is read only once the vault resolves, as for a secret.
 */
export async function setConnection(
  controller: ControllerFn,
  org: string,
  choice: VaultChoice,
  address: string,
  token: () => Promise<string>,
  description: string,
): Promise<CommandResult> {
  const { target } = await targetOf(controller, org, choice);
  const vault = await controller(VaultCommandController).setConnection(
    create(SetVaultConnectionInputSchema, { vault: target, address, token: await token(), description }),
  );
  return CommandResult.success(`Login for ${address} saved in ${vaultLabel(vault, choice)}`);
}

/**
 * Stage the removal of logins from the chosen vault by address: the warning
 * names each address and the vault, and `perform` sends the write. Addresses
 * not saved are ignored.
 */
export async function planRemoveConnections(
  controller: ControllerFn,
  org: string,
  choice: VaultChoice,
  addresses: readonly string[],
): Promise<DeletePlan> {
  const { target, label } = await targetOf(controller, org, choice);
  const what = addresses.length === 1 ? "the login for this address" : "the logins for these addresses";
  return {
    warning: removalWarning(`You are about to remove ${what} from ${label}:`, addresses),
    confirmPrompt: REMOVAL_PROMPT,
    perform: async () => {
      await controller(VaultCommandController).removeConnections(
        create(RemoveVaultConnectionsInputSchema, { vault: target, addresses: [...addresses] }),
      );
      return CommandResult.success(`Removed the logins for ${addresses.join(", ")} from ${label}`);
    },
  };
}

const REMOVAL_PROMPT = "Proceed with removal? [y/N]";

function removalWarning(message: string, entries: readonly string[]): CommandResult {
  const warning = CommandResult.warning(message);
  const section = warning.addSection("");
  for (const entry of entries) section.item(entry);
  warning.hint("A removed value cannot be recovered: to restore it, save it again.");
  return warning;
}

// The VaultTarget an entry write sends, with how the vault is named to the
// caller. A reference resolves to its vault's id and organization first, so
// the write is addressed exactly and a removal's warning names the vault.
// `--mine` sends the organization as resolved, empty included: a server that
// holds one organization fills it in (as `vault mine` relies on), and one
// that holds several refuses the write.
async function targetOf(
  controller: ControllerFn,
  org: string,
  choice: VaultChoice,
): Promise<{ readonly target: VaultTarget; readonly label: string }> {
  if (choice.kind === "mine") {
    return {
      target: create(VaultTargetSchema, { org, vault: { case: "mine", value: true } }),
      label: "your vault",
    };
  }
  const parsed = parseReference(choice.ref, org, VAULT_ID_PREFIX);
  const query = controller(VaultQueryController);
  const vault =
    parsed.kind === "id"
      ? await query.get(create(ApiResourceIdSchema, { value: parsed.id }))
      : await query.getByReference(
          create(ApiResourceReferenceSchema, {
            org: parsed.org,
            slug: parsed.slug,
            kind: ApiResourceKind.vault,
          }),
        );
  const id = vault.metadata?.id ?? "";
  if (id === "") {
    throw new UsageError(`vault '${choice.ref}' has no id`);
  }
  return {
    target: create(VaultTargetSchema, {
      org: vault.metadata?.org ?? org,
      vault: { case: "id", value: id },
    }),
    label: vaultLabel(vault, choice),
  };
}

function vaultLabel(vault: Vault, choice: VaultChoice): string {
  if (choice.kind === "mine" || vault.spec?.owner.case === "person") return "your vault";
  return `vault '${vault.metadata?.name || vault.metadata?.slug || ""}'`;
}

// A vault's entries by name and address, with who saved each and when. The
// values are blank on every read; they are never shown.
function describeVault(vault: Vault, title: string): CommandResult {
  const result = CommandResult.success(title);
  const secrets = Object.entries(vault.spec?.secrets ?? {}).sort(([a], [b]) => a.localeCompare(b));
  const connections = Object.entries(vault.spec?.connections ?? {}).sort(([a], [b]) => a.localeCompare(b));
  const secretSection = result.addSection(`Secrets (${secrets.length})`);
  for (const [name, secret] of secrets) {
    secretSection.field(name, savedLine(secret.description, secret.savedAt));
  }
  const loginSection = result.addSection(`Logins (${connections.length})`);
  for (const [address, connection] of connections) {
    const how = connection.source === VaultConnectionSource.sign_in ? "signed in" : "pasted";
    loginSection.field(address, savedLine(connection.description || how, connection.savedAt));
  }
  if (secrets.length === 0 && connections.length === 0) {
    result.hint("Save a key with: stigmer vault set-secret <NAME> --mine");
  }
  return result;
}

function savedLine(description: string, savedAt: Parameters<typeof timestampDate>[0] | undefined): string {
  const when = savedAt === undefined ? "" : `saved ${timestampDate(savedAt).toISOString().slice(0, 10)}`;
  return [description, when].filter((part) => part !== "").join(" · ") || "-";
}
