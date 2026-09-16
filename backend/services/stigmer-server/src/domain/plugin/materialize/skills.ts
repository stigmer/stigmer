/**
 * Skills from a plugin: one `PushSkillRequest` per `skills/<name>/SKILL.md`,
 * each an archive of its own written from the plugin's files. The library
 * lists a skill's files PLUGIN-relative (`skills/x/SKILL.md`), so the writer
 * strips `dir + "/"` to put SKILL.md at the archive root, where the skill
 * gate requires it; a Claude root-single-skill plugin (`dir === ""`) is the
 * whole package as one skill, manifests included, harmless under the caps.
 *
 * The skill's identity is the frontmatter's, exactly as a CLI push: the
 * slug planned here is `generateSlug(name)`, the same function
 * ResolveSlugForPush runs, so the plan and the pushed skill agree by
 * construction. The tag is the plugin's version (when it fits the tag
 * pattern), so a skill's history reads like its plugin's.
 */
import { create } from "@bufbuild/protobuf";

import type {
  PluginFiles,
  PluginPackage,
  PluginSkill,
} from "@stigmer/plugin-package";
import { PushSkillRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/io_pb";
import type { PushSkillRequest } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/io_pb";

import { writeArchive } from "../../../archive/write.js";
import { generateSlug } from "../../../pipeline/steps/slug.js";
import { memberLabels } from "./identity.js";
import type { PluginIdentity } from "./identity.js";

export interface PlannedSkill {
  readonly name: string;
  readonly slug: string;
  readonly request: PushSkillRequest;
}

/** The slug a plugin skill will have once pushed; the plan checks it before any write. */
export function skillSlugOf(skill: PluginSkill): string {
  return generateSlug(skill.name);
}

export function planSkills(
  plugin: PluginPackage,
  files: PluginFiles,
  identity: PluginIdentity,
  tag: string,
  message: string,
): PlannedSkill[] {
  return plugin.skills.map((skill) => {
    const prefix = skill.dir === "" ? "" : `${skill.dir}/`;
    const archive = writeArchive(
      skill.files.map((path) => ({
        path: path.startsWith(prefix) ? path.slice(prefix.length) : path,
        bytes: files.read(path),
      })),
    );
    return {
      name: skill.name,
      slug: skillSlugOf(skill),
      request: create(PushSkillRequestSchema, {
        org: identity.org,
        artifact: archive,
        tag,
        message,
        labels: memberLabels(identity),
      }),
    };
  });
}
