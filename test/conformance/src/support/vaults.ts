// Canonical Vault fixtures and blueprint declarations for the conformance suite.
// Domain: conformance support.
//
// A vault holds logins (by a tool's address) and secrets (by name) that runs
// use. Values are write-only for everyone: every read shows entry names,
// addresses and metadata, never a value. A shared vault is created by name
// (empty, owned by its organization); a person's My vault is created by the
// server on their first entry write naming `mine`. The builders here are the
// create shapes; entry writes are composed with the request helpers below so
// each suite says which vault it writes.
//
// Blueprint env-var declarations (what an Agent or McpServer puts in its
// spec.env) live here too: EnvVarDeclaration belongs to the vault package. A
// declaration carries no person's value; a secret is found in a vault by its
// name when a run starts, and a plain setting may carry a default `value`.
import type { InitShape } from "./init-shape";
import { VaultSchema } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/api_pb";
import type { EnvVarDeclarationSchema } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/declaration_pb";
import type {
  RemoveVaultConnectionsInputSchema,
  RemoveVaultSecretsInputSchema,
  SetVaultConnectionInputSchema,
  SetVaultSecretsInputSchema,
  VaultTargetSchema,
} from "@stigmer/protos/ai/stigmer/agentic/vault/v1/io_pb";

export const VAULT_API_VERSION = "agentic.stigmer.ai/v1";
export const VAULT_KIND = "Vault";

// A single blueprint env-var declaration. `optional` defaults to false: a
// required key that no vault holds refuses the run's create. `value` is a
// plain setting's default and is refused on a secret declaration.
export interface EnvVarDeclarationInit {
  isSecret?: boolean;
  optional?: boolean;
  description?: string;
  value?: string;
}

// Projects a keyed map of declarations into the proto map<string,
// EnvVarDeclaration> init shape, with the same defaults on every field so the
// Agent and McpServer builders compose blueprint env maps identically.
export function makeEnvDeclarations(
  env: Record<string, EnvVarDeclarationInit>,
): Record<string, InitShape<typeof EnvVarDeclarationSchema>> {
  return Object.fromEntries(
    Object.entries(env).map(([key, decl]) => [
      key,
      {
        isSecret: decl.isSecret ?? false,
        optional: decl.optional ?? false,
        description: decl.description ?? "",
        value: decl.value ?? "",
      },
    ]),
  );
}

export interface SharedVaultOptions {
  org: string;
  name: string;
  description?: string;
  externalId?: string;
}

// A shared vault's create shape: its organization owns it and it starts empty.
export function makeSharedVault(opts: SharedVaultOptions): InitShape<typeof VaultSchema> {
  return {
    apiVersion: VAULT_API_VERSION,
    kind: VAULT_KIND,
    metadata: { name: opts.name, org: opts.org },
    spec: {
      description: opts.description ?? "conformance fixture",
      externalId: opts.externalId ?? "",
    },
  };
}

// The caller's own My vault in an organization, as an entry write names it.
export function myVaultTarget(org: string): InitShape<typeof VaultTargetSchema> {
  return { org, vault: { case: "mine", value: true } };
}

// A vault by id, as an entry write names it.
export function vaultTarget(org: string, id: string): InitShape<typeof VaultTargetSchema> {
  return { org, vault: { case: "id", value: id } };
}

// Saves secrets by name into the target vault.
export function setSecretsInput(
  target: InitShape<typeof VaultTargetSchema>,
  secrets: Record<string, string>,
): InitShape<typeof SetVaultSecretsInputSchema> {
  return {
    vault: target,
    secrets: Object.fromEntries(
      Object.entries(secrets).map(([name, value]) => [name, { value, description: "" }]),
    ),
  };
}

// Removes secrets by name from the target vault.
export function removeSecretsInput(
  target: InitShape<typeof VaultTargetSchema>,
  names: string[],
): InitShape<typeof RemoveVaultSecretsInputSchema> {
  return { vault: target, names };
}

// Saves a login at an address (a tool's URL or a Git host) into the target vault.
export function setConnectionInput(
  target: InitShape<typeof VaultTargetSchema>,
  address: string,
  token: string,
): InitShape<typeof SetVaultConnectionInputSchema> {
  return { vault: target, address, token, description: "" };
}

// Removes logins by address from the target vault.
export function removeConnectionsInput(
  target: InitShape<typeof VaultTargetSchema>,
  addresses: string[],
): InitShape<typeof RemoveVaultConnectionsInputSchema> {
  return { vault: target, addresses };
}
