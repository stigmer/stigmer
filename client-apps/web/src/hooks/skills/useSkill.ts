"use client";

import { useQuery } from "@tanstack/react-query";
import { useSkillQueryService } from "@stigmer/skill";
import { skillKeys } from "./keys";

/**
 * Fetches a full Skill resource by ID.
 *
 * Returns the complete skill including metadata, spec (skill_md content,
 * description, tag), and status (version hash, state, git provenance).
 */
export function useSkill(skillId: string) {
  const service = useSkillQueryService();

  return useQuery({
    queryKey: skillKeys.detail(skillId),
    queryFn: () => service.get(skillId),
    enabled: !!skillId,
  });
}
