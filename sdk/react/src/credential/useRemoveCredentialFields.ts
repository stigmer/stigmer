"use client";

/**
 * useRemoveCredentialFields: remove fields of a credential by name,
 * keeping the rest. Names the credential does not hold are ignored.
 * Refused on a credential an MCP server sign-in saved: signing out is how
 * that one ends.
 */
import { useCallback } from "react";
import { create } from "@bufbuild/protobuf";
import type { Credential } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/api_pb";
import { RemoveCredentialFieldsInputSchema } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/io_pb";
import { useStigmer } from "../hooks.js";
import { useCredentialMutation } from "./useCredentialMutation.js";

/** Input for {@link UseRemoveCredentialFieldsReturn.removeFields}. */
export interface RemoveCredentialFieldsInput {
  /** The credential's id. */
  readonly credentialId: string;
  /** The names of the fields to remove. */
  readonly fields: readonly string[];
}

/** Return value of {@link useRemoveCredentialFields}. */
export interface UseRemoveCredentialFieldsReturn {
  /** Remove the fields. Resolves with the credential as stored. */
  readonly removeFields: (input: RemoveCredentialFieldsInput) => Promise<Credential>;
  /** `true` while the removal is in flight. */
  readonly isRemoving: boolean;
  /** Error from the last failed removal, or `null`. */
  readonly error: Error | null;
  /** Reset `error` to `null`. */
  readonly clearError: () => void;
}

/**
 * Behaviour hook that removes fields of a credential.
 *
 * @example
 * ```tsx
 * const { removeFields } = useRemoveCredentialFields();
 * await removeFields({ credentialId, fields: ["OLD_TOKEN"] });
 * ```
 */
export function useRemoveCredentialFields(): UseRemoveCredentialFieldsReturn {
  const stigmer = useStigmer();
  const call = useCallback(
    (input: RemoveCredentialFieldsInput): Promise<Credential> =>
      stigmer.credential.removeFields(
        create(RemoveCredentialFieldsInputSchema, {
          credentialId: input.credentialId,
          fields: [...input.fields],
        }),
      ),
    [stigmer],
  );
  const { run, isPending, error, clearError } = useCredentialMutation(call);
  return { removeFields: run, isRemoving: isPending, error, clearError };
}
