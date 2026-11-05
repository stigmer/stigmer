/**
 * How many polls the lane holds open at once, per sandbox and in all, in
 * this server process.
 *
 * Temporal caps concurrent long polls per namespace, per frontend, per
 * method (`frontend.namespaceCount`, 1,200 by default), and the server's
 * own workers poll the same namespace. So the lane holds at most
 * `HELD_POLLS_IN_ALL`, leaving the rest of that room to the server's
 * workers, and one sandbox at most `HELD_POLLS_PER_SANDBOX`: twice what a
 * runner behind the server opens (runner src/temporal-lane.ts), so a poll
 * replaced during a reconnect is never refused. Past either limit a poll is
 * refused with RESOURCE_EXHAUSTED, which the SDK retries with backoff.
 *
 * A held Node request costs a pending promise, not a thread, so no
 * executor is needed here.
 */

/** Polls one sandbox may hold open (twice the runner's `THROUGH_SERVER_ACTIVITY_POLLS`). */
export const HELD_POLLS_PER_SANDBOX = 4;

/** Polls the lane holds open in all, in one process: Temporal's 1,200 less room for the server's own workers. */
export const HELD_POLLS_IN_ALL = 1_000;

export type HoldRefusal = "per-sandbox" | "in-all";

export interface HeldPolls {
  /** A release function for the slot taken, or which limit refused. */
  hold(queue: string): { readonly release: () => void } | { readonly refused: HoldRefusal };
}

export function newHeldPolls(
  perSandbox: number = HELD_POLLS_PER_SANDBOX,
  inAll: number = HELD_POLLS_IN_ALL,
): HeldPolls {
  const byQueue = new Map<string, number>();
  let total = 0;
  return {
    hold(queue) {
      const held = byQueue.get(queue) ?? 0;
      if (held >= perSandbox) {
        return { refused: "per-sandbox" };
      }
      if (total >= inAll) {
        return { refused: "in-all" };
      }
      byQueue.set(queue, held + 1);
      total += 1;
      let released = false;
      return {
        release: () => {
          if (released) {
            return;
          }
          released = true;
          total -= 1;
          const left = (byQueue.get(queue) ?? 1) - 1;
          if (left === 0) {
            byQueue.delete(queue);
          } else {
            byQueue.set(queue, left);
          }
        },
      };
    },
  };
}
