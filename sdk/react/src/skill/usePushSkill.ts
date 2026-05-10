"use client";

import { useCallback, useState } from "react";
import { create } from "@bufbuild/protobuf";
import type { Skill } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/api_pb";
import { PushSkillRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/io_pb";
import { useStigmer } from "../hooks";
import { toError } from "../internal/toError";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Input for pushing a skill artifact (ZIP package). */
export interface PushSkillInput {
  /** Organization that will own the skill. */
  readonly org: string;
  /** Raw ZIP bytes of the skill package (must contain SKILL.md at root). */
  readonly artifact: Uint8Array;
  /** Optional version tag (e.g. "stable", "v1.0"). */
  readonly tag?: string;
}

/** Return value of {@link usePushSkill}. */
export interface UsePushSkillReturn {
  /**
   * Push a skill artifact ZIP to the server.
   *
   * The caller is responsible for providing a valid ZIP containing
   * a SKILL.md with proper YAML frontmatter. Use {@link useSkillUpload}
   * to validate the ZIP before pushing.
   *
   * Resolves with the server-persisted `Skill` resource including
   * populated metadata (id, slug, version hash).
   */
  readonly push: (input: PushSkillInput) => Promise<Skill>;
  /** `true` while the push request is in flight. */
  readonly isPushing: boolean;
  /** Error from the last failed push, or `null` when healthy. */
  readonly error: Error | null;
  /** Reset `error` to `null`. */
  readonly clearError: () => void;
}

// ---------------------------------------------------------------------------
// Hook implementation
// ---------------------------------------------------------------------------

/**
 * Mutation hook that pushes a skill artifact ZIP to the server.
 *
 * Accepts raw ZIP bytes and calls `stigmer.skill.push()` directly.
 * The ZIP must contain a valid SKILL.md with YAML frontmatter — use
 * {@link useSkillUpload} to validate before pushing.
 *
 * Follows the established SDK mutation hook pattern: `isPushing` flag,
 * `error` state, `clearError` reset, result returned from the promise.
 *
 * @example
 * ```tsx
 * const { push, isPushing, error } = usePushSkill();
 * const upload = useSkillUpload();
 *
 * // After upload.processFile(file) succeeds:
 * if (upload.artifact) {
 *   const skill = await push({ org: "acme", artifact: upload.artifact });
 * }
 * ```
 */
export function usePushSkill(): UsePushSkillReturn {
  const stigmer = useStigmer();
  const [isPushing, setIsPushing] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const push = useCallback(
    async (input: PushSkillInput): Promise<Skill> => {
      setIsPushing(true);
      setError(null);

      try {
        const request = create(PushSkillRequestSchema, {
          org: input.org,
          artifact: input.artifact,
          tag: input.tag ?? "",
        });

        return await stigmer.skill.push(request);
      } catch (err) {
        setError(toError(err));
        throw err;
      } finally {
        setIsPushing(false);
      }
    },
    [stigmer],
  );

  return { push, isPushing, error, clearError };
}
