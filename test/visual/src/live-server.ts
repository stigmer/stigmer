// The docs' scripted server: a conversation a reader can talk to on a docs
// page, with no agent behind it.
//
// It answers what the session view's scenes answer (scenes/session.tsx),
// over a conversation that grows, and the five calls a reader's acts make:
//
// - `run.create` and `run.sendMessage` start the scripted turn
//   (`scriptedTurn` in the kit's scenario catalogue, the one the terminal
//   recordings play) under the reader's own words: two file reads and an
//   ask to run a command, one event every `PACE_MS`, then the turn waits;
// - `session.confirmToolUse` and `session.grantPermission` answer the ask,
//   and the turn goes on to its answer, or to the agent's reply without the
//   command when the reader denies it;
// - `session.interrupt` stops whatever works, as the real server does: the
//   turn ends interrupted, and a message waiting behind it is dropped.
//
// A message sent while a turn works waits in the session's queue, as on the
// real server, and starts its own scripted turn when the working one ends.
// Every event is stamped with the page's clock as it is sent, so the
// conversation's durations read as they would live. The page reads no
// network: nothing leaves the browser.
import { clone, create } from "@bufbuild/protobuf";
import { Code, ConnectError, type ConnectRouter } from "@connectrpc/connect";
import type { Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunCommandController } from "@stigmer/apis/ai/stigmer/agentic/run/v1/command_pb";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { SendMessageResponseSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/io_pb";
import { SessionCommandController } from "@stigmer/apis/ai/stigmer/agentic/session/v1/command_pb";
import { SessionEventSchema, type SessionEvent } from "@stigmer/apis/ai/stigmer/agentic/session/v1/event_pb";
import {
  GrantPermissionResponseSchema,
  InterruptSessionResponseSchema,
} from "@stigmer/apis/ai/stigmer/agentic/session/v1/io_pb";
import { samples, scriptedTurn, type ScriptedTurn } from "@stigmer/react-sdk/test";
import type { Routes } from "./fake-server.ts";
import { sessionRoutes, type Answering, type LiveFeed, type SessionReplay } from "./scenes/session.tsx";

/** How long the server waits between two events of a scripted turn: slow enough to follow, quick enough to finish while read. */
export const PACE_MS = 500;

/** The run phase each `stigmer.run.status` puts its turn in. */
const PHASES: Readonly<Record<string, RunPhase>> = {
  running: RunPhase.RUN_IN_PROGRESS,
  waiting: RunPhase.RUN_WAITING_FOR_APPROVAL,
  completed: RunPhase.RUN_COMPLETED,
  failed: RunPhase.RUN_FAILED,
  cancelled: RunPhase.RUN_CANCELLED,
};

/** The turn the server is playing: its run, its script, and whether its ask has been answered. */
interface Playing {
  readonly runId: string;
  readonly script: ScriptedTurn;
  answered: boolean;
}

/** A message sent while a turn worked: its queued `user.message`'s id and text. */
interface Waiting {
  readonly id: string;
  readonly text: string;
}

/** The time an event carries, set to now as it is sent. */
function stamped(event: SessionEvent, seq: bigint): SessionEvent {
  const copy = clone(SessionEventSchema, event);
  copy.seq = seq;
  const value = copy.event.value;
  if (value !== undefined && "processedAt" in value) value.processedAt = new Date().toISOString();
  return copy;
}

/** The conversation `base` holds, growing as a reader talks to it. */
export class LiveConversation {
  private readonly events: SessionEvent[];
  private readonly runs: Run[];
  private readonly waiters = new Set<() => void>();
  /** Events of the playing turn not yet sent, in order. */
  private outbox: SessionEvent[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private playing: Playing | undefined;
  /** The base's own turn when it had not ended (a long turn at work): Stop ends it. */
  private baseWorking: string | undefined;
  private queue: Waiting[] = [];
  private turns = 0;

  constructor(
    private readonly base: SessionReplay,
    private readonly paceMs: number = PACE_MS,
  ) {
    this.events = [...base.events];
    this.runs = [...base.runs];
    const last = base.runs.at(-1);
    const phase = last?.status?.phase;
    if (last !== undefined && phase !== RunPhase.RUN_COMPLETED && phase !== RunPhase.RUN_FAILED && phase !== RunPhase.RUN_CANCELLED) {
      this.baseWorking = last.metadata?.id;
    }
  }

  /** The conversation as the scenes' routes read it: its events and runs as they stand at each call. */
  get replay(): SessionReplay {
    const conversation = this;
    return {
      session: this.base.session,
      loadError: this.base.loadError,
      liveness: this.base.liveness,
      files: this.base.files,
      get events() {
        return conversation.events;
      },
      get runs() {
        return conversation.runs;
      },
    };
  }

  /** What the follow streams after the replay's events. */
  readonly feed: LiveFeed = {
    after: (after, signal) =>
      new Promise((resolve) => {
        const check = () => {
          const fresh = this.events.filter((event) => event.seq > after);
          if (fresh.length === 0) return false;
          this.waiters.delete(check);
          resolve(fresh);
          return true;
        };
        if (check()) return;
        this.waiters.add(check);
        signal.addEventListener("abort", () => this.waiters.delete(check));
      }),
  };

  /** Whether a turn works: the base's, or one the server plays. */
  get working(): boolean {
    return this.baseWorking !== undefined || this.playing !== undefined;
  }

  /** Every call the conversation's viewer makes, and the five a reader's acts make. */
  routes(answering: Omit<Answering, "live"> = {}): Routes {
    const viewer = sessionRoutes(this.replay, { ...answering, live: this.feed });
    return (router: ConnectRouter) => {
      viewer(router);
      router.service(RunCommandController, {
        create: (run) => this.start(run.spec?.message ?? "").run,
        sendMessage: (run) => {
          const text = run.spec?.message ?? "";
          if (this.working) return create(SendMessageResponseSchema, { message: this.enqueue(text) });
          const { run: started, message } = this.start(text);
          return create(SendMessageResponseSchema, { run: started, message });
        },
      });
      router.service(SessionCommandController, {
        confirmToolUse: (input) => this.answer(input.toolUseId, input.result === "deny" ? "deny" : "allow"),
        grantPermission: (input) => create(GrantPermissionResponseSchema, { confirmations: [this.answer(input.toolUseId, "allow")] }),
        interrupt: () => {
          const stopped = this.stop();
          return create(InterruptSessionResponseSchema, { event: stopped.event, stoppedRunIds: stopped.runIds });
        },
      });
    };
  }

  /** Starts the scripted turn for `text` (under `messageId` when it waited in the queue): its first event now, the rest paced. */
  private start(text: string, messageId?: string): { run: Run; message: SessionEvent } {
    this.turns += 1;
    const runId = `run_live${String(this.turns).padStart(21, "0")}`;
    const script = scriptedTurn(text, runId);
    const [first, ...rest] = script.untilAsk;
    const opening = messageId === undefined ? first! : this.withId(first!, messageId);
    const run = samples.run({ id: runId, phase: RunPhase.RUN_PENDING, message: text });
    this.runs.push(run);
    this.playing = { runId, script, answered: false };
    const message = this.append(opening);
    this.play(rest);
    return { run, message };
  }

  /** A `user.message` with no run: the queue's sighting of a message sent while a turn works. */
  private enqueue(text: string): SessionEvent {
    const id = `live-queued-${this.queue.length + this.turns + 1}`;
    this.queue.push({ id, text });
    const sighting = create(SessionEventSchema, {
      sessionId: this.base.session?.metadata?.id ?? "",
      runId: "",
      event: { case: "userMessage", value: { id, content: [{ type: "text", text }] } },
    });
    return this.append(sighting, false);
  }

  /** The reader's answer to the playing turn's ask: their confirmation now, then the rest of the turn, paced. */
  private answer(toolUseId: string, result: "allow" | "deny"): SessionEvent {
    const playing = this.playing;
    if (playing === undefined || playing.answered || !toolUseId.startsWith(`${playing.runId}.`)) {
      throw new ConnectError("no tool call waits for an answer", Code.FailedPrecondition);
    }
    playing.answered = true;
    const [confirmation, ...rest] = result === "allow" ? playing.script.approved : playing.script.denied;
    const sent = this.append(confirmation!);
    this.play(rest);
    return sent;
  }

  /** Stops every turn that works, drops what waits behind it, and says which runs it stopped. */
  private stop(): { event: SessionEvent; runIds: string[] } {
    clearTimeout(this.timer);
    this.outbox = [];
    const runIds: string[] = [];
    const interrupt = this.append(
      create(SessionEventSchema, {
        sessionId: this.base.session?.metadata?.id ?? "",
        event: { case: "userInterrupt", value: { id: `live-interrupt-${this.events.length + 1}` } },
      }),
    );
    for (const runId of [this.baseWorking, this.playing?.runId]) {
      if (runId === undefined) continue;
      runIds.push(runId);
      const [cancelled] = scriptedTurn("", runId).stopped;
      this.append(cancelled!);
    }
    this.baseWorking = undefined;
    this.playing = undefined;
    this.queue = [];
    return { event: interrupt, runIds };
  }

  /** Sends `events` one every `paceMs`; when the last ends the turn, the next waiting message starts its own. */
  private play(events: readonly SessionEvent[]): void {
    this.outbox = [...events];
    const next = () => {
      const event = this.outbox.shift();
      if (event === undefined) return;
      this.append(event);
      if (this.outbox.length > 0) {
        this.timer = setTimeout(next, this.paceMs);
        return;
      }
      if (this.playing?.answered) {
        this.playing = undefined;
        const waiting = this.queue.shift();
        if (waiting !== undefined) this.timer = setTimeout(() => this.start(waiting.text, waiting.id), this.paceMs);
      }
    };
    this.timer = setTimeout(next, this.paceMs);
  }

  /** `event` appended at the log's next place and, when it carries a turn's phase, that turn's run moved to it. */
  private append(event: SessionEvent, stamp = true): SessionEvent {
    const seq = BigInt(this.events.length + 1);
    const sent = stamp ? stamped(event, seq) : { ...event, seq };
    this.events.push(sent);
    if (sent.event.case === "stigmerRunStatus") {
      const phase = PHASES[sent.event.value.phase];
      const run = this.runs.find((candidate) => candidate.metadata?.id === sent.runId);
      if (phase !== undefined && run?.status !== undefined) run.status.phase = phase;
    }
    for (const waiter of [...this.waiters]) waiter();
    return sent;
  }

  /** `event` with its id replaced: a queued message keeps its id when its turn reads it. */
  private withId(event: SessionEvent, id: string): SessionEvent {
    const copy = clone(SessionEventSchema, event);
    if (copy.event.value !== undefined) copy.event.value.id = id;
    return copy;
  }
}
