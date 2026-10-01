/**
 * The exit backstop for static and pool modes: once the runner's own
 * shutdown has finished (worker drained, harnesses released, Temporal
 * connection closed, OTel flushed), the process must end within a named
 * bound, and when it has to be MADE to end, the log names what kept it
 * alive.
 *
 * Static and pool modes end when the Node event loop drains. That is the
 * normal path and it stays the normal path: a healthy runner exits in
 * milliseconds on its own. The failure it guards against is one leaked
 * handle — a timer, a socket, a child — that outlives the worker and holds
 * the process until the orchestrator's grace expires. One uncleared timer
 * in our own code did exactly that to every pool-member roll for three
 * months (issue #1008), and the next one may sit in a vendor SDK we do not
 * own. A hosted sandbox pod's grace is ten minutes, so the cost of a leak
 * is not bounded by anything the runner controls — until this module.
 *
 * Why these choices:
 *
 * - The timer is `unref()`'d, so arming it never keeps the process alive.
 *   A drained loop exits naturally and the timer dies with it; the
 *   backstop only ever fires when something else is still holding the
 *   loop. An unref'd timer is also absent from
 *   `process.getActiveResourcesInfo()`, so the line never names the
 *   backstop itself.
 * - The bound sits above the conformance harness's slow-exit threshold
 *   (2 s, `test/support/src/runner-process.ts`), so a leak is
 *   still reported there as a slow exit instead of being hidden under it,
 *   and far below the harness's 30 s and the hosted 10-minute graces.
 * - A forced exit exits 0. By the time the backstop is armed the drain and
 *   the flush have completed; the lingering handle is a defect named in the
 *   log, not a failed shutdown, and a non-zero code would make Kubernetes
 *   and the desktop host report a crash for a clean stop.
 * - It is armed only after everything the shutdown awaits. Work that
 *   nobody awaits (a fire-and-forget promise) is the only thing it can cut;
 *   if such work matters at exit, the fix is to await it, and this line
 *   names it the first time it happens.
 *
 * Manager mode does not use this: it is driven by its host over stdin and
 * exits at once after its shutdown (issue #177, `main.ts`).
 */

/** How long the process may outlive its own completed shutdown before it is made to exit. */
export const EXIT_BACKSTOP_MS = 5_000;

export interface ExitBackstopOptions {
  /** The bound; defaults to {@link EXIT_BACKSTOP_MS}. */
  readonly boundMs?: number;
  /** Ends the process; defaults to `process.exit`. */
  readonly exit?: (code: number) => void;
  /** Names what still holds the loop; defaults to `process.getActiveResourcesInfo`. */
  readonly activeResources?: () => string[];
  /** Writes the forced-exit line; defaults to `console.warn`. */
  readonly log?: (line: string) => void;
}

/**
 * Arm the backstop. Call it once, after the mode's shutdown has returned.
 * Returns the armed timer so a test can observe that it does not hold the
 * loop; production callers ignore it.
 */
export function armExitBackstop(
  options: ExitBackstopOptions = {},
): ReturnType<typeof setTimeout> {
  const boundMs = options.boundMs ?? EXIT_BACKSTOP_MS;
  const exit = options.exit ?? ((code: number) => process.exit(code));
  const activeResources = options.activeResources ?? (() => process.getActiveResourcesInfo());
  const log = options.log ?? ((line: string) => console.warn(line));

  const timer = setTimeout(() => {
    log(
      `[runner] Process still alive ${boundMs}ms after shutdown; forcing exit. ` +
        `Active resources: ${describeResources(activeResources())}`,
    );
    exit(0);
  }, boundMs);
  timer.unref();
  return timer;
}

/**
 * `["Timeout", "TCPSocketWrap", "TCPSocketWrap"]` → `"TCPSocketWrap×2, Timeout×1"`:
 * grouped and sorted, so the same leak reads the same on every exit.
 */
export function describeResources(resources: readonly string[]): string {
  if (resources.length === 0) {
    return "none reported";
  }
  const counts = new Map<string, number>();
  for (const resource of resources) {
    counts.set(resource, (counts.get(resource) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([resource, count]) => `${resource}×${count}`)
    .join(", ");
}
