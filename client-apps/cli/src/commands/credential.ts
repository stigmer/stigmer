// `stigmer credential create|set-fields|remove-fields|reveal` — the
// operations on a credential, a saved set of secret values that belongs to
// you or to your organization.
//
// Reading and deleting stay in the unified verbs (`get credential`, `list
// credentials`, `delete credential`); this group holds what those cannot
// express, the `stigmer apikey` shape. There is no `apply`: a secret never
// belongs in a manifest file, so a credential is created from flags.
//
// Thin handler: resolve the client and organization, wire the credential
// port (the raw controller for create, whose owner arm the SDK input cannot
// carry empty; the SDK for the rest), delegate to resources/credential, and
// render. Heavy modules are lazy-imported so `--help` stays fast.

import type { Command } from "commander";
import { ensureAuthenticated, resolveOrganization } from "../config/index.js";
import type { OutputFlags } from "../output/index.js";
import type { BackendClient } from "../client/index.js";
import type { CredentialApi } from "../resources/credential.js";
import { addReadFlags, addResultFlags, globalOrg, readFormat, resultFormat } from "./shared.js";

interface FieldOptions extends OutputFlags {
  field: string[];
  plain: string[];
  fromEnv: string[];
}

interface CreateOptions extends FieldOptions {
  orgOwned?: boolean;
  description?: string;
  serves: string[];
}

const collect = (value: string, previous: string[]): string[] => [...previous, value];

function addFieldFlags(command: Command): Command {
  return command
    .option("--field <KEY=VALUE>", "a secret value (repeatable)", collect, [])
    .option("--plain <KEY=VALUE>", "a plain value, stored and shown as it is (repeatable)", collect, [])
    .option(
      "--from-env <KEY>",
      "a secret value read from your shell's environment variable KEY (repeatable)",
      collect,
      [],
    );
}

export function registerCredential(program: Command): void {
  const credential = program
    .command("credential")
    .description("save keys and sign-ins that runs use (yours, or your organization's)");

  const createCommand = credential
    .command("create <name>")
    .description("create a credential with its values")
    .option("--org-owned", "make it the organization's credential instead of your own (admins)")
    .option("--description <text>", "what the credential is for")
    .option(
      "--serves <target>",
      "use it by default for agent:<slug>, mcp-server:<slug> or git-host:<host> (repeatable)",
      collect,
      [],
    )
    .action((name: string, options: CreateOptions, command: Command) =>
      runCreate(name, options, command),
    );
  addFieldFlags(createCommand);
  addResultFlags(createCommand);

  const setFields = credential
    .command("set-fields <credential>")
    .description("add or replace values of a credential, keeping the rest (id, org/slug, or slug)")
    .action((ref: string, options: FieldOptions, command: Command) =>
      runSetFields(ref, options, command),
    );
  addFieldFlags(setFields);
  addResultFlags(setFields);

  const removeFields = credential
    .command("remove-fields <credential> <field...>")
    .description("remove values of a credential by name")
    .action((ref: string, fields: string[], options: OutputFlags, command: Command) =>
      runRemoveFields(ref, fields, options, command),
    );
  addResultFlags(removeFields);

  const reveal = credential
    .command("reveal <credential> <field>")
    .description("print one value of your own credential (an organization's credential is write-only)")
    .action((ref: string, field: string, options: OutputFlags, command: Command) =>
      runReveal(ref, field, options, command),
    );
  addReadFlags(reveal);
}

/** The credential port over a connected backend client. */
export async function credentialApi(client: BackendClient): Promise<CredentialApi> {
  const { CredentialCommandController } = await import(
    "@stigmer/protos/ai/stigmer/agentic/credential/v1/command_pb"
  );
  const sdk = client.stigmer.credential;
  return {
    create: (credential) => client.controller(CredentialCommandController).create(credential),
    get: (id) => sdk.get(id),
    getByReference: (ref) => sdk.getByReference(ref),
    setFields: (input) => sdk.setFields(input),
    removeFields: (input) => sdk.removeFields(input),
    revealField: (input) => sdk.revealField(input),
    list: (input) => sdk.list(input),
  };
}

async function connect(command: Command): Promise<{ client: BackendClient; org: string }> {
  const { connectBackend } = await import("../backend.js");
  const client = connectBackend();
  ensureAuthenticated(client.config);
  return { client, org: resolveOrganization(client.config, globalOrg(command)) };
}

async function runCreate(name: string, options: CreateOptions, command: Command): Promise<void> {
  const format = resultFormat(options);
  const [{ createCredential }, { renderResult }, { requireOrganization }] = await Promise.all([
    import("../resources/credential.js"),
    import("../output/command-result.js"),
    import("../client/single-org.js"),
  ]);
  const { client, org } = await connect(command);
  await requireOrganization(client.stigmer, org, [
    "stigmer config context set --org <org>",
    "stigmer credential create <name> --org <org> ...",
  ]);
  const result = await createCredential(
    await credentialApi(client),
    {
      name,
      orgOwned: options.orgOwned === true,
      description: options.description ?? "",
      serves: options.serves,
      field: options.field,
      plain: options.plain,
      fromEnv: options.fromEnv,
    },
    org,
  );
  renderResult(result, format);
}

async function runSetFields(ref: string, options: FieldOptions, command: Command): Promise<void> {
  const format = resultFormat(options);
  const [{ setCredentialFields }, { renderResult }] = await Promise.all([
    import("../resources/credential.js"),
    import("../output/command-result.js"),
  ]);
  const { client, org } = await connect(command);
  const result = await setCredentialFields(await credentialApi(client), ref, options, org);
  renderResult(result, format);
}

async function runRemoveFields(
  ref: string,
  fields: string[],
  options: OutputFlags,
  command: Command,
): Promise<void> {
  const format = resultFormat(options);
  const [{ removeCredentialFields }, { renderResult }] = await Promise.all([
    import("../resources/credential.js"),
    import("../output/command-result.js"),
  ]);
  const { client, org } = await connect(command);
  const result = await removeCredentialFields(await credentialApi(client), ref, fields, org);
  renderResult(result, format);
}

async function runReveal(
  ref: string,
  field: string,
  options: OutputFlags,
  command: Command,
): Promise<void> {
  const format = readFormat(options);
  const [{ revealCredentialField }, { renderProtoJson, renderProtoYaml }, { CredentialFieldSchema }] =
    await Promise.all([
      import("../resources/credential.js"),
      import("../output/index.js"),
      import("@stigmer/protos/ai/stigmer/agentic/credential/v1/spec_pb"),
    ]);
  const { client, org } = await connect(command);
  const revealed = await revealCredentialField(await credentialApi(client), ref, field, org);
  if (format === "json") {
    process.stdout.write(renderProtoJson(CredentialFieldSchema, revealed));
    return;
  }
  if (format === "yaml") {
    process.stdout.write(renderProtoYaml(CredentialFieldSchema, revealed));
    return;
  }
  process.stdout.write(`${revealed.value}\n`);
}
