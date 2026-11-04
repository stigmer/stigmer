/**
 * The terminal recordings the docs play, by name.
 *
 * The list is the terminal kit's (sdk/ink/src/recordings.ts), and each
 * recording's frames are the file its test holds
 * (sdk/ink/src/__tests__/__recordings__/<name>.json): SessionView drawn over
 * a story of the scenario catalogue, so a change to the terminal's look
 * fails that test and reaches the docs in the same pull request.
 * `<TerminalRecording>` plays them and the markdown exports carry the last
 * frame in the tag's place (`cleanContent` in ./llms-pages.ts); both read
 * them through this module.
 */
import { RECORDINGS, type RecordedSession } from "../../../sdk/ink/src/recordings";
import runApproval from "../../../sdk/ink/src/__tests__/__recordings__/run-approval.json";
import { plainText } from "./sgr";

export { RECORDINGS, type RecordedSession };

/** Every held recording, by name: one import per entry of the list. */
const HELD: Readonly<Record<string, RecordedSession>> = {
  "run-approval": runApproval as RecordedSession,
};

/** The names this module holds a file for; the site's test holds them equal to the list. */
export const HELD_RECORDINGS: readonly string[] = Object.keys(HELD);

/** The recording `name` names; a name the list does not hold fails the build that asked for it. */
export function recording(name: string): RecordedSession {
  const held = HELD[name];
  if (held === undefined || !RECORDINGS.some((entry) => entry.name === name)) {
    const known = RECORDINGS.map((entry) => `"${entry.name}"`).join(", ");
    throw new Error(`no terminal recording named "${name}"; the terminal kit records ${known} (sdk/ink/src/recordings.ts)`);
  }
  return held;
}

/** A recording's last frame as plain text, the last `rows` lines, trailing spaces trimmed: what the exports carry. */
export function lastFrameText(name: string): string {
  const held = recording(name);
  const lines = plainText(held.frames.at(-1)!.text)
    .split("\n")
    .map((line) => line.trimEnd());
  return lines.slice(-held.rows).join("\n").replace(/^\n+/, "");
}
