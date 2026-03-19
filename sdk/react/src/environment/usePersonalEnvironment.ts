"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { create } from "@bufbuild/protobuf";
import type { EnvVarInput } from "@stigmer/sdk";
import type { Environment } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/api_pb";
import {
  UpdateEnvironmentVariablesRequestSchema,
  RemoveEnvironmentVariablesRequestSchema,
} from "@stigmer/protos/ai/stigmer/agentic/environment/v1/io_pb";
import { EnvironmentValueSchema } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/spec_pb";
import { useStigmer } from "../hooks";
import { useEnvironmentList } from "./useEnvironmentList";

const PERSONAL_LABELS: Record<string, string> = {
  "stigmer.ai/personal": "true",
};

export interface UsePersonalEnvironmentReturn {
  /** The caller's personal environment, or `null` if not yet created or still loading. */
  readonly environment: Environment | null;
  /** `true` while the initial list query is in-flight. */
  readonly isLoading: boolean;
  /** Error message from the most recent failed operation (fetch or mutation), or `null`. */
  readonly error: string | null;
  /** Re-query the personal environment from the server. */
  readonly refetch: () => void;

  /**
   * Ensure a personal environment exists for this org.
   *
   * If one already exists, returns it immediately without a network call.
   * Otherwise, creates a new environment with slug `"personal"` and
   * label `stigmer.ai/personal: "true"`, optionally seeded with initial data.
   *
   * @param initialData - Key-value pairs to include on creation. Ignored
   *   if the personal environment already exists. Use {@link addVariables}
   *   to merge variables into an existing environment.
   * @returns The personal environment (existing or newly created).
   */
  readonly getOrCreate: (
    initialData?: Record<string, EnvVarInput>,
  ) => Promise<Environment>;

  /**
   * Add or update variables in the personal environment via server-side merge.
   *
   * Only the supplied keys are affected — existing variables not mentioned
   * are preserved unchanged. Secret values are encrypted server-side.
   *
   * Requires the personal environment to exist. Call {@link getOrCreate}
   * first if it may not.
   *
   * @param variables - Variables to add or update.
   * @returns The updated environment (secrets redacted).
   */
  readonly addVariables: (
    variables: Record<string, EnvVarInput>,
  ) => Promise<Environment>;

  /**
   * Remove variables from the personal environment by key.
   *
   * Keys that do not exist are silently ignored. Variables not mentioned
   * are preserved unchanged.
   *
   * Requires the personal environment to exist. Call {@link getOrCreate}
   * first if it may not.
   *
   * @param keys - Keys to remove from the environment's data.
   * @returns The updated environment (secrets redacted).
   */
  readonly removeVariables: (keys: string[]) => Promise<Environment>;

  /** `true` while any mutation (`getOrCreate`, `addVariables`, `removeVariables`) is in-flight. */
  readonly isMutating: boolean;
}

/**
 * Layer 2 orchestration hook that manages the caller's personal
 * {@link Environment} for a given organization.
 *
 * Encapsulates the "personal environment" convention: deterministic
 * slug (`"personal"`), label (`stigmer.ai/personal: "true"`), and
 * the get-or-create lifecycle. Composes {@link useEnvironmentList}
 * for declarative reading and the SDK client directly for mutations.
 *
 * Pass `null` as `org` to skip all operations (stable no-op).
 *
 * This is a Layer 2 **Environment Flow** hook. It provides the managed
 * "personal environment" experience used by the Stigmer Console and
 * any app that wants automatic credential storage. Callers who manage
 * environments programmatically should use the Layer 1 building-block
 * hooks instead:
 * - {@link useCreateEnvironment} — create any environment
 * - {@link useUpdateEnvironmentVariables} — incremental variable merge
 * - {@link useRemoveEnvironmentVariables} — remove variables by key
 *
 * @example
 * ```tsx
 * // Basic usage — read the personal environment
 * const { environment, isLoading } = usePersonalEnvironment("acme");
 *
 * // Get-or-create with initial data on first use
 * const { getOrCreate, addVariables, isMutating } =
 *   usePersonalEnvironment("acme");
 *
 * const env = await getOrCreate({
 *   GITHUB_TOKEN: { value: "ghp_...", isSecret: true },
 * });
 *
 * // Add variables to an existing personal environment
 * await addVariables({
 *   SLACK_TOKEN: { value: "xoxb-...", isSecret: true },
 * });
 * ```
 */
