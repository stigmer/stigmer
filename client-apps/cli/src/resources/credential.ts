// `credential create|set-fields|remove-fields|reveal`: the operations on a
// saved set of secret values that belongs to a person or to the organization.
//
// A credential is created with its values, never applied from a file: a
// secret does not belong in a manifest, so the kind has no `apply` and the
// CLI builds the request from flags. Values arrive three ways:
// `--field KEY=VALUE` (a secret), `--plain KEY=VALUE` (plain configuration,
// stored and shown as it is) and `--from-env KEY` (a secret read from the
// caller's own shell, so it never sits in shell history). A key given twice
// is refused rather than one source silently winning.
//
// `--serves` names what the credential is used for by default: an agent, an
// MCP server or a git host. A reference with no organization is left empty
// on the wire, and the server fills the credential's own organization.
//
// Owner: a person's own credential is the default (the owner oneof's
// `person` arm with an empty value, which the server reads as the caller);
// `--org-owned` asks for the organization's (the `org` arm, empty for the
// credential's own organization), which the server allows admins only. The
// owner is fixed at create, so no other operation takes it.
//
// Reveal prints one field's value on stdout, the data channel, so it pipes
// cleanly. Only a person's own credential can be revealed; the server
// refuses an organization's, which is write-only.
//
// Every operation takes the narrow `CredentialApi` port rather than the SDK
// client, because create must send the owner's `person` arm with an empty
// value, which the SDK's input mapper cannot express: the command wires the
// port from the raw controller for create and the SDK for the rest.

import { create } from "@bufbuild/protobuf";
import {
  type Credential,
  CredentialSchema,
} from "@stigmer/protos/ai/stigmer/agentic/credential/v1/api_pb";
import {
  type CredentialList,
  type ListCredentialsInput,
  ListCredentialsInputSchema,
  type RemoveCredentialFieldsInput,
  RemoveCredentialFieldsInputSchema,
  type RevealCredentialFieldInput,
  RevealCredentialFieldInputSchema,
  type SetCredentialFieldsInput,
  SetCredentialFieldsInputSchema,
} from "@stigmer/protos/ai/stigmer/agentic/credential/v1/io_pb";
import {
  type CredentialTarget,
  CredentialTargetSchema,
} from "@stigmer/protos/ai/stigmer/agentic/credential/v1/requirement_pb";
import {
  type CredentialField,
  CredentialFieldSchema,
  CredentialSpecSchema,
} from "@stigmer/protos/ai/stigmer/agentic/credential/v1/spec_pb";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { McpServerSignIn } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/spec_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceReferenceSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { PageInfoSchema } from "@stigmer/protos/ai/stigmer/commons/rpc/pagination_pb";
import { UsageError } from "../errors/index.js";
import { CommandResult } from "../output/index.js";
import { parseReference } from "./reference.js";

/** The credential kind's id prefix (proto kind_meta). */
const CREDENTIAL_ID_PREFIX = "cred";

/** A field name, as the contract constrains it. */
const FIELD_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** A git host name, as the contract constrains it. */
const GIT_HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/** How many credentials one listing asks for when looking for a match. */
const LIST_PAGE_SIZE = 200;

/** The credential calls the operations make. */
export interface CredentialApi {
  create(credential: Credential): Promise<Credential>;
  get(id: string): Promise<Credential>;
  getByReference(ref: { org: string; slug: string }): Promise<Credential>;
  setFields(input: SetCredentialFieldsInput): Promise<Credential>;
  removeFields(input: RemoveCredentialFieldsInput): Promise<Credential>;
  revealField(input: RevealCredentialFieldInput): Promise<CredentialField>;
  list(input: ListCredentialsInput): Promise<CredentialList>;
}

/** The value flags, as commander collects them. */
export interface FieldFlags {
  readonly field: readonly string[];
  readonly plain: readonly string[];
  readonly fromEnv: readonly string[];
}

export interface CreateCredentialOptions extends FieldFlags {
  readonly name: string;
  readonly orgOwned: boolean;
  readonly description: string;
  readonly serves: readonly string[];
}

/**
 * The fields the flags give, by name. `env` is the shell environment
 * `--from-env` reads (the process's own by default).
 */
