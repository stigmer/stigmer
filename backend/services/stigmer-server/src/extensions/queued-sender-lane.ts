/**
 * The queued-sender-lane seam — the lane a message waiting in a session's
 * queue was sent through, kept for the turn the queue starts with it.
 *
 * A message sent while a turn works waits (domain/run/send-message.ts);
 * one the working turn does not read starts the next turn, created as its
 * sender (domain/run/queued-turn.ts). Core knows a sender by identity id,
 * and answers a person's id with the person (`callerOf`). A composition
 * whose callers also come through other lanes (a chat link's guest, a
 * messaging channel's sender) admits a turn by its lane: the lane's gate
 * steps and run profile key on the caller's class and claims. Those come
 * from the credential the message was sent with, which the queue never
 * keeps. This seam keeps the lane as data instead:
 *
 *   - `encode` turns the caller that sent a message into the lane to keep
 *     beside it: empty for a caller whom `callerOf` answers (a person), and
 *     never the credential itself;
 *   - `decode` turns a kept lane back into the caller the queue's turn is
 *     created as, so the turn meets its lane's gates and profile again: a
 *     composition that reads claims from a credential mints a fresh,
 *     short-lived one from the kept claims. Undefined when the lane names
 *     nothing this composition can act as: the queue then drops the
 *     messages, with the reason, as it drops a sender it no longer knows.
 *
 * Absent (open source), every message keeps an empty lane and the queue's
 * turn acts as its sender's person, as before.
 */
import type { CallerIdentity } from "./identity.js";

export interface QueuedSenderLane {
  /** The lane to keep beside a message `caller` sent: empty for a person's (module header). */
  encode(caller: CallerIdentity): Uint8Array;
  /** The caller a kept lane stands for, for sender `senderId`; undefined when none (module header). */
  decode(senderId: string, lane: Uint8Array): Promise<CallerIdentity | undefined>;
}