export function usePersonalEnvironment(
  org: string | null,
): UsePersonalEnvironmentReturn {
  const stigmer = useStigmer();
  const { environments, isLoading, error: listError, refetch } =
    useEnvironmentList(org, PERSONAL_LABELS);

  const environment = useMemo(
    () => environments[0] ?? null,
    [environments],
  );

  const [isMutating, setIsMutating] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);

  // Stable ref to environment so mutation callbacks always see the latest
  // without being recreated on every list response.
  const environmentRef = useRef(environment);
  environmentRef.current = environment;

  const error = mutationError ?? listError;

  const getOrCreate = useCallback(
    async (
      initialData?: Record<string, EnvVarInput>,
    ): Promise<Environment> => {
      if (environmentRef.current) return environmentRef.current;

      if (!org) {
        throw new Error(
          "usePersonalEnvironment: cannot call getOrCreate when org is null.",
        );
      }

      setIsMutating(true);
      setMutationError(null);

      try {
        let data: Record<string, EnvVarInput> | undefined;
        if (initialData && Object.keys(initialData).length > 0) {
          data = initialData;
        }

        const created = await stigmer.environment.create({
          name: "personal",
          org,
          labels: PERSONAL_LABELS,
          data,
        });

        refetch();
        return created;
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : "Failed to create personal environment";
        setMutationError(message);
        throw err;
      } finally {
        setIsMutating(false);
      }
    },
    [org, stigmer, refetch],
  );

  const addVariables = useCallback(
    async (
      variables: Record<string, EnvVarInput>,
    ): Promise<Environment> => {
      const env = environmentRef.current;
      if (!env) {
        throw new Error(
          "usePersonalEnvironment: personal environment does not exist. " +
            "Call getOrCreate() before addVariables().",
        );
      }

      setIsMutating(true);
      setMutationError(null);

      try {
        const protoVars = Object.fromEntries(
          Object.entries(variables).map(([k, v]) => [
            k,
            create(EnvironmentValueSchema, {
              value: v.value,
              isSecret: v.isSecret,
              description: v.description,
            }),
          ]),
        );

        const request = create(UpdateEnvironmentVariablesRequestSchema, {
          environmentId: env.metadata!.id,
          variables: protoVars,
        });

        const updated = await stigmer.environment.updateVariables(request);
        refetch();
        return updated;
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : "Failed to add variables to personal environment";
        setMutationError(message);
        throw err;
      } finally {
        setIsMutating(false);
      }
    },
    [stigmer, refetch],
  );

  const removeVariables = useCallback(
    async (keys: string[]): Promise<Environment> => {
      const env = environmentRef.current;
      if (!env) {
        throw new Error(
          "usePersonalEnvironment: personal environment does not exist. " +
            "Call getOrCreate() before removeVariables().",
        );
      }

      setIsMutating(true);
      setMutationError(null);

      try {
        const request = create(RemoveEnvironmentVariablesRequestSchema, {
          environmentId: env.metadata!.id,
          keys,
        });

        const updated = await stigmer.environment.removeVariables(request);
        refetch();
        return updated;
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : "Failed to remove variables from personal environment";
        setMutationError(message);
        throw err;
      } finally {
        setIsMutating(false);
      }
    },
    [stigmer, refetch],
  );

  return {
    environment,
    isLoading,
    error,
    refetch,
    getOrCreate,
    addVariables,
    removeVariables,
    isMutating,
  };
}
