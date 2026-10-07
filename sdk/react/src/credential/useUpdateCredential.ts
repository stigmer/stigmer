"use client";

/**
 * useUpdateCredential: change a credential's name, description and what
 * it serves. The owner never changes, and fields are left as stored: the
 * update starts from the credential as read (secrets come back as the
 * redaction marker, which the server keeps), so a field the caller does
 * not name is never touched. Fields have their own hooks
 * (`useSetCredentialFields`, `useRemoveCredentialFields`).
 */
import { useCallback } from "react";
import type { Credential } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/api_pb";
import { toCredentialUpdateInput } from "@stigmer/sdk";
import { useStigmer } from "../hooks.js";
import { toTargetInput, type CredentialTargetRef } from "./model.js";
import { useCredentialMutation } from "./useCredentialMutation.js";

/** Input for {@link UseUpdateCredentialReturn.update}. */
export interface UpdateCredentialInput {
  /** The credential as read. */
  readonly credential: Credential;
  /** A new name; unchanged when omitted. */
  readonly name?: string;
  /** A new description; unchanged when omitted, cleared by `""`. */
  readonly description?: string;
  /** What it serves now; unchanged when omitted, cleared by `[]`. */
  readonly serves?: readonly CredentialTargetRef[];
}

/** Return value of {@link useUpdateCredential}. */
export interface UseUpdateCredentialReturn {
  /** Save the change. Resolves with the credential as stored. */
  readonly update: (input: UpdateCredentialInput) => Promise<Credential>;
  /** `true` while the save is in flight. */
  readonly isUpdating: boolean;
  /** Error from the last failed save, or `null`. */
  readonly error: Error | null;
  /** Reset `error` to `null`. */
  readonly clearError: () => void;
}

/**
 * Behaviour hook that updates a credential's name, description or
 * targets. A target another credential of the same owner already serves
 * is refused by the server, naming that credential.
 *
 * @example
 * ```tsx
 * const { update } = useUpdateCredential();
 * await update({ credential, serves: [{ kind: "git_host", host: "github.com" }] });
 * ```
 */
export function useUpdateCredential(): UseUpdateCredentialReturn {
  const stigmer = useStigmer();
  const call = useCallback(
    (input: UpdateCredentialInput): Promise<Credential> => {
      const base = toCredentialUpdateInput(input.credential);
      return stigmer.credential.update({
        ...base,
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description || undefined } : {}),
        ...(input.serves !== undefined ? { serves: input.serves.map(toTargetInput) } : {}),
      });
    },
    [stigmer],
  );
  const { run, isPending, error, clearError } = useCredentialMutation(call);
  return { update: run, isUpdating: isPending, error, clearError };
}
