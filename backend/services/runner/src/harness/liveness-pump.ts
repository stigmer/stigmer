/**
 * The runtime's liveness pump: a working turn says what it is doing. While
 * the engine runs, the runtime sends a `stigmer.run.liveness` preview naming
 * each operation the turn has open and how long it has been open, and how
 * long the turn has waited on its model, on every harness.
 *
 * Why it exists: a ten-minute build prints nothing, and the console could
 * only guess from the silence ("taking longer than usual"), whether the
 * runner was alive or dead, and a harness whose tool use reaches the log
 * only once its row is past the boundary (`events/emitter.ts`) showed no
 * running tool at all. With this preview the console
 * shows "Running shell · 14 min", and silence means what it says: no word
 * from the turn at all.
 *
 * Why the runtime: the open operations are its fold (`open-operations.ts`),
 * fed for every harness by the one transcript observer, so one pump covers
 * every harness, the next one included. A hosted turn's operations fold
 * into this process's fold too, so nothing crosses the host protocol.
 *
 * Cadence: at once when the turn starts, at once (no sooner than the
 * streaming floor after the last send) when the open set changes or the
 * turn starts or stops waiting on its model, and every `intervalMs`
 * (`Config.livenessIntervalMs`, 30 s by default) whether or not anything is
 * open, so a watcher that reconnects learns within the interval. The
 * durations are measured here when a preview is sent, never wall-clock
 * instants: a watcher whose clock is skewed still shows the right age.
 *
 * Each preview goes alone, through the persist chokepoint's single flight
 * (`PersistChokepoint.flushLiveness`): a server older than the preview
 * refuses the append as invalid (the preview's oneof is required), and that
 * refusal must never cost a stored event or another preview. On the first
 * refusal the pump stops for the turn, logged once. A preview is
 * ephemeral: one that fails is not resent; the next one says it again.
 *
 * Timers are real and unref'd; nothing here keeps the process alive.
 * Proven by `__tests__/liveness-pump.test.ts`, and end to end on every
 * harness by the contract kit's liveness arm.
 */

import type { OperationsSnapshot } from "./open-operations.js";

/** Default liveness interval (ms), `Config.livenessIntervalMs`: the module header's cadence. */
export const DEFAULT_LIVENESS_INTERVAL_MS = 30_000;

/** How one send went: sent (or failed and logged), the slot busy, or refused by the server. */
export type LivenessSend = "sent" | "busy" | "refused";

export interface LivenessPumpDeps {
  /** What the turn has open now (`OpenOperations.snapshot`). */
  readonly snapshot: () => OperationsSnapshot;
  /** Send it alone if the slot is free (`PersistChokepoint.flushLiveness`). */
  readonly send: (snapshot: OperationsSnapshot) => Promise<LivenessSend>;
  /** The interval between two sends while nothing changes. */
  readonly intervalMs: number;
  /** The least time between two sends a change prompts: the streaming floor. */
  readonly minGapMs: number;
  /** Named in the one log line a refusal writes. */
  readonly runId: string;
}

export class LivenessPump {
  private interval: ReturnType<typeof setTimeout> | undefined;
  private soon: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<void> | undefined;
  private stopped = false;
  /** The open set and model wait the last sent preview named. */
  private sentKey: string | undefined;

  constructor(private readonly deps: LivenessPumpDeps) {}

  /** The turn's engine starts: say so now, and every interval from then on. */
  start(): void {
    this.tick();
  }

  /** The fold saw an event that may change what is open: send soon if it did. */
  note(): void {
    if (keyOf(this.deps.snapshot()) !== this.sentKey) this.soonTick();
  }

  /** A send on the streaming floor, unless one is already scheduled. */
  private soonTick(): void {
    if (this.stopped || this.soon !== undefined) return;
    this.soon = setTimeout(() => {
      this.soon = undefined;
      this.tick();
    }, this.deps.minGapMs);
    this.soon.unref?.();
  }

  /** Stop scheduling, and wait for a send already in flight, so the turn's own writes never overlap one. */
  async stop(): Promise<void> {
    this.stopped = true;
    this.clear();
    await this.running;
  }

  private clear(): void {
    if (this.interval !== undefined) clearTimeout(this.interval);
    if (this.soon !== undefined) clearTimeout(this.soon);
    this.interval = undefined;
    this.soon = undefined;
  }

  private tick(): void {
    if (this.stopped || this.running !== undefined) return;
    const snapshot = this.deps.snapshot();
    let busy = false;
    this.running = this.deps
      .send(snapshot)
      .then(
        (outcome) => {
          busy = outcome === "busy";
          if (outcome === "refused") {
            console.warn(
              `[liveness] run=${this.deps.runId}: the server refused the liveness preview (a server older than it); not sent again this turn`,
            );
            this.stopped = true;
            this.clear();
            return;
          }
          if (outcome === "sent") this.sentKey = keyOf(snapshot);
        },
        (err: unknown) => console.warn(`[liveness] run=${this.deps.runId}: sending the liveness preview failed: ${String(err)}`),
      )
      .finally(() => {
        this.running = undefined;
        if (this.stopped) return;
        // The next interval counts from this send; a change that arrived
        // during it, or a slot a write held, goes on the streaming floor.
        if (this.interval !== undefined) clearTimeout(this.interval);
        this.interval = setTimeout(() => this.tick(), this.deps.intervalMs);
        this.interval.unref?.();
        if (busy) this.soonTick();
        else this.note();
      });
  }
}

/** What a preview names, without the ages that grow between two sends. */
function keyOf(snapshot: OperationsSnapshot): string {
  const open = snapshot.operations.map((operation) => operation.callId).join(",");
  return `${open}|${snapshot.awaitingModelMs === undefined ? "" : "model"}`;
}