export function parseFieldFlags(
  flags: FieldFlags,
  env: NodeJS.ProcessEnv = process.env,
): Record<string, CredentialField> {
  const fields: Record<string, CredentialField> = {};
  const add = (key: string, value: string, plain: boolean, flag: string): void => {
    if (!FIELD_NAME.test(key)) {
      throw new UsageError(
        `invalid field name '${key}' in ${flag}: a field name is letters, digits and underscores, not starting with a digit (for example OPENAI_API_KEY)`,
      );
    }
    if (key in fields) {
      throw new UsageError(`field ${key} is given more than once; give each field once`);
    }
    fields[key] = create(CredentialFieldSchema, { value, plain });
  };

  for (const entry of flags.field) {
    const [key, value] = splitAssignment(entry, "--field");
    add(key, value, false, "--field");
  }
  for (const entry of flags.plain) {
    const [key, value] = splitAssignment(entry, "--plain");
    add(key, value, true, "--plain");
  }
  for (const key of flags.fromEnv) {
    const value = env[key];
    if (value === undefined || value === "") {
      throw new UsageError(
        `--from-env ${key}: ${key} is not set in your shell's environment\n\nExport it first (export ${key}=...), or give the value with --field ${key}=<value>`,
      );
    }
    add(key, value, false, "--from-env");
  }
  return fields;
}

function splitAssignment(entry: string, flag: string): [string, string] {
  const eq = entry.indexOf("=");
  if (eq <= 0) {
    throw new UsageError(`invalid ${flag} value '${entry}': expected KEY=VALUE`);
  }
  return [entry.slice(0, eq), entry.slice(eq + 1)];
}

/**
 * One `--serves` value as a target: `agent:<ref>`, `mcp-server:<ref>` or
 * `git-host:<host>`, where `<ref>` is `slug` or `org/slug`.
 */
export function parseServesTarget(value: string): CredentialTarget {
  const colon = value.indexOf(":");
  const kind = colon <= 0 ? "" : value.slice(0, colon).toLowerCase();
  const rest = colon <= 0 ? "" : value.slice(colon + 1).trim();
  if (rest === "") {
    throw new UsageError(
      `invalid --serves value '${value}': expected agent:<slug>, mcp-server:<slug> or git-host:<host>`,
    );
  }
  switch (kind) {
    case "agent":
      return create(CredentialTargetSchema, {
        target: { case: "agent", value: targetReference(rest, ApiResourceKind.agent, value) },
      });
    case "mcp-server":
    case "mcp_server":
      return create(CredentialTargetSchema, {
        target: {
          case: "mcpServer",
          value: targetReference(rest, ApiResourceKind.mcp_server, value),
        },
      });
    case "git-host":
    case "git_host": {
      const host = rest.toLowerCase();
      if (!GIT_HOST.test(host)) {
        throw new UsageError(
          `invalid --serves value '${value}': '${rest}' is not a host name (for example git-host:github.com)`,
        );
      }
      return create(CredentialTargetSchema, { target: { case: "gitHost", value: host } });
    }
    default:
      throw new UsageError(
        `invalid --serves value '${value}': a credential serves an agent, an MCP server or a git host (agent:<slug>, mcp-server:<slug>, git-host:<host>)`,
      );
  }
}

function targetReference(ref: string, kind: ApiResourceKind, value: string) {
  const slash = ref.indexOf("/");
  const org = slash > 0 ? ref.slice(0, slash) : "";
  const slug = slash > 0 ? ref.slice(slash + 1) : ref;
  if (slug === "" || slug.includes("/")) {
    throw new UsageError(`invalid --serves value '${value}': expected <slug> or <org>/<slug>`);
  }
  return create(ApiResourceReferenceSchema, { org, slug, kind });
}

/** The create request the flags describe, in organization `org`. */
export function credentialToCreate(
  options: CreateCredentialOptions,
  org: string,
  env: NodeJS.ProcessEnv = process.env,
): Credential {
  const name = options.name.trim();
  if (name === "") {
    throw new UsageError("a credential needs a name (for example: stigmer credential create OpenAI ...)");
  }
  return create(CredentialSchema, {
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "Credential",
    metadata: { name, org },
    spec: create(CredentialSpecSchema, {
      owner: options.orgOwned ? { case: "org", value: "" } : { case: "person", value: "" },
      description: options.description,
      fields: parseFieldFlags(options, env),
      serves: options.serves.map(parseServesTarget),
    }),
  });
}

