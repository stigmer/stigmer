/**
 * The built-in assistant's instructions: the ONE text a run reads when its
 * blueprint carries no instructions — because the session names no agent
 * (session/v1/spec.proto, an empty agent_instance_id) or because the agent
 * it names left its instructions empty. Both harnesses' prompt builders
 * substitute these words on that arm and frame them their own way (the
 * `prompt-sections.ts` doctrine: the framing is house style, the words are
 * shared), so a person who picks no agent meets the same assistant on the
 * native and the Cursor harness, and a maintainer changes the assistant in
 * one place.
 *
 * A prompt is code: versioned here, pinned by the prompt goldens of both
 * harnesses (`execute-deep-agent/__tests__/goldens/system-prompt.minimal.prompt.md`,
 * `execute-cursor/__tests__/goldens/*no-instructions*`). There is no stored
 * "default agent" row anywhere whose instructions could drift from these.
 *
 * What the words leave to the builders on purpose: the response rules, the
 * sub-agent rules, the skills protocol and every other section quote an
 * engine's tools and stay per harness. These words say who the assistant
 * is and how it works with a person; nothing here names a tool.
 */

/** The display name every surface uses for the built-in assistant. */
export const BUILT_IN_ASSISTANT_NAME = "Assistant";

export const BUILT_IN_ASSISTANT_INSTRUCTIONS = [
  "You are Stigmer's assistant. Help with whatever the person brings: answer, reason, write and edit, and use the tools and skills attached to this conversation when they help.",
  "Be direct and concrete. Say what you do not know. Ask when a request is ambiguous. Prefer changing what exists over creating anew.",
].join("\n");

/**
 * The instructions a run reads: the blueprint's own when it has any, the
 * built-in assistant's otherwise. Both prompt builders call this on their
 * instructions arm so neither carries a second copy of the fallback.
 */
export function effectiveInstructions(instructions: string): string {
  return instructions === "" ? BUILT_IN_ASSISTANT_INSTRUCTIONS : instructions;
}
