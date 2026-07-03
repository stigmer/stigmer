"use client";

import { useCallback, useRef, useState } from "react";
import { useStigmer } from "../hooks.js";
import { computeArtifactHash } from "./internal/computeArtifactHash.js";

/** Return value of {@link useSkillDuplicateCheck}. */
export interface UseSkillDuplicateCheckReturn {
  /** Whether the uploaded artifact is identical to the current version. */
  readonly isDuplicate: boolean;
  /** `true` while the check is in progress. */
  readonly isChecking: boolean;
  /**
   * Run the duplicate check for the given artifact.
   *
   * Computes a client-side SHA-256 hash of `artifactBytes`, fetches
   * the existing skill by `(org, slug)`, and compares against
   * `status.versionHash`. If they match, sets `isDuplicate` to `true`.
   *
   * Returns `true` if the content is a duplicate.
   */
  readonly check: (params: {
    org: string;
    slug: string;
    artifactBytes: Uint8Array;
  }) => Promise<boolean>;
  /** Reset the check state. */
  readonly reset: () => void;
}

/**
 * Behavior hook that checks whether a skill package's content is
 * identical to the currently deployed version.
 *
 * Uses Web Crypto SHA-256 on the client side and compares against
 * `SkillStatus.versionHash` from a `getByReference` RPC call.
 * If the skill doesn't exist yet (NOT_FOUND), the check passes
 * (not a duplicate).
 */
export function useSkillDuplicateCheck(): UseSkillDuplicateCheckReturn {
  const stigmer = useStigmer();
  const [isDuplicate, setIsDuplicate] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const callIdRef = useRef(0);

  const reset = useCallback(() => {
    callIdRef.current++;
    setIsDuplicate(false);
    setIsChecking(false);
  }, []);

  const check = useCallback(
    async (params: {
      org: string;
      slug: string;
      artifactBytes: Uint8Array;
    }): Promise<boolean> => {
      const callId = ++callIdRef.current;
      setIsChecking(true);
      setIsDuplicate(false);

      try {
        const [clientHash, existingSkill] = await Promise.all([
          computeArtifactHash(params.artifactBytes),
          stigmer.skill
            .getByReference({ org: params.org, slug: params.slug })
            .catch(() => null),
        ]);

        if (callIdRef.current !== callId) return false;

        if (!existingSkill) {
          setIsDuplicate(false);
          return false;
        }

        const serverHash = existingSkill.status?.versionHash ?? "";
        const match = serverHash !== "" && serverHash === clientHash;
        setIsDuplicate(match);
        return match;
      } catch {
        if (callIdRef.current === callId) setIsDuplicate(false);
        return false;
      } finally {
        if (callIdRef.current === callId) setIsChecking(false);
      }
    },
    [stigmer],
  );

  return { isDuplicate, isChecking, check, reset };
}
