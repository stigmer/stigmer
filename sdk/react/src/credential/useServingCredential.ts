"use client";

/**
 * useServingCredential: the caller's own credential (or the
 * organization's, for an MCP server with organization sign-in) for one
 * agent, MCP server or git host, and the two writes a connect flow needs: save typed
 * values into it (creating it, named after the target, when none serves
 * the target yet) and remove fields from it.
 *
 * This is the one place a value a person types "for GitHub" or "for
 * Linear" goes, so the next run that needs it finds it by the resolver's
 * own rule (the person's credential serving the declarer).
 */
import { useCallback, useMemo, useState } from "react";
import { create } from "@bufbuild/protobuf";
import type { Credential } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/api_pb";
import { RemoveCredentialFieldsInputSchema } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/io_pb";
import type { EnvVarInput } from "@stigmer/sdk";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";
import {
  servingCredential,
  targetRefKey,
  type CredentialOwnerKind,
  type CredentialTargetRef,
} from "./model.js";
import { saveToServingCredential } from "./serving.js";
import { useCredentialList } from "./useCredentialList.js";

/** Return value of {@link useServingCredential}. */
export interface UseServingCredentialReturn {
  /** The credential of the owner serving the target, or `null` when none does (or while loading). */
  readonly credential: Credential | null;
  /** `true` while the credentials are first read. */
  readonly isLoading: boolean;
  /** Error from the read or the last write, or `null`. */
  readonly error: Error | null;
  /** Re-read the credentials. */
  readonly refetch: () => void;
  /**
   * Save `values` into the credential serving the target, creating one
   * named `name` when none serves it. Resolves with the credential as stored.
   */
  readonly save: (values: Record<string, EnvVarInput>, name: string) => Promise<Credential>;
  /** Remove fields from the serving credential; resolves `null` when there is none. */
  readonly removeFields: (fields: readonly string[]) => Promise<Credential | null>;
  /** `true` while a write is in flight. */
  readonly isSaving: boolean;
}

/**
 * Behaviour hook over the credential of `owner` (the caller's own by
 * default) serving `target` in `org`. Pass `null` for either to skip.
 *
 * @example
 * ```tsx
 * const github = useServingCredential(org, { kind: "git_host", host: "github.com" });
 * await github.save({ GITHUB_TOKEN: { value: token, isSecret: true } }, "GitHub");
 * ```
 */
export function useServingCredential(
  org: string | null,
  target: CredentialTargetRef | null,
  owner: CredentialOwnerKind = "person",
): UseServingCredentialReturn {
  const stigmer = useStigmer();
  const list = useCredentialList(org && target ? org : null);
  const [isSaving, setIsSaving] = useState(false);
  const [writeError, setWriteError] = useState<Error | null>(null);

  // Stable across renders that name the same target with a new object.
  const targetKey = target ? targetRefKey(target) : "";
  const [held, setHeld] = useState({ key: targetKey, target });
  if (held.key !== targetKey) setHeld({ key: targetKey, target });
  const stableTarget = held.key === targetKey ? held.target : target;

  const credential = useMemo(
    () => (stableTarget ? (servingCredential(list.credentials, stableTarget, owner) ?? null) : null),
    [list.credentials, stableTarget, owner],
  );

  const { refetch } = list;

  const save = useCallback(
    async (values: Record<string, EnvVarInput>, name: string): Promise<Credential> => {
      if (!org || !stableTarget) {
        throw new Error("useServingCredential: cannot save without an organization and a target.");
      }
      setIsSaving(true);
      setWriteError(null);
      try {
        const saved = await saveToServingCredential(stigmer, {
          org,
          target: stableTarget,
          name,
          values,
          owner,
        });
        refetch();
        return saved;
      } catch (err) {
        setWriteError(toError(err));
        throw err;
      } finally {
        setIsSaving(false);
      }
    },
    [org, stableTarget, owner, stigmer, refetch],
  );

  const credentialId = credential?.metadata?.id ?? "";

  const removeFields = useCallback(
    async (fields: readonly string[]): Promise<Credential | null> => {
      if (credentialId === "" || fields.length === 0) return null;
      setIsSaving(true);
      setWriteError(null);
      try {
        const updated = await stigmer.credential.removeFields(
          create(RemoveCredentialFieldsInputSchema, { credentialId, fields: [...fields] }),
        );
        refetch();
        return updated;
      } catch (err) {
        setWriteError(toError(err));
        throw err;
      } finally {
        setIsSaving(false);
      }
    },
    [credentialId, stigmer, refetch],
  );

  return useMemo(
    () => ({
      credential,
      isLoading: list.isLoading,
      error: writeError ?? list.error,
      refetch,
      save,
      removeFields,
      isSaving,
    }),
    [credential, list.isLoading, writeError, list.error, refetch, save, removeFields, isSaving],
  );
}
