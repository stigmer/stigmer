// Golden files for the CLI's human output: what a person sees for each
// everyday situation, frozen as plain text beside the test that renders it,
// so a change to the look shows up in review as a diff of that file.
//
// A golden is written by `npx vitest run -u` in this package and read back on
// every other run; in CI vitest never writes one (its snapshot mode is
// `none` there), so a missing golden fails rather than appearing. The text
// is the renderer's own, colour off: colour is the subject of unit tests,
// not of goldens.
import { expect } from "vitest";

/** Compares `text` with `__goldens__/<name>.txt` beside the calling test file. */
export async function expectGolden(text: string, name: string): Promise<void> {
  await expect(text).toMatchFileSnapshot(`__goldens__/${name}.txt`);
}
