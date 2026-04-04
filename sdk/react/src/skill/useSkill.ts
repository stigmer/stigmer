"use client";

import { useCallback, useEffect, useState } from "react";
import type { Skill } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/api_pb";
import { isNotFound } from "@stigmer/sdk";
import { useStigmer } from "../hooks";
import { toError } from "../internal/toError";

/** Return value of {@link useSkill}. */
export interface UseSkillReturn {
  /** The resolved skill, or `null` while loading, on error, or when not found. */
  readonly skill: Skill | null;
  /** `true` while the initial fetch or a refetch is in flight. */
  readonly isLoading: boolean;
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** Discard cached data and re-fetch the skill from the server. */
  readonly refetch: () => void;
}

/**
 * Data hook that fetches a single Skill by organization, slug, and
 * optional version.
 *
 * Wraps `stigmer.skill.getByReference()` with loading, error, and
 * not-found state management. When `org`, `slug`, or `version` change,
 * the previous in-flight request is discarded and a fresh fetch begins.
 *
 * Pass `null` for either `org` or `slug` to skip fetching (stable
 * no-op). The `version` parameter is optional — omit it to fetch the
 * latest version. Pass a tag (e.g. `"stable"`) or a content hash to
 * pin to a specific version.
 *
 * **Not-found handling:** If the API returns a 404 (NOT_FOUND), the
 * hook sets `skill` to `null` without raising an error. Consumers
 * distinguish "not found" from "loading" by checking all three fields:
 * `skill === null && !isLoading && !error` means the resource does
 * not exist.
 *
 * @example
 * ```tsx
 * function SkillDetail({ org, slug }: { org: string; slug: string }) {
 *   const { skill, isLoading, error } = useSkill(org, slug);
 *
 *   if (isLoading) return <Skeleton />;
 *   if (error) return <ErrorMessage error={error} />;
 *   if (!skill) return <NotFound />;
 *
 *   return <h1>{skill.metadata?.name}</h1>;
 * }
 * ```
 *
 * @example
 * ```tsx
 * // Fetch a specific tagged version
 * const { skill } = useSkill("acme", "code-style-guide", "stable");
 * ```
 */
export function useSkill(
  org: string | null,
  slug: string | null,
  version?: string,
): UseSkillReturn {
  const stigmer = useStigmer();
  const [skill, setSkill] = useState<Skill | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [fetchKey, setFetchKey] = useState(0);

  const refetch = useCallback(() => setFetchKey((k) => k + 1), []);

  useEffect(() => {
    if (!org || !slug) {
      setSkill(null);
      setIsLoading(false);
      setError(null);
      return;
    }

    const cancelled = { current: false };
    setIsLoading(true);
    setError(null);

    stigmer.skill.getByReference({ org, slug, version }).then(
      (result) => {
        if (cancelled.current) return;
        setSkill(result);
        setIsLoading(false);
      },
      (err) => {
        if (cancelled.current) return;
        if (isNotFound(err)) {
          setSkill(null);
          setIsLoading(false);
          return;
        }
        setError(toError(err));
        setIsLoading(false);
      },
    );

    return () => {
      cancelled.current = true;
    };
  }, [org, slug, version, stigmer, fetchKey]);

  return { skill, isLoading, error, refetch };
}
