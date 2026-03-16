"use client";

import { useQuery } from "@tanstack/react-query";
import { useStigmer } from "@stigmer/react";
import { skillKeys } from "./keys";

/**
 * Fetches a full Skill resource by ID.
 *
 * Returns the complete skill including metadata, spec (skill_md content,
 * description, tag), and status (version hash, state, git provenance).
 */
export function useSkill(skillId: string) {
  const stigmer = useStigmer();

  return useQuery({
    queryKey: skillKeys.detail(skillId),
    queryFn: () => stigmer.skill.get(skillId),
    enabled: !!skillId,
  });
}
