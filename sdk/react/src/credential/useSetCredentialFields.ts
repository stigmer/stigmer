"use client";

/**
 * useSetCredentialFields: add or replace fields of a credential, keeping
 * every field not named. A field is secret unless marked plain: a secret
 * value rests encrypted and is never returned. Refused on a credential an
 * MCP server sign-in saved, whose values the platform keeps fresh.
 */
import { useCallback } from "react";
import { create } from "@bufbuild/protobuf";
import type { Credential } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/api_pb";
import { SetCredentialFieldsInputSchema } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/io_pb";
import { CredentialFieldSchema } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/spec_pb";
import type { CredentialFieldInput } from "@stigmer/sdk";
import { useStigmer } from "../hooks.js";
import { useCredentialMutation } from "./useCredentialMutation.js";

/** Input for {@link UseSetCredentialFieldsReturn.setFields}. */
export interface SetCredentialFieldsInput {
  /** The credential's id. */
  readonly credentialId: string;
  /** The fields to add or replace, by name. */
  readonly fields: Readonly<Record<string, CredentialFieldInput>>;
}

/** Return value of {@link useSetCredentialFields}. */
export interface UseSetCredentialFieldsReturn {
  /** Save the fields. Resolves with the credential as stored, secrets redacted. */
  readonly setFields: (input: SetCredentialFieldsInput) => Promise<Credential>;
  /** `true` while the save is in flight. */
  readonly isSaving: boolean;
  /** Error from the last failed save, or `null`. */
  readonly error: Error | null;
  /** Reset `error` to `null`. */
  readonly clearError: () => void;
}

/**
 * Behaviour hook that sets fields of a credential.
 *
 * @example
 * ```tsx
 * const { setFields } = useSetCredentialFields();
 * await setFields({ credentialId, fields: { LINEAR_API_KEY: { value: "lin_..." } } });
 * ```
 */
export function useSetCredentialFields(): UseSetCredentialFieldsReturn {
  const stigmer = useStigmer();
  const call = useCallback(
    (input: SetCredentialFieldsInput): Promise<Credential> =>
      stigmer.credential.setFields(
        create(SetCredentialFieldsInputSchema, {
          credentialId: input.credentialId,
          fields: Object.fromEntries(
            Object.entries(input.fields).map(([name, field]) => [
              name,
              create(CredentialFieldSchema, {
                value: field.value ?? "",
                plain: field.plain ?? false,
                description: field.description ?? "",
              }),
            ]),
          ),
        }),
      ),
    [stigmer],
  );
  const { run, isPending, error, clearError } = useCredentialMutation(call);
  return { setFields: run, isSaving: isPending, error, clearError };
}
