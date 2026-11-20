/**
 * Which idle sandbox yields its seat to a run that is waiting for one, as
 * a pure function kept apart from the calls it leads to, so every rule is
 * a row in a table test. Each edition's provisioner reads its own sandboxes
 * (the open-source sweep's last listing, the cloud's rows) and asks this
 * one function which to put to sleep, so the choice is made once for both.
 *
 * When a run waits because the fleet has no room (provisioner.ts, "No
 * room"), the agent-execution workflow's ask for its sandbox asks the
 * provisioner to make room (provisioner.ts `makeRoom`, steps.ts). The
 * provisioner puts one idle sandbox to sleep and stops, so the sandboxes
 * put to sleep at any moment are bounded by the runs asking: a run that
 * keeps losing the freed seat to another start asks again on its next
 * ask, and each seat so freed was used by someone. Its files are kept; its
 * session's next message wakes it, a few seconds slower than an awake one.
 *
 *   - Never a busy sandbox: a run that is pending or in progress keeps its
 *     sandbox (domain/run/phases.ts `keepsSandboxAwake`). The waiting run's
 *     own session is pending, so it is never a candidate either; the
 *     provisioner leaves it out by id besides.
 *   - Never one on a leaving worker: make-room's suspend is the ordinary
 *     one, whose snapshot stays on the node until it is copied, and that
 *     node is going away. The sweep stores such a sandbox durably as soon
 *     as it is not busy.
 *   - Plain idle sandboxes before ones parked on a person's answer or a
 *     pause: a parked turn's clock is its run's start (open source) or its
 *     last wake (the cloud), so it looks the most idle of all while the
 *     person may be reading the question it asked. A parked one still
 *     yields when nothing else can, and its workflow wakes it before the
 *     turn carries on.
 *   - Longest idle first within each, ties by id, so two server replicas
 *     choose alike; a race between them is settled by each edition's
 *     guarded suspend, and the loser tries the next.
 *
 * At most MAKE_ROOM_MAX_TRIES are offered: the caller tries them in order
 * until one goes to sleep, and a sandbox a turn or another replica took in
 * the meantime is skipped for the next.
 */

/** One awake sandbox as a provisioner read it, keyed by the session it serves. */
export interface MakeRoomCandidate {
  readonly id: string;
  /** A run in its session is working (pending or in progress). */
  readonly busy: boolean;
  /** A run in its session is parked on a person's answer or a pause. */
  readonly parked: boolean;
  /** Its worker is leaving. */
  readonly draining: boolean;
  /** When its session was last active, by the provisioner's own clock. */
  readonly lastActiveAt: Date;
}

/** How many sandboxes one ask may try, in order, before it gives up. */
export const MAKE_ROOM_MAX_TRIES = 3;

/**
 * How long a waiting run's ask waits before each ask again, once room was
 * made: Substrate releases the slept sandbox's booking as its suspend
 * lands, but its scheduler reads a cache that can lag the release by a
 * moment, so the first ask after it may still hear "no room". Three asks
 * over about three seconds; the ask's heartbeat covers them.
 */
export const MAKE_ROOM_RETRY_DELAYS_MS: readonly number[] = [500, 1000, 1500];

/** The sessions whose sandboxes to try, in order (module header). */
export function orderSandboxesToFree(
  candidates: readonly MakeRoomCandidate[],
): string[] {
  return candidates
    .filter((candidate) => !candidate.busy && !candidate.draining)
    .sort(
      (a, b) =>
        Number(a.parked) - Number(b.parked) ||
        a.lastActiveAt.getTime() - b.lastActiveAt.getTime() ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )
    .slice(0, MAKE_ROOM_MAX_TRIES)
    .map((candidate) => candidate.id);
}
