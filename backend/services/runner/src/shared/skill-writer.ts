/**
 * The "also available" skills note of the native system prompt: the skills
 * the relevance filter (`shared/skill-relevance.ts`) left out of the
 * highlighted `## Skills` section, listed by name so the agent can still
 * activate one on its own judgement by reading its SKILL.md at the mounted
 * path (the Agent Skills spec's progressive disclosure model: metadata up
 * front, instructions on demand).
 *
 * Until S3 M2b this module was the native orchestrator's whole skills path —
 * ref merging, fetching the `Skill` protos, mounting them, rendering the
 * `## Skills` section from the protos. Every one of those is the turn
 * runtime's now (`harness/turn-context.ts` `mountSkills` over
 * `shared/skill-resolver.ts` and `shared/skill-mount.ts`; the merge is
 * `shared/blueprint-resolver.ts` `mergeSkillRefs`), and the section is
 * rendered from the mounted metadata by the native prompt builder
 * (`execute-deep-agent/prompt-builder.ts` `renderSkillsSection`). This one
 * renderer stayed because the prompt builder still reads it; it moves into
 * `shared/prompt-sections.ts` with the other shared sections at S3 M5
 * (Q-S3-10, Q-M2b-8).
 */

/**
 * Generate a brief note listing skills excluded by relevance filtering.
 *
 * The agent can still request these skills by name if it determines
 * they are needed mid-conversation.
 */
export function generateAlsoAvailableSection(
  excludedNames: readonly string[],
): string {
  if (excludedNames.length === 0) return "";

  const namesStr = excludedNames.map(n => `\`${n}\``).join(", ");
  return (
    "\n### Also Available\n\n" +
    `These skills are installed but were not highlighted above: ${namesStr}. ` +
    "If you determine one of them is relevant to your task, " +
    "read its SKILL.md at `.stigmer/skills/<name>/SKILL.md` to activate it.\n"
  );
}
