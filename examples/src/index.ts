// Stigmer's example agents as one list every reader shares: today the React
// kit's launcher (its first question), its create picker and the agent
// page's "Make it yours" tab, in the web console and the desktop app; and
// the ready-made skills that tab offers. Each is a job an agent does for a product's users,
// with a sample file in and a file out; the folders beside this package's
// source are what people download, and catalogue.gen.ts is generated from
// them (scripts/generate.mjs).

import { EXAMPLES, SKILLS } from "./catalogue.gen.js";
import { EXAMPLE_AGENT_SLUGS } from "./journey/slugs.gen.js";
import type { Example, ExampleSkill } from "./types.js";

export { EXAMPLE_AGENT_SLUGS, EXAMPLES, SKILLS };
export type { Example, ExampleAgent, ExampleCategory, ExampleSample, ExampleSkill } from "./types.js";

/** The example with this id, or undefined. */
export function exampleById(id: string): Example | undefined {
  return EXAMPLES.find((example) => example.id === id);
}

/** The ready-made skill with this id, or undefined. */
export function skillById(id: string): ExampleSkill | undefined {
  return SKILLS.find((skill) => skill.id === id);
}
