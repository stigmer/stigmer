/**
 * The native engine's barrier before it takes a person's messages: the
 * stream loop has folded every event the graph produced before the take.
 *
 * LangGraph runs the graph ahead of the loop that reads its stream
 * (`turn-stream.ts` says why), so when the graph's input middleware
 * (`turn-input-middleware.ts`) is about to claim, the model's answer it
 * just finished may still sit in the stream unread. The server places a
 * claimed message at the head of the session's log, so a claim made then
 * would put the message before the answer the agent wrote first. The
 * middleware writes a barrier on the graph's custom stream and waits; the
 * loop, reading in order, folds everything before it, writes it
 * (`requestPersist`, which also carries a hosted engine's rows to the
 * runtime) and lets the take go on, so what the agent wrote is in the log
 * before the server moves the message.
 *
 * A barrier the loop never reaches (a graph streamed with no custom
 * writer, a loop stopped) lets the take go on after {@link BARRIER_WAIT_MS}:
 * the message is still read, in the order the log had.
 *
 * Proven by __tests__/input-barrier.test.ts and the harness contract kit's
 * message arms (the log order).
 */

/** The custom-stream event a barrier is written as. Wire-free: only this harness reads it. */
export const INPUT_BARRIER_EVENT = "stigmer_input_barrier";

/** How long a take waits for the loop before it goes on. */
export const BARRIER_WAIT_MS = 5_000;

/** The barriers of one turn: written by the middleware, reached by the loop. */
export class InputBarriers {
  private readonly waiting = new Map<string, () => void>();
  private next = 0;

  /**
   * Writes a barrier through `write` and resolves once the loop reached it,
   * or after `waitMs`; at once with no writer.
   */
  async cross(write: ((chunk: unknown) => void) | undefined, waitMs = BARRIER_WAIT_MS): Promise<void> {
    if (write === undefined) return;
    this.next += 1;
    const id = `barrier-${this.next}`;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const reached = new Promise<void>((resolve) => {
      this.waiting.set(id, resolve);
      timer = setTimeout(resolve, waitMs);
    });
    write({ name: INPUT_BARRIER_EVENT, barrier_id: id });
    await reached;
    clearTimeout(timer);
    this.waiting.delete(id);
  }

  /** The loop read barrier `id`: everything before it is folded. */
  reach(id: string): void {
    this.waiting.get(id)?.();
    this.waiting.delete(id);
  }
}

/** The barrier id a stream event carries; undefined for any other event. */
export function barrierIdOf(event: { readonly method?: unknown; readonly params?: unknown }): string | undefined {
  if (event.method !== "custom") return undefined;
  const data = (event.params as { readonly data?: unknown } | undefined)?.data;
  if (data === null || typeof data !== "object") return undefined;
  const { name, barrier_id: id } = data as { readonly name?: unknown; readonly barrier_id?: unknown };
  return name === INPUT_BARRIER_EVENT && typeof id === "string" ? id : undefined;
}
