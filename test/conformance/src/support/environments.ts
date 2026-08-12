// Canonical valid Environment fixtures for the conformance suite.
// Domain: conformance support.
//
// Environment is a flat (non-versioned) platform resource whose spec.data holds
// configuration and secret values keyed by name. Each EnvironmentValue carries
// an is_secret flag; secret values are redacted on read in BOTH editions
// (edition-converged since stigmer#405 — OSS encrypts at rest and redacts
// exactly like cloud; getSecretValue is the reveal path).
//
// The canonical builder is deliberately SECRET-FREE: a plain-only environment
// keeps the create-vs-get parity check edition-stable (secret values would
// diverge the moment a redacting target reads them back). Secret-bearing
// variants are opt-in via `data`, so the dedicated secret tests compose them
// explicitly while CRUD/parity tests stay clean.
//
// Negative cases (duplicate, missing name, wrong const fields) are written
// inline in the suite, matching the convention in support/agents.ts and
// support/skills.ts.
import type { MessageInitShape } from "@bufbuild/protobuf";
import { EnvironmentSchema } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/api_pb";
import type { EnvVarDeclarationSchema } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/spec_pb";
import { EnvironmentSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/spec_pb";
import type { ApiResourceReferenceSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

export const ENVIRONMENT_API_VERSION = "agentic.stigmer.ai/v1";
export const ENVIRONMENT_KIND = "Environment";

// A single blueprint env-var *declaration* — the whitelist entry a Workflow or
// Agent puts in its spec.env. Unlike EnvironmentValue it carries no value: the
// blueprint layer is a key whitelist + required/optional schema, never a value
// source (see backend/libs/go/envmerge). `optional` defaults to false, meaning
// the key is required (its absence after merge is a warn-only path, not a hard
// failure). Lives here because EnvVarDeclaration is defined in environment/v1.
export interface EnvVarDeclarationInit {
  isSecret?: boolean;
  optional?: boolean;
  description?: string;
}

// Projects a keyed map of declarations into the proto map<string, EnvVarDeclaration>
// init shape, applying the same defaults on every field so blueprint env maps are
// composed identically by the Workflow and Agent builders.
export function makeEnvDeclarations(
  env: Record<string, EnvVarDeclarationInit>,
): Record<string, MessageInitShape<typeof EnvVarDeclarationSchema>> {
  return Object.fromEntries(
    Object.entries(env).map(([key, decl]) => [
      key,
      { isSecret: decl.isSecret ?? false, optional: decl.optional ?? false, description: decl.description ?? "" },
    ]),
  );
}

// A reference to an Environment resource by org + slug, as carried in an
// instance's environment_refs. An explicit org is required because the execution
// engine resolves each ref via GetByReference on org/slug (see resolveEnvironments
// in create_execution_context_step.go) rather than normalizing an empty org.
export interface EnvironmentRefInit {
  org: string;
  slug: string;
}

// Projects environment references into the proto ApiResourceReference init shape,
// fixing kind to environment (the CEL constraint on WorkflowInstanceSpec /
// AgentInstanceSpec environment_refs). Shared by both instance builders.
export function makeEnvironmentRefs(
  refs: EnvironmentRefInit[],
): MessageInitShape<typeof ApiResourceReferenceSchema>[] {
  return refs.map((ref) => ({ org: ref.org, slug: ref.slug, kind: ApiResourceKind.environment }));
}

// A single spec.data entry. `value` is the configuration or secret string;
// `isSecret` flips secret handling; `description` is optional human context.
export interface EnvironmentValueInit {
  value: string;
  isSecret?: boolean;
  description?: string;
}

export interface EnvironmentSpecOptions {
  // Human-readable description; defaults to a stable placeholder.
  description?: string;
  // spec.data entries keyed by variable name. Defaults to one plain (non-secret)
  // variable so the canonical environment is parity-stable across editions.
  data?: Record<string, EnvironmentValueInit>;
}

// A valid EnvironmentSpec. By default it carries one plain variable; pass `data`
// to compose plain and/or secret entries for the secret-handling tests.
export function makeEnvironmentSpec(opts: EnvironmentSpecOptions = {}): MessageInitShape<typeof EnvironmentSpecSchema> {
  const data = opts.data ?? { PLAIN_KEY: { value: "plain-value" } };
  return {
    description: opts.description ?? "conformance fixture",
    data: Object.fromEntries(
      Object.entries(data).map(([key, entry]) => [
        key,
        { value: entry.value, isSecret: entry.isSecret ?? false, description: entry.description ?? "" },
      ]),
    ),
  };
}

export interface EnvironmentOptions extends EnvironmentSpecOptions {
  org: string;
  name: string;
}

// A complete, valid Environment resource ready to hand to create/apply/update.
export function makeEnvironment(opts: EnvironmentOptions): MessageInitShape<typeof EnvironmentSchema> {
  const { org, name, description, data } = opts;
  return {
    apiVersion: ENVIRONMENT_API_VERSION,
    kind: ENVIRONMENT_KIND,
    metadata: { name, org },
    spec: makeEnvironmentSpec({ description, data }),
  };
}
