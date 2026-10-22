/**
 * The kit's session queue for one execution: where the server's queue and
 * the runtime's input channel (`harness/turn-input.ts`) stand in the
 * adapter-level kit, which runs an adapter over a recording sink with no
 * runtime behind it.
 *
 * A message the kit's person sends waits until the turn claims it; a claim
 * takes every waiting message, in the order sent, as the run's; what the
 * run took stays its own, so a later invocation's `claimed` finds what its
 * engine has not delivered. A send makes the queue pending and tells the
 * channel's listeners, as a status write's answer would. The runtime half
 * of the kit uses the hermetic server's queue instead
 * (`hermetic-activity.ts`), behind the runtime's real channel.
 */

import type { TurnInputChannel, TurnMessage } from "../../harness/turn-input.js";

export class KitMessageQueue {
  private readonly waiting: TurnMessage[] = [];
  private readonly taken: TurnMessage[] = [];
  private readonly listeners = new Set<() => void>();
  private sent = 0;

  constructor(private readonly executionId: string) {}

  /** The kit's person sends `text`; answers the message's id. */
  send(text: string): string {
    const id = `kit-msg-${this.executionId}-${++this.sent}`;
    this.waiting.push({ id, text, message: [], visionImages: [], visionNotViewable: [] });
    for (const listener of [...this.listeners]) listener();
    return id;
  }

  /** The channel an invocation's sink hands its adapter. */
  channel(): TurnInputChannel {
    return {
      pending: () => this.waiting.length > 0,
      onPending: (listener) => {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
      },
      claim: async (options = {}) => {
        if (this.waiting.length === 0 && options.force !== true) return [];
        const claimed = this.waiting.splice(0);
        this.taken.push(...claimed);
        return claimed;
      },
      claimed: async (delivered) => this.taken.filter((message) => !delivered.has(message.id)),
    };
  }
}
