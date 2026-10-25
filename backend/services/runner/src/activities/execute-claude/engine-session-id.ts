/**
 * The identities the Claude engine is handed, each derived from one the
 * platform already has, so nothing is stored to remember them:
 *
 *  - the engine's session id, from the session's thread id: every turn of a
 *    session resumes the same engine session, on any runner, with no state
 *    read back (the thread id is the runtime's, minted before any engine
 *    ran);
 *  - the id of the message a run opens with, from the run's execution id:
 *    the engine keeps a user message's id as its transcript entry's own
 *    (measured on SDK 0.3.310), so the transcript says whether this run's
 *    message was already taken, the way the native engine's run stamp does
 *    (`execute-deep-agent/run-stamp.ts`);
 *  - the id of a message a person sent while the turn worked, from its
 *    `user.message` id: the engine reports each pushed message's progress
 *    under that id (`command_lifecycle`) and records its absorption under
 *    it, so the turn knows which it delivered.
 *
 * Name-based (RFC 9562 version 5) UUIDs under one fixed namespace, each
 * name prefixed by its kind so no two kinds can collide. The engine requires
 * a UUID for each.
 */

import { createHash } from "node:crypto";

/** The namespace every id here is derived under. Fixed: changing it orphans every saved engine session. */
const CLAUDE_ID_NAMESPACE = "8f0c2c6e-6d7a-4f3e-9c1b-5a4e2d1f0b7c";

/** The engine's session id for a thread. */
export function engineSessionIdOf(threadId: string): string {
  return nameBasedUuid(`session:${threadId}`);
}

/** The id of the message a run opens with. */
export function runMessageIdOf(executionId: string): string {
  return nameBasedUuid(`run:${executionId}`);
}

/** The id a message sent while the turn worked is pushed under. */
export function sentMessageIdOf(userMessageId: string): string {
  return nameBasedUuid(`message:${userMessageId}`);
}

/** A version 5 UUID of `name` under the namespace (RFC 9562, section 5.5). */
function nameBasedUuid(name: string): string {
  const namespace = Buffer.from(CLAUDE_ID_NAMESPACE.replaceAll("-", ""), "hex");
  const hash = createHash("sha1").update(namespace).update(name, "utf8").digest();
  const bytes = hash.subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
