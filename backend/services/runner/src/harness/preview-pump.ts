/**
 * The runtime's pump for a running tool's output: what a build prints
 * reaches the session while it runs, on every harness, without waiting for
 * the adapter's next persist.
 *
 * Why the runtime and not each adapter: the session event emitter queues a
 * preview for every `tool_output_delta` the transcript builder folds
 * (`events/emitter.ts`), and until now those previews left only with a
 * persist. A harness that streams output outside its loop's persist
 * decision (Claude's shell deltas arrive from the host's shell server), or a
 * tool that prints for minutes with nothing else happening, left them
 * queued until the result landed, when they are dropped (stigmer#2415).
 * The builder's observer sees every delta in both process modes (a hosted
 * turn's events are relayed to it at once), so a pump fed by the observer
 * covers every harness, the next one included.
 *
 * Its cadence is the streaming floor (`shared/streaming-scheduler.ts`,
 * 500 ms by default): at most one flush per interval, scheduled by the first
 * delta after a quiet spell. The flush goes through the persist
 * chokepoint's single flight (`PersistChokepoint.flushPreviews`); when a
 * write holds the slot nothing is sent and the pump tries again next
 * interval, so output never waits for a write that may not come.
 *
 * Timers are real and unref'd; nothing here keeps the process alive.
 * Proven by `__tests__/preview-pump.test.ts`, and end to end by the
 * contract kit's streamed-output arm.
 */

export interface PreviewPumpDeps {
  /** Whether a running tool's output waits to be sent (`SessionEventEmitter.toolOutputPending`). */
  readonly pending: () => boolean;
  /** Send it now if the slot is free; `false` when a write held it (`PersistChokepoint.flushPreviews`). */
  readonly flush: () => Promise<boolean>;
  /** The streaming floor: the least time between two flushes. */
  readonly intervalMs: number;
}

export class PreviewPump {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<void> | undefined;
  private stopped = false;

  constructor(private readonly deps: PreviewPumpDeps) {}

  /** A tool printed: schedule a flush unless one is already scheduled. */
  note(): void {
    if (this.stopped || this.timer !== undefined) return;
    this.timer = setTimeout(() => this.tick(), this.deps.intervalMs);
    this.timer.unref?.();
  }

  /** Stop scheduling, and wait for a flush already sending, so the turn's own writes never overlap one. */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    await this.running;
  }

  private tick(): void {
    this.timer = undefined;
    if (this.stopped || this.running !== undefined) return;
    this.running = this.deps
      .flush()
      .then(
        () => undefined,
        (err: unknown) => console.warn(`[preview-pump] flushing tool output failed: ${String(err)}`),
      )
      .finally(() => {
        this.running = undefined;
        // Output that arrived during the flush, or waited out a write that
        // held the slot, goes on the next interval.
        if (this.deps.pending()) this.note();
      });
  }
}
