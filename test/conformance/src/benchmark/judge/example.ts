// What the AI judge's rules are held to: an example conversation written for
// the purpose, the parts the judge is shown of it, and the right verdict for
// every rubric, with the reason that verdict is right.
// Domain: conformance benchmark (the judge's calibration).
//
// An example is `SubjectParts` (@stigmer/eval-runtime), the same parts the
// server reads from a stored run, so it renders through the judge's own
// `renderSubject` and is graded exactly as a live run is; a change to how a
// transcript is stored rewrites the server's adapter, never an example.
//
// Every example is invented. None is taken from a run: a real conversation
// would carry someone's data into the repository, and an example taken from
// a run the judge already graded would measure the judge against itself.
//
// The set's digest joins the judge's version in the committed calibration
// (calibration.ts): an edit to an example changes what the rules are held
// to as much as an edit to a rule does, so either refuses the calibration
// until it is run again.
import { createHash } from "node:crypto";

import type { SubjectParts, VerdictResultName } from "@stigmer/eval-runtime";

/** One example conversation and the verdict the judge must give it. */
export interface JudgeExample {
  /** Unique, kebab-case; names the example in the calibration's misses. */
  readonly id: string;
  /** What the example is about, in a line. */
  readonly about: string;
  /** What the judge is shown. */
  readonly parts: SubjectParts;
  /** The right verdict for every rubric, by name. */
  readonly expected: Readonly<Record<string, VerdictResultName>>;
  /** Why those verdicts are right, for the reader and the blind labeller's disagreements. */
  readonly why: string;
}

/** The SHA-256 of the examples as written, in order. */
export function examplesDigest(examples: ReadonlyArray<JudgeExample>): string {
  return createHash("sha256").update(JSON.stringify(examples)).digest("hex");
}
