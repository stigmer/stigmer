"use client";

/**
 * useCreateCredential: save a new credential, yours or the
 * organization's. A credential of yours names you as its owner by your
 * identity account id, read through `whoAmI` at save; the organization's
 * names the organization it is written in. The server asks the matching
 * permission (any member for their own, an admin for the organization's).
 */
import { useCallback } from "react";
import type { Credential } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/api_pb";
import type { CredentialFieldInput } from "@stigmer/sdk";
import { useStigmer } from "../hooks.js";
import { toTargetInput, type CredentialOwnerKind, type CredentialTargetRef } from "./model.js";
import { myPersonId } from "./serving.js";
import { useCredentialMutation } from "./useCredentialMutation.js";

/** Input for {@link UseCreateCredentialReturn.create}. */
export interface CreateCredentialInput {
  /** The organization the credential lives in (an id; a slug is also accepted). */
  readonly org: string;
  /** The name a person tells it apart by ("OpenAI"). */
  readonly name: string;
  /** What it is for, shown beside the name. */
  readonly description?: string;
  /** Whose it is: `"person"` is the caller's own, `"org"` the organization's (admins only). */
  readonly owner: CredentialOwnerKind;
  /** The values, by the key each fills. */
  readonly fields?: Readonly<Record<string, CredentialFieldInput>>;
  /** The agents, MCP servers and git hosts it is used for by default. */
  readonly serves?: readonly CredentialTargetRef[];
}

/** Return value of {@link useCreateCredential}. */
export interface UseCreateCredentialReturn {
  /** Save the credential. Resolves with it as stored, secrets redacted. */
  readonly create: (input: CreateCredentialInput) => Promise<Credential>;
  /** `true` while the save is in flight. */
  readonly isCreating: boolean;
  /** Error from the last failed save, or `null`. */
  readonly error: Error | null;
  /** Reset `error` to `null`. */
  readonly clearError: () => void;
}

/**
 * Behaviour hook that creates a credential.
 *
 * @example
 * ```tsx
 * const { create } = useCreateCredential();
 * await create({
 *   org: "acme",
 *   name: "OpenAI",
 *   owner: "person",
 *   fields: { OPENAI_API_KEY: { value: "sk-..." } },
 *   serves: [{ kind: "agent", org: agent.metadata.org, slug: agent.metadata.slug }],
 * });
 * ```
 */
export function useCreateCredential(): UseCreateCredentialReturn {
  const stigmer = useStigmer();
  const call = useCallback(
    async (input: CreateCredentialInput): Promise<Credential> => {
      const person = input.owner === "person" ? await myPersonId(stigmer) : undefined;
      return stigmer.credential.create({
        name: input.name,
        org: input.org,
        ...(person !== undefined ? { person } : {}),
        ...(input.description ? { description: input.description } : {}),
        ...(input.fields && Object.keys(input.fields).length > 0 ? { fields: { ...input.fields } } : {}),
        ...(input.serves && input.serves.length > 0 ? { serves: input.serves.map(toTargetInput) } : {}),
      });
    },
    [stigmer],
  );
  const { run, isPending, error, clearError } = useCredentialMutation(call);
  return { create: run, isCreating: isPending, error, clearError };
}
