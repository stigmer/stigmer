"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Skill } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/api_pb";
import { getSkill } from "@/services/skill-service";

export interface UseSkillDetailReturn {
  skill: Skill | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
}

/**
 * Fetches a full Skill resource by ID.
 *
 * Returns the complete skill including metadata, spec (skill_md content,
 * description, tag), and status (version hash, state, git provenance).
 */
export function useSkillDetail(skillId: string): UseSkillDetailReturn {
  const [skill, setSkill] = useState<Skill | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestIdRef = useRef(0);

  const fetchSkill = useCallback(async () => {
    if (!skillId) return;

    const requestId = ++requestIdRef.current;
    setIsLoading(true);
    setError(null);

    try {
      const result = await getSkill(skillId);

      if (requestId !== requestIdRef.current) return;

      setSkill(result);
    } catch (err: unknown) {
      if (requestId !== requestIdRef.current) return;

      const message =
        err instanceof Error ? err.message : "Failed to load skill";
      setError(message);
      setSkill(null);
    } finally {
      if (requestId === requestIdRef.current) {
        setIsLoading(false);
      }
    }
  }, [skillId]);

  useEffect(() => {
    fetchSkill();
  }, [fetchSkill]);

  return { skill, isLoading, error, refresh: fetchSkill };
}
