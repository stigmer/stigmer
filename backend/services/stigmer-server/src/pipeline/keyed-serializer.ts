/**
 * KeyedSerializer — one turn at a time per key, within this server process.
 *
 * Built for recover (stigmer#1672). A recover is a chain of side effects
 * (terminate the old workflow, recreate the run's ExecutionContext, start a
 * fresh workflow, persist the phase) decided on one read of the execution,
 * and only its last step is an atomic write. Two recovers of one execution
 * run side by side would both act on that stale read: two contexts for one
 * run, a freshly recovered run terminated and started again, or a start
 * refused because the workflow is already running. Wrapping each recover in
 * a turn keyed by the execution id makes the second one wait, then read
 * the execution as the first left it.
 *
 * Trade-offs:
 *   - In-process, not durable. Every edition runs one server process per
 *     database: the Helm chart pins one replica (deploy/helm/stigmer
 *     values.yaml, "one replica is a fact"), local and desktop are one
 *     process, and the hosted deployment runs one replica with autoscaling
 *     off. The one overlap is a rolling update, when the outgoing and the
 *     incoming server serve together for the length of the roll; there the
 *     run-id lookups' refusal of two contexts (stigmer#1671) is the
 *     backstop. A deployment that runs more than one server on one database
 *     needs a durable claim in the store instead.
 *   - No timeout of its own. A turn lasts as long as its work's own calls
 *     (Temporal client RPCs retry internally for about a minute; see
 *     IN_FLIGHT_CLAIM_TTL_MS in store/interface.ts for the same bound).
 *   - Each caller runs its own work: a queued caller is never handed the
 *     earlier caller's result, because that result was produced under the
 *     earlier caller's authorization.
 *   - A key's entry is dropped when its queue drains, so the map holds only
 *     keys with work in flight. One instance serves the whole server: the
 *     composition root builds it and passes it down, because the routes are
 *     registered once per router (boot/compose.ts).
 *
 * Pinned by pipeline/__tests__/keyed-serializer.test.ts.
 */
export class KeyedSerializer {
  private readonly tails = new Map<string, Promise<void>>();

  /** Keys with work running or queued; for the drain test and diagnostics. */
  get activeKeyCount(): number {
    return this.tails.size;
  }

  /**
   * Runs `work` once every earlier `work` for `key` has settled, whatever
   * its outcome, and resolves or rejects exactly as `work` does. Work for
   * other keys is never held up.
   */
  run<T>(key: string, work: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const result = previous.then(() => work());
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.tails.set(key, tail);
    return result.finally(() => {
      if (this.tails.get(key) === tail) {
        this.tails.delete(key);
      }
    });
  }
}
