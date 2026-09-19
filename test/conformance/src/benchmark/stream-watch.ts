// Watches one execution through `AgentExecution.subscribe`, the lane a console
// reads a turn on, and stamps on the client's clock the two instants the
// parity work is judged by: when the user first saw something (a root AI or
// THINKING row with content) and when the turn ended (the message carrying
// the terminal phase).
// Domain: conformance benchmark (the client-clock axes).
//
// Consumption goes through `support/collect-stream.ts`, the one bounded
// reader of a server stream in this workspace; its `until` predicate runs at
// every arrival, so the receive stamps are taken there and the helper needs
// no second hook. The subscription can only open after `create()` has
// returned the id, so every axis here starts at the CREATE CALL's start, the
// instant the caller hands in: that is the console's own experience, and the
// runner's `turn_phases` line carries the precise activity-relative instants
// beside it. The stamps are quantised to the runner's persist cadence, which
// is what the console sees too.
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { ConformanceClients } from "../harness/clients";
import { isTerminalPhase } from "../support/agentexecutions";
import { collectStream, type CollectedStream } from "../support/collect-stream";
import { visibleRows } from "./status-facts";

export interface WatchOptions {
  /** `Date.now()` immediately before the create call the execution came from. */
  startedAtMs: number;
  /** How long to wait for the terminal phase before giving up (the sample is then a `timeout`). */
  timeoutMs: number;
  /** Injected for tests; `Date.now` in production. */
  now?: () => number;
}

export interface WatchedExecution {
  /** Client clock, from `startedAtMs`; `null` when never seen. */
  client_first_visible_token_ms: number | null;
  client_first_text_ms: number | null;
  /** Client clock, from `startedAtMs`, when the terminal message arrived; `null` on timeout. */
  end_to_end_ms: number | null;
  /** The last snapshot received, terminal when `outcome` is `until`. */
  final: AgentExecution | undefined;
  outcome: CollectedStream<AgentExecution>["outcome"];
}

/** The stream factory a watch consumes; the clients' subscribe by default, injectable for tests. */
export type SubscribeFactory = (signal: AbortSignal) => AsyncIterable<AgentExecution>;

export function subscribeTo(clients: ConformanceClients, executionId: string): SubscribeFactory {
  return (signal) => clients.agentExecutionQuery.subscribe({ value: executionId }, { signal });
}

export async function watchExecution(subscribe: SubscribeFactory, options: WatchOptions): Promise<WatchedExecution> {
  const now = options.now ?? Date.now;
  let firstVisible: number | null = null;
  let firstText: number | null = null;
  let terminalAt: number | null = null;

  const collected = await collectStream(subscribe, {
    timeoutMs: options.timeoutMs,
    until: (messages) => {
      const latest = messages[messages.length - 1];
      if (latest === undefined) return false;
      const at = now();
      const rows = visibleRows(latest);
      if (rows.visible && firstVisible === null) firstVisible = at;
      if (rows.text && firstText === null) firstText = at;
      if (isTerminalPhase(latest.status?.phase)) {
        terminalAt = at;
        return true;
      }
      return false;
    },
  });

  const relative = (at: number | null): number | null => (at === null ? null : at - options.startedAtMs);
  return {
    client_first_visible_token_ms: relative(firstVisible),
    client_first_text_ms: relative(firstText),
    end_to_end_ms: relative(terminalAt),
    final: collected.messages[collected.messages.length - 1],
    outcome: collected.outcome,
  };
}
