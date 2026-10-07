// Canonical valid Credential fixtures for the conformance suite.
// Domain: conformance support.
//
// A Credential is a saved set of values that belongs to a person or to the
// organization (spec.owner, fixed at create). Each field fills the
// requirement with the same name of an agent, MCP server or git host the
// credential serves (spec.serves) or is assigned to on a surface (a
// schedule, share, channel or platform client's `credentials`). Secret
// fields rest encrypted and leave the server as the redaction marker; a
// person reveals their own credential's fields one at a time, and an
// organization's credential is write-only.
//
// The canonical builder holds one PLAIN field, so a create-vs-get parity
// check is not disturbed by redaction; secret fields are opt-in via
// `fields`, which the secret arms compose explicitly.
//
// A requirement is declared, never valued, on the blueprint: an Agent's or
// McpServer's spec.env maps a key to an EnvVarDeclaration (whether it is a
// secret, whether it may be absent). `makeEnvDeclarations` projects those,
// shared by the agent and MCP server builders.
//
// Negative cases (a marker on create, a ciphertext-shaped value, an owner
// naming someone else) are written inline in the suites, matching the
// convention of every builder in support/.
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { CredentialSchema } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/api_pb";
import type {
  CredentialAssignmentSchema,
  CredentialTargetSchema,
  EnvVarDeclarationSchema,
} from "@stigmer/protos/ai/stigmer/agentic/credential/v1/requirement_pb";
import type {
  CredentialFieldSchema,
  CredentialSpecSchema,
} from "@stigmer/protos/ai/stigmer/agentic/credential/v1/spec_pb";
import type { InitShape } from "./init-shape";

export const CREDENTIAL_API_VERSION = "agentic.stigmer.ai/v1";
export const CREDENTIAL_KIND = "Credential";

// The marker every non-empty secret field value leaves the server as. A
// client sending it BACK on update means "keep the stored value"; on a
// create, or for a field that held no secret, it is refused. A documented
// wire contract, not a proto field.
export const REDACTED_MARKER = "***REDACTED***";

// A requirement an Agent or McpServer declares in spec.env. It carries no
// value: a run's value for the key comes from runtime_env, an assignment on
// the surface that started it, or the default credential of the run's
// person. `optional` defaults to false: a required key nothing provides
// refuses the run's create.
export interface EnvVarDeclarationInit {
  isSecret?: boolean;
  optional?: boolean;
  description?: string;
}

// Projects a keyed map of declarations into the proto map<string,
// EnvVarDeclaration> init shape, with the same defaults on every field so
// the Agent and McpServer builders compose env maps identically.
export function makeEnvDeclarations(
  env: Record<string, EnvVarDeclarationInit>,
): Record<string, InitShape<typeof EnvVarDeclarationSchema>> {
  return Object.fromEntries(
    Object.entries(env).map(([key, decl]) => [
      key,
      { isSecret: decl.isSecret ?? false, optional: decl.optional ?? false, description: decl.description ?? "" },
    ]),
  );
}

// One field of a credential. A field is a secret unless `plain` is set.
export interface CredentialFieldInit {
  value: string;
  plain?: boolean;
  description?: string;
}

// Who a credential belongs to. "person" is the caller (the server fills the
// empty person); "org" is the credential's own organization. `{ person }`
// names a person explicitly, which the server accepts only for the caller.
export type CredentialOwnerInit = "person" | "org" | { person: string };

// A reference to an agent or MCP server, as a credential names what it
// serves: its organization and slug.
export interface ResourceRefInit {
  org: string;
  slug: string;
}

// What a credential serves, or a requirement's declarer: an agent, an MCP
// server, or a git host.
export function agentTarget(ref: ResourceRefInit): InitShape<typeof CredentialTargetSchema> {
  return { target: { case: "agent", value: { kind: ApiResourceKind.agent, org: ref.org, slug: ref.slug } } };
}

export function mcpServerTarget(ref: ResourceRefInit): InitShape<typeof CredentialTargetSchema> {
  return {
    target: { case: "mcpServer", value: { kind: ApiResourceKind.mcp_server, org: ref.org, slug: ref.slug } },
  };
}

export function gitHostTarget(host: string): InitShape<typeof CredentialTargetSchema> {
  return { target: { case: "gitHost", value: host } };
}

// The reference of a created resource, for a target builder.
export function refOf(resource: { metadata?: { org?: string; slug?: string } }): ResourceRefInit {
  return { org: resource.metadata?.org ?? "", slug: resource.metadata?.slug ?? "" };
}

export interface CredentialSpecOptions {
  owner?: CredentialOwnerInit;
  description?: string;
  // Fields by name. Defaults to one plain field, so the canonical credential
  // is parity-stable on every read.
  fields?: Record<string, CredentialFieldInit>;
  serves?: InitShape<typeof CredentialTargetSchema>[];
}

function ownerInit(owner: CredentialOwnerInit): InitShape<typeof CredentialSpecSchema>["owner"] {
  if (owner === "person") return { case: "person", value: "" };
  if (owner === "org") return { case: "org", value: "" };
  return { case: "person", value: owner.person };
}

export function makeCredentialFields(
  fields: Record<string, CredentialFieldInit>,
): Record<string, InitShape<typeof CredentialFieldSchema>> {
  return Object.fromEntries(
    Object.entries(fields).map(([name, field]) => [
      name,
      { value: field.value, plain: field.plain ?? false, description: field.description ?? "" },
    ]),
  );
}

// A valid CredentialSpec: a person's own by default, with one plain field.
export function makeCredentialSpec(opts: CredentialSpecOptions = {}): InitShape<typeof CredentialSpecSchema> {
  return {
    owner: ownerInit(opts.owner ?? "person"),
    description: opts.description ?? "conformance fixture",
    fields: makeCredentialFields(opts.fields ?? { PLAIN_FIELD: { value: "plain-value", plain: true } }),
    serves: opts.serves ?? [],
  };
}

export interface CredentialOptions extends CredentialSpecOptions {
  org: string;
  name: string;
}

// A complete, valid Credential ready to hand to create or update.
export function makeCredential(opts: CredentialOptions): InitShape<typeof CredentialSchema> {
  const { org, name, ...spec } = opts;
  return {
    apiVersion: CREDENTIAL_API_VERSION,
    kind: CREDENTIAL_KIND,
    metadata: { name, org },
    spec: makeCredentialSpec(spec),
  };
}

// An assignment on a surface that starts runs with no person behind them:
// the requirement (`key` of `declarer`) takes the credential's field (the
// field named like the key when `field` is omitted). The writer is the
// server's to stamp.
export function assignCredential(opts: {
  declarer: InitShape<typeof CredentialTargetSchema>;
  key: string;
  credential: ResourceRefInit;
  field?: string;
}): InitShape<typeof CredentialAssignmentSchema> {
  return {
    requirement: { declarer: opts.declarer, key: opts.key },
    source: {
      case: "credential",
      value: {
        credential: { kind: ApiResourceKind.credential, org: opts.credential.org, slug: opts.credential.slug },
        field: opts.field ?? "",
      },
    },
  };
}

// An assignment of a plain literal value, written on the surface itself.
export function assignLiteral(opts: {
  declarer: InitShape<typeof CredentialTargetSchema>;
  key: string;
  value: string;
}): InitShape<typeof CredentialAssignmentSchema> {
  return {
    requirement: { declarer: opts.declarer, key: opts.key },
    source: { case: "literal", value: opts.value },
  };
}
