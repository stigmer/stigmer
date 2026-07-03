"use client";

import type { Skill } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/api_pb";
import { isNotFound } from "@stigmer/sdk";
import { useStigmer } from "../hooks.js";
import { useFetch } from "../internal/useFetch.js";

/** Return value of {@link useSkill}. */
export interface UseSkillReturn {
  /** The resolved skill, or `null` while loading, on error, or when not found. */
  readonly skill: Skill | null;
  /** `true` while the initial fetch or a refetch is in flight. */
  readonly isLoading: boolean;
  /** `true` while a background refetch is in flight. */
  readonly isRefetching: boolean;
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

  const { data: skill, isLoading, isRefetching, error, refetch } = useFetch(
    org && slug
      ? async () => {
          try {
            return await stigmer.skill.getByReference({ org, slug, version });
          } catch (err) {
            if (isNotFound(err)) return null;
            throw err;
          }
        }
      : null,
    [org, slug, version, stigmer],
    null,
  );

  return { skill, isLoading, isRefetching, error, refetch };
}
