// Follows one session's log over the native stream for the whole of a long
// turn, as a client that never gives up does, and records every seq it is
// sent; and follows what needs the run's person in its organization, as the
// console's notifier does, and records every attention it is told.
// Domain: conformance long turn (the streaming follower; hand-run only).
//
// It opens the stream from the session's first event (`after_seq` 0) and,
// whenever a stream ends with a code a client retries (a server restart ends
// every stream `UNAVAILABLE`; a restart's gap fails the open itself), opens it
// again after the last seq it holds. Nothing is deduplicated or reordered:
// the seqs are kept in arrival order, so the report can say whether the
// stream sent each event of the log once and in order (report.ts
// `followerCheckOf`). A code no client retries ends the follower, and its
// name is the last ending recorded.

import { Code, ConnectError } from "@connectrpc/connect";
import type { Attention, StreamAttentionRequest } from "@stigmer/apis/ai/stigmer/agentic/session/v1/io_pb";
import { followAttention } from "@stigmer/client";
import type { ConformanceClients } from "../harness/clients";

/* v8 ignore start -- @preserve: the real-clock and live runs are hand-run scripts no vitest config collects; the unit lane tests the check this feeds (report.ts) */
const RETRIED = new Set([Code.Unavailable, Code.Canceled, Code.Unknown, Code.Internal]);
const FIRST_RETRY_MS = 250;
const MAX_RETRY_MS = 5_000;

export class SessionFollower {
  /** Every seq the follower was sent, in arrival order. */
  readonly seqs: number[] = [];
  /** Each event's id, beside its seq in `seqs`: a queued message moved to the head comes back under its id. */
  readonly ids: string[] = [];
  /** How each stream that ended before `stop` ended: a status code's name, or "ended cleanly". */
  readonly endings: string[] = [];
  private readonly abort = new AbortController();
  private readonly done: Promise<void>;

  constructor(clients: ConformanceClients, sessionId: string) {
    this.done = this.follow(clients, sessionId);
  }

  private async follow(clients: ConformanceClients, sessionId: string): Promise<void> {
    let retryMs = FIRST_RETRY_MS;
    while (!this.abort.signal.aborted) {
      const before = this.seqs.length;
      try {
        const afterSeq = BigInt(this.seqs.at(-1) ?? 0);
        for await (const frame of clients.sessionQuery.streamEvents({ sessionId, afterSeq }, { signal: this.abort.signal })) {
          if (frame.frame.case === "event") {
            const event = frame.frame.value;
            this.seqs.push(Number(event.seq));
            this.ids.push(event.event.case === undefined ? "" : event.event.value.id);
          }
        }
        this.endings.push("ended cleanly");
      } catch (error) {
        if (this.abort.signal.aborted) return;
        const code = ConnectError.from(error).code;
        this.endings.push(Code[code]);
        if (!RETRIED.has(code)) return;
      }
      // A stream that delivered resumes at once; a run of empty ones (a
      // server between processes) backs off, so the gap costs a few tries.
      retryMs = this.seqs.length > before ? FIRST_RETRY_MS : Math.min(retryMs * 2, MAX_RETRY_MS);
      await new Promise((resolve) => setTimeout(resolve, retryMs));
    }
  }

  /** Resolves true once the follower holds `seq`, false when `budgetMs` passes first. */
  async until(seq: number, budgetMs: number): Promise<boolean> {
    const deadline = Date.now() + budgetMs;
    while ((this.seqs.at(-1) ?? 0) < seq) {
      if (Date.now() > deadline) return false;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    return true;
  }

  async stop(): Promise<void> {
    this.abort.abort();
    await this.done;
  }
}

/**
 * Follows what needs the run's person in its organization
 * (`SessionQueryController.streamAttention`) for the whole turn, as the
 * console's notifier does: `followAttention` reconnects across a server's
 * restart from the last attention it delivered, and delivers each once.
 */
export class AttentionFollower {
  /** Every attention it was told, in arrival order. */
  readonly told: Attention[] = [];
  private readonly abort = new AbortController();
  private readonly done: Promise<void>;

  constructor(clients: ConformanceClients, org: string) {
    const client = {
      session: {
        streamAttention: (input: StreamAttentionRequest, signal?: AbortSignal) => clients.sessionQuery.streamAttention(input, { signal }),
      },
    };
    this.done = (async () => {
      try {
        for await (const attention of followAttention(client, org, { signal: this.abort.signal })) this.told.push(attention);
      } catch (error) {
        if (!this.abort.signal.aborted) console.log(`[long-turn] the attention follower ended: ${ConnectError.from(error).message}`);
      }
    })();
  }

  /** Resolves true once it was told something about `sessionId`, false when `budgetMs` passes first. */
  async until(sessionId: string, budgetMs: number): Promise<boolean> {
    const deadline = Date.now() + budgetMs;
    while (!this.told.some((attention) => attention.sessionId === sessionId)) {
      if (Date.now() > deadline) return false;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    return true;
  }

  async stop(): Promise<void> {
    this.abort.abort();
    await this.done;
  }
}
/* v8 ignore stop */
