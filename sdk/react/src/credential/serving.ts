/**
 * Saving values a person typed where their next runs will find them: in
 * the person's own credential that serves the declarer.
 *
 * The resolver fills requirement K of declarer D from the person's own
 * credential serving D, so a value typed for D lands there: as new or
 * replaced fields of the credential that already serves D (`setFields`,
 * which keeps every other field), or in a new credential of the person's,
 * named after D, serving D alone. A person's credential needs its owner
 * named by the person's identity account id, read once through `whoAmI`.
 *
 * An MCP server with organization sign-in takes the organization's
 * credential serving it instead, so a value for such a server is saved
 * there (`owner: "org"`), which only an admin may do.
 *
 * The credentials are read fresh before each save, never from a list a
 * component loaded earlier: the one-default-per-target rule refuses a
 * second credential serving D, so deciding create-or-set from a stale
 * list would turn a person's second save into an error.
 *
 * Pinned by `__tests__/serving.test.ts`.
 */
import { create } from "@bufbuild/protobuf";
import type { Credential } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/api_pb";
import {
  ListCredentialsInputSchema,
  SetCredentialFieldsInputSchema,
} from "@stigmer/protos/ai/stigmer/agentic/credential/v1/io_pb";
import { CredentialFieldSchema } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/spec_pb";
import type { CredentialFieldInput, EnvVarInput, Stigmer } from "@stigmer/sdk";
import {
  servingCredential,
  toTargetInput,
  type CredentialOwnerKind,
  type CredentialTargetRef,
} from "./model.js";

/** Every credential the caller may see in `org`: their own and the organization's they may use. */
export async function listCredentials(stigmer: Stigmer, org: string): Promise<Credential[]> {
  const list = await stigmer.credential.list(create(ListCredentialsInputSchema, { org }));
  return list.items;
}

/**
 * The credentials for a readiness reading: a list that cannot be read
 * reads as holding nothing, so the person is asked for what a run needs
 * rather than told it is ready when the server would refuse it. A save
 * still reads the list strictly ({@link saveToServingCredential}).
 */
export async function listCredentialsForReading(
  stigmer: Stigmer,
  org: string,
): Promise<Credential[]> {
  try {
    return await listCredentials(stigmer, org);
  } catch {
    return [];
  }
}

/** The caller's identity account id, the owner a credential of theirs names. */
export async function myPersonId(stigmer: Stigmer): Promise<string> {
  const account = await stigmer.identityAccount.whoAmI();
  const id = account.metadata?.id ?? "";
  if (id === "") {
    throw new Error(
      "Your account could not be read, so a credential of yours cannot be saved. Sign in again and retry.",
    );
  }
  return id;
}

/** A typed value as a credential field: secret unless it was typed as plain. */
export function toCredentialField(value: EnvVarInput): CredentialFieldInput {
  return {
    value: value.value,
    plain: value.isSecret === false ? true : undefined,
    description: value.description || undefined,
  };
}

/** Input for {@link saveToServingCredential}. */
export interface SaveToServingCredentialInput {
  /** The organization the credential lives in (the run's). */
  readonly org: string;
  /** The declarer the values are for. */
  readonly target: CredentialTargetRef;
  /** The name a new credential takes: the declarer's ("Linear", "PR reviewer"). */
  readonly name: string;
  /** The values, by key. */
  readonly values: Readonly<Record<string, EnvVarInput>>;
  /** Whose credential: the caller's own (the default) or the organization's. */
  readonly owner?: CredentialOwnerKind;
}

/**
 * Saves `values` into the credential of `owner` (the caller's own by
 * default) serving `target`, creating one named `name` when none serves it. Resolves with the
 * credential as stored (secrets redacted).
 */
export async function saveToServingCredential(
  stigmer: Stigmer,
  input: SaveToServingCredentialInput,
): Promise<Credential> {
  const keys = Object.keys(input.values);
  if (keys.length === 0) {
    throw new Error("saveToServingCredential: there are no values to save.");
  }
  const credentials = await listCredentials(stigmer, input.org);
  const owner = input.owner ?? "person";
  const existing = servingCredential(credentials, input.target, owner);
  if (existing?.metadata?.id) {
    return stigmer.credential.setFields(
      create(SetCredentialFieldsInputSchema, {
        credentialId: existing.metadata.id,
        fields: Object.fromEntries(
          keys.map((key) => {
            const value = input.values[key]!;
            return [
              key,
              create(CredentialFieldSchema, {
                value: value.value,
                plain: value.isSecret === false,
                description: value.description ?? "",
              }),
            ];
          }),
        ),
      }),
    );
  }
  const person = owner === "person" ? await myPersonId(stigmer) : undefined;
  return stigmer.credential.create({
    name: input.name,
    org: input.org,
    ...(person !== undefined ? { person } : {}),
    fields: Object.fromEntries(keys.map((key) => [key, toCredentialField(input.values[key]!)])),
    serves: [toTargetInput(input.target)],
  });
}
