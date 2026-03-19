"use client";

import { useMemo } from "react";
import type { Environment } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/api_pb";
import { useEnvironmentList } from "./useEnvironmentList";

const PERSONAL_LABELS: Record<string, string> = {
  "stigmer.ai/personal": "true",
};

export interface UsePersonalEnvironmentReturn {
  readonly environment: Environment | null;
  readonly isLoading: boolean;
  readonly error: string | null;
  readonly refetch: () => void;
}

/**
 * Convenience hook that fetches the caller's personal {@link Environment}
 * for a given organization.
 *
 * Wraps {@link useEnvironmentList} with the `stigmer.ai/personal: "true"`
 * label filter and extracts the single expected result. The invariant
 * (at most one personal environment per org per user) is enforced at
 * creation time — this hook simply queries what exists.
 *
 * Pass `null` as `org` to skip fetching (stable no-op).
 *
 * Secret values are redacted server-side; use `useRevealSecretValue`
 * to retrieve individual secret values on demand.
 *
 * @example
 * ```tsx
 * const { environment, isLoading } = usePersonalEnvironment("acme");
 *
 * if (environment) {
 *   // environment.spec.data contains key-value pairs (secrets redacted)
 * }
 * ```
 */
export function usePersonalEnvironment(
  org: string | null,
): UsePersonalEnvironmentReturn {
  const { environments, isLoading, error, refetch } = useEnvironmentList(
    org,
    PERSONAL_LABELS,
  );

  const environment = useMemo(
    () => environments[0] ?? null,
    [environments],
  );

  return { environment, isLoading, error, refetch };
}
