// A test double for a session's event follow (`session.streamEvents`): it
// yields the stored events first, then stays open, as a real follow does,
// delivering each event a test pushes until the follow is aborted. Events
// are numbered (`seq`) in the order they are delivered.
//
// One of two copies, the other
// `sdk/react-core/src/session/__tests__/session-event-stream.ts`: neither
// package's tests can import the other's (the conversation core never depends
// on the React kit, and test files are not published), so a change to one is
// made to both.

import { vi } from "vitest";
import type { SessionEvent } from "@stigmer/apis/ai/stigmer/agentic/session/v1/event_pb";
import type {
  StreamSessionEventsRequest,
  StreamSessionEventsResponse,
} from "@stigmer/apis/ai/stigmer/agentic/session/v1/io_pb";
import { samples } from "@stigmer/react-core/test";

/** A controllable `session.streamEvents`. */
export interface SessionEventStream {
  /** The mock to install as `client.session.streamEvents`. */
  readonly streamEvents: ReturnType<typeof vi.fn<
    (input: StreamSessionEventsRequest, signal?: AbortSignal) => AsyncGenerator<StreamSessionEventsResponse>
  >>;
  /** Deliver events to every open follow. */
  readonly push: (...events: SessionEvent[]) => void;
}

/** A follow that holds `stored` and stays open for what {@link SessionEventStream.push} sends. */
export function sessionEventStream(stored: readonly SessionEvent[] = []): SessionEventStream {
  const log: SessionEvent[] = [];
  const waiters = new Set<() => void>();
  const append = (events: readonly SessionEvent[]): void => {
    for (const event of events) log.push({ ...event, seq: BigInt(log.length + 1) });
  };
  append(stored);

  const streamEvents = vi.fn(async function* follow(
    _input: StreamSessionEventsRequest,
    signal?: AbortSignal,
  ): AsyncGenerator<StreamSessionEventsResponse> {
    let delivered = 0;
    while (signal?.aborted !== true) {
      while (delivered < log.length) {
        yield samples.eventFrame(log[delivered]!);
        delivered += 1;
      }
      await new Promise<void>((resolve) => {
        waiters.add(resolve);
        signal?.addEventListener("abort", () => resolve(), { once: true });
      });
    }
  });

  return {
    streamEvents,
    push: (...events) => {
      append(events);
      const wake = [...waiters];
      waiters.clear();
      for (const resolve of wake) resolve();
    },
  };
}
