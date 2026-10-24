/**
 * The runtime's pump for a person's stop of one background command: a
 * person who presses Stop on a command the agent runs in the background
 * stops that command, within seconds, whatever the agent is doing.
 *
 * The stop is a session event the server writes
 * (`stigmer.background_command.stop_requested`, by
 * `SessionCommandController.stopBackgroundCommand`), and nothing pushes to a
 * running invocation: a status write's answer arrives only when the engine
 * has something to persist, and the moment a stop matters most, the turn
 * waiting at a reply's end for its commands, writes nothing. So while a
 * command runs, the pump reads the run's stop requests every
 * {@link BACKGROUND_STOP_POLL_MS}: one page of one type of the run's events,
 * which the log indexes by run and type, and none at all while no command
 * runs.
 *
 * What it knows of the commands is what the builder's observer tells it, in
 * both process modes (a hosted turn's facts are relayed to the runtime's
 * builder): a `background_command_started` adds a command, its
 * `background_command_ended` removes it. A request names the starting
 * call's tool use; the pump derives each running command's tool use id the
 * emitter's way (`events/ids.ts` `toolUseEventId`) and compares, so it needs
 * no reverse step from a hashed id. Each command's call id is handed once to
 * the listeners of {@link onStop}, which the turn's sink exposes as
 * `TurnSink.backgroundStops`; a request for a command this invocation does
 * not run (an earlier invocation's, already stopped with it) matches
 * nothing.
 *
 * A failed read is logged once per turn and tried again next interval; the
 * stop is not lost, only late. Timers are real and unref'd; nothing here
 * keeps the process alive. Proven by `__tests__/background-stops.test.ts`,
 * and end to end by the native background binding and the
 * background-command conformance suite.
 */

import type { SessionEvent } from "@stigmer/apis/ai/stigmer/agentic/session/v1/event_pb";

import { toolUseEventId } from "./events/ids.js";
import type { TranscriptEvent } from "./transcript/events.js";

/** How often a turn with a command running reads its run's stop requests. */
export const BACKGROUND_STOP_POLL_MS = 2_000;

/** The event a person's stop is written as. */
export const BACKGROUND_STOP_REQUESTED_TYPE = "stigmer.background_command.stop_requested";

export interface BackgroundStopPumpDeps {
  readonly runId: string;
  /** The run's stop requests, oldest first (`StigmerClient.listRunSessionEvents` with {@link BACKGROUND_STOP_REQUESTED_TYPE}). */
  readonly read: () => Promise<readonly SessionEvent[]>;
  /** The interval between two reads while a command runs. */
  readonly intervalMs?: number;
}

export class BackgroundStopPump {
  /** The commands running now, by call id, each with its tool use id. */
  private readonly running = new Map<string, string>();
  private readonly delivered = new Set<string>();
  private readonly listeners = new Set<(callId: string) => void>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private reading: Promise<void> | undefined;
  private stopped = false;
  private warned = false;

  constructor(private readonly deps: BackgroundStopPumpDeps) {}

  /** A folded transcript event: a command started or ended. */
  observe(event: TranscriptEvent): void {
    if (event.kind === "background_command_started") {
      if (this.delivered.has(event.callId)) return;
      this.running.set(event.callId, toolUseEventId(this.deps.runId, event.callId));
      this.schedule();
    } else if (event.kind === "background_command_ended") {
      this.running.delete(event.callId);
      if (this.running.size === 0) this.clear();
    }
  }

  /** Be told each command a person stopped, by its call id, once; returns the unsubscribe. */
  onStop(listener: (callId: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Stop reading. A read already in flight is not waited for: it only reads,
   * and once stopped it hands nothing on, so the turn's own writes never wait
   * on the log's answer.
   */
  stop(): void {
    this.stopped = true;
    this.clear();
  }

  private schedule(): void {
    if (this.stopped || this.timer !== undefined || this.reading !== undefined || this.running.size === 0) return;
    this.timer = setTimeout(() => this.tick(), this.deps.intervalMs ?? BACKGROUND_STOP_POLL_MS);
    this.timer.unref?.();
  }

  private clear(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private tick(): void {
    this.timer = undefined;
    if (this.stopped || this.running.size === 0) return;
    this.reading = this.deps
      .read()
      .then(
        (requests) => this.deliver(requests),
        (err: unknown) => {
          if (this.warned) return;
          this.warned = true;
          console.warn(`[background-stops] run=${this.deps.runId}: reading the stop requests failed; trying again: ${String(err)}`);
        },
      )
      .finally(() => {
        this.reading = undefined;
        this.schedule();
      });
  }

  private deliver(requests: readonly SessionEvent[]): void {
    const asked = new Set(
      requests.flatMap((event) => (event.event.case === "stigmerBackgroundCommandStopRequested" ? [event.event.value.toolUseId] : [])),
    );
    for (const [callId, toolUseId] of [...this.running]) {
      if (this.stopped || !asked.has(toolUseId) || this.delivered.has(callId)) continue;
      this.delivered.add(callId);
      this.running.delete(callId);
      for (const listener of [...this.listeners]) {
        try {
          listener(callId);
        } catch (err) {
          console.error(`[background-stops] run=${this.deps.runId}: a stop listener failed: ${String(err)}`);
        }
      }
    }
  }
}
