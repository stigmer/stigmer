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

/** Input for pushing a skill from web-authored content. */
export interface PushSkillInput {
  /** Organization that will own the skill. */
  readonly org: string;
  /**
   * Complete SKILL.md content (YAML frontmatter + Markdown body).
   * The backend extracts name/description from the frontmatter.
   */
  readonly skillMd: string;
  /** Optional version tag (e.g. "stable", "v1.0"). */
  readonly tag?: string;
}

/** Return value of {@link usePushSkill}. */
export interface UsePushSkillReturn {
  /**
   * Package the skill content into a ZIP artifact and push it.
   *
   * The ZIP packaging is handled internally — callers provide the
   * raw SKILL.md content string and the hook handles encoding,
   * ZIP creation, and the push RPC.
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
// ZIP packaging (internal)
// ---------------------------------------------------------------------------

/**
 * Packages a SKILL.md content string into a ZIP artifact.
 *
 * Uses dynamic import of `fflate` so the library is only loaded when
 * a push is actually performed — zero cost for consumers who only
 * read skills.
 */
async function packSkillArtifact(skillMdContent: string): Promise<Uint8Array> {
  const { zipSync, strToU8 } = await import("fflate");
  return zipSync({ "SKILL.md": strToU8(skillMdContent) });
}

// ---------------------------------------------------------------------------
// Hook implementation
// ---------------------------------------------------------------------------

/**
 * Mutation hook that pushes a skill from web-authored Markdown content.
 *
 * Internally packages the SKILL.md content into a ZIP artifact and calls
 * `stigmer.skill.push()`. The ZIP packaging is an implementation detail —
 * consumers just provide the content string.
 *
 * Follows the established SDK mutation hook pattern: `isPushing` flag,
 * `error` state, `clearError` reset, result returned from the promise
 * (not stored in hook state).
 *
 * @example
 * ```tsx
 * const { push, isPushing, error } = usePushSkill();
 *
 * const skill = await push({
 *   org: "acme",
 *   skillMd: "---\nname: code-style\ndescription: Coding standards\n---\n\n# Code Style...",
 *   tag: "stable",
 * });
 * // skill.metadata?.slug → "code-style"
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
        const artifact = await packSkillArtifact(input.skillMd);

        const request = create(PushSkillRequestSchema, {
          org: input.org,
          artifact,
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