/** Create a credential and describe it. */
export async function createCredential(
  api: CredentialApi,
  options: CreateCredentialOptions,
  org: string,
): Promise<CommandResult> {
  const created = await api.create(credentialToCreate(options, org));
  const result = describeCredential(
    CommandResult.success(`Credential '${created.metadata?.name ?? options.name}' created`),
    created,
  );
  if (Object.keys(created.spec?.fields ?? {}).length === 0) {
    result.hint("It holds no values yet. Add them with:");
    result.hint(`  stigmer credential set-fields ${created.metadata?.slug ?? ""} --field KEY=VALUE`);
  }
  return result;
}

/** Add or replace fields of a credential, keeping the rest. */
export async function setCredentialFields(
  api: CredentialApi,
  ref: string,
  flags: FieldFlags,
  org: string,
): Promise<CommandResult> {
  const fields = parseFieldFlags(flags);
  if (Object.keys(fields).length === 0) {
    throw new UsageError("give at least one field with --field, --plain or --from-env");
  }
  const credential = await loadCredential(api, ref, org);
  const updated = await api.setFields(
    create(SetCredentialFieldsInputSchema, { credentialId: credential.metadata?.id ?? "", fields }),
  );
  return describeCredential(
    CommandResult.success(`Set ${plural(Object.keys(fields).length, "field")} on credential '${nameOf(updated)}'`),
    updated,
  );
}

/** Remove fields of a credential by name. */
export async function removeCredentialFields(
  api: CredentialApi,
  ref: string,
  names: readonly string[],
  org: string,
): Promise<CommandResult> {
  if (names.length === 0) {
    throw new UsageError("name at least one field to remove");
  }
  const credential = await loadCredential(api, ref, org);
  const held = new Set(Object.keys(credential.spec?.fields ?? {}));
  const missing = names.filter((name) => !held.has(name));
  const updated = await api.removeFields(
    create(RemoveCredentialFieldsInputSchema, {
      credentialId: credential.metadata?.id ?? "",
      fields: [...names],
    }),
  );
  const result = describeCredential(
    CommandResult.success(
      `Removed ${plural(names.length - missing.length, "field")} from credential '${nameOf(updated)}'`,
    ),
    updated,
  );
  if (missing.length > 0) {
    result.hint(`Not on this credential, so nothing to remove: ${missing.join(", ")}`);
  }
  return result;
}

/** Reveal one field of your own credential. */
export async function revealCredentialField(
  api: CredentialApi,
  ref: string,
  field: string,
  org: string,
): Promise<CredentialField> {
  const credential = await loadCredential(api, ref, org);
  return api.revealField(
    create(RevealCredentialFieldInputSchema, { credentialId: credential.metadata?.id ?? "", field }),
  );
}

/**
 * Save the `--env` values of `connect mcp-server --save` as the caller's own
 * credential serving the server: the fields are set on the credential that
 * already serves it, or a new credential named after the server is created.
 * A value the server declares plain stays plain; every other value is a
 * secret.
 *
 * A server whose sign-in is the organization's reads only the
 * organization's credential, so a person's own would never be used; that
 * is refused, naming what an admin runs instead.
 */
