// Stigmer's example agents as one list every reader shares: today the React
// kit's launcher (its first question) and its create picker, in the web
// console and the desktop app. Each is a job an agent does for a product's users,
// with a sample file in and a file out; the folders beside this package's
// source are what people download, and catalogue.gen.ts is generated from
// them (scripts/generate.mjs).

import { EXAMPLES } from "./catalogue.gen.js";
import type { Example } from "./types.js";

export { EXAMPLES };
export type { Example, ExampleAgent, ExampleCategory, ExampleSample } from "./types.js";

/** The example with this id, or undefined. */
export function exampleById(id: string): Example | undefined {
  return EXAMPLES.find((example) => example.id === id);
}
