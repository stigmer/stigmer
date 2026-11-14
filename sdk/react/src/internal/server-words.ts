// The server's own words for a failure, as one sentence the kit can follow
// with what to do next: getUserMessage's plain message (auth and network
// noise already rewritten), ending in a full stop. A step that failed reads
// "<what happened>. <the server's sentence> <what to do>", and a server
// sentence without its own full stop would run into the next.

import { getUserMessage } from "@stigmer/client";

/** What a failure says when the server said nothing a person can read. */
const UNREACHABLE = "Stigmer couldn't reach the server";

/** The server's words for `error` as a sentence ending in `.`, `!` or `?`. */
export function serverSentence(error: unknown): string {
  return asSentence(getUserMessage(error, UNREACHABLE));
}

/** Words the server already gave as text (a field's refusal), as a sentence. */
export function asSentence(words: string): string {
  const said = words.trim() === "" ? UNREACHABLE : words.trim();
  return /[.!?]$/.test(said) ? said : `${said}.`;
}
