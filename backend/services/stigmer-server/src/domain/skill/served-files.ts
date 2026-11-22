/**
 * How a skill's files are served (archive/serve-files.ts): where its version's
 * archive is and what it hides. One binding for the skill's own listFiles and
 * readFile and for the agent's save, which reads a skill's file index to warn
 * about what an agent without a computer cannot run
 * (domain/agent/skill-warnings.ts).
 */
import { SkillSchema } from "@stigmer/apis/ai/stigmer/agentic/skill/v1/api_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { ServedArchiveBinding } from "../../archive/serve-files.js";
import { SKILL_ARTIFACT_KEY_PREFIX } from "./storage/artifact-storage.js";

/** How a skill's files are served (archive/serve-files.ts). */
export const servedSkill: ServedArchiveBinding<typeof SkillSchema> = {
  kind: ApiResourceKind.skill,
  schema: SkillSchema,
  noun: "skill",
  headHashOf: (skill) => skill.status?.versionHash ?? "",
  storageKeyOf: (skill) => skill.status?.artifactStorageKey ?? "",
  suiteDirOf: () => undefined,
  keyForHash: (hash) => `${SKILL_ARTIFACT_KEY_PREFIX}${hash}.zip`,
  nameOf: (skill) => skill.metadata?.slug || skill.metadata?.id || "",
};