export async function saveConnectCredential(
  api: CredentialApi,
  server: McpServer,
  values: Readonly<Record<string, string>>,
  org: string,
): Promise<CommandResult> {
  const slug = server.metadata?.slug ?? "";
  const serverOrg = server.metadata?.org ?? "";
  refuseOrganizationSignInSave(server);
  const declarations = server.spec?.env ?? {};
  const fields: Record<string, CredentialField> = {};
  for (const [key, value] of Object.entries(values)) {
    const declared = declarations[key];
    fields[key] = create(CredentialFieldSchema, {
      value,
      plain: declared !== undefined && !declared.isSecret,
    });
  }

  const listed = await api.list(
    create(ListCredentialsInputSchema, {
      org,
      pageInfo: create(PageInfoSchema, { num: 1, size: LIST_PAGE_SIZE }),
    }),
  );
  // A listing holds only the caller's own person credentials, never
  // another person's, so a person-owned row here is the caller's.
  const existing = listed.items.find(
    (credential) =>
      credential.spec?.owner.case === "person" && servesServer(credential, serverOrg, slug),
  );

  if (existing !== undefined) {
    const updated = await api.setFields(
      create(SetCredentialFieldsInputSchema, { credentialId: existing.metadata?.id ?? "", fields }),
    );
    return describeCredential(
      CommandResult.success(`Saved to your credential '${nameOf(updated)}'`),
      updated,
    );
  }
  const created = await api.create(
    create(CredentialSchema, {
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "Credential",
      metadata: { name: server.metadata?.name || slug, org },
      spec: create(CredentialSpecSchema, {
        owner: { case: "person", value: "" },
        fields,
        serves: [
          create(CredentialTargetSchema, {
            target: {
              case: "mcpServer",
              value: create(ApiResourceReferenceSchema, {
                org: serverOrg,
                slug,
                kind: ApiResourceKind.mcp_server,
              }),
            },
          }),
        ],
      }),
    }),
  );
  return describeCredential(
    CommandResult.success(`Saved as your credential '${nameOf(created)}'`),
    created,
  );
}

/**
 * Refuses saving a person's own credential for a server whose sign-in is
 * the organization's: the run rule reads only the organization's credential
 * for it, so a person's would never be used.
 */
export function refuseOrganizationSignInSave(server: McpServer): void {
  if (server.spec?.signIn !== McpServerSignIn.organization) return;
  const slug = server.metadata?.slug ?? "";
  throw new UsageError(
    `MCP server '${slug}' uses one account for the whole organization, so a credential of your own would never be used.\n\n` +
      `An admin saves the organization's instead:\n` +
      `  stigmer credential create "${server.metadata?.name || slug}" --org-owned --serves mcp-server:${slug} --field KEY=VALUE`,
  );
}

function servesServer(credential: Credential, org: string, slug: string): boolean {
  return (credential.spec?.serves ?? []).some(
    (target) =>
      target.target.case === "mcpServer" &&
      target.target.value.slug === slug &&
      (target.target.value.org === "" || target.target.value.org === org),
  );
}

async function loadCredential(api: CredentialApi, ref: string, org: string): Promise<Credential> {
  const parsed = parseReference(ref, org, CREDENTIAL_ID_PREFIX);
  return parsed.kind === "id"
    ? api.get(parsed.id)
    : api.getByReference({ org: parsed.org, slug: parsed.slug });
}

/** Add the credential's identity, owner, field names and targets to a result. */
function describeCredential(result: CommandResult, credential: Credential): CommandResult {
  const section = result.addSection();
  section.field("ID", credential.metadata?.id ?? "");
  section.field("Slug", credential.metadata?.slug ?? "");
  section.field("Owner", ownerWords(credential));
  section.field("Fields", fieldWords(credential));
  const serves = (credential.spec?.serves ?? []).map(targetWords);
  section.field("Serves", serves.length === 0 ? "-" : serves.join(", "));
  return result;
}

function ownerWords(credential: Credential): string {
  const owner = credential.spec?.owner ?? { case: undefined };
  switch (owner.case) {
    case "person":
      return "you";
    case "org":
      return "the organization";
    case undefined:
      return "-";
    default: {
      const exhaustive: never = owner;
      throw new Error(`unknown credential owner: ${JSON.stringify(exhaustive)}`);
    }
  }
}

function fieldWords(credential: Credential): string {
  const entries = Object.entries(credential.spec?.fields ?? {});
  if (entries.length === 0) return "-";
  return entries
    .map(([name, field]) => (field.plain ? `${name} (plain)` : name))
    .sort()
    .join(", ");
}

/** A target as the CLI writes it in `--serves`. */
export function targetWords(target: CredentialTarget): string {
  const t = target.target;
  switch (t.case) {
    case "agent":
      return `agent:${t.value.slug}`;
    case "mcpServer":
      return `mcp-server:${t.value.slug}`;
    case "gitHost":
      return `git-host:${t.value}`;
    case undefined:
      return "-";
    default: {
      const exhaustive: never = t;
      throw new Error(`unknown credential target: ${JSON.stringify(exhaustive)}`);
    }
  }
}

function nameOf(credential: Credential): string {
  return credential.metadata?.name || credential.metadata?.slug || "";
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
