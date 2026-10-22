/**
 * A turn's mid-turn input: the messages a person sends to the session while
 * the turn works, which the server queues for it (the session's queue,
 * `RunCommandController.sendMessage`), and which the turn takes where its
 * engine can deliver them.
 *
 * Two facts, one owner each:
 *
 *   - **pending** is the server's answer to the turn's newest status write
 *     (`UpdateStatusResponse.input_pending`, read under the same lock as the
 *     write): the persist chokepoint records it on every write that landed,
 *     and a write that failed leaves the last answer. It only says a claim
 *     would take something; nothing is taken because of it.
 *   - **claim** takes the queue (`SessionCommandController.claimInput`): the
 *     server moves every waiting message to the head of the log as this
 *     run's, and answers them in the order sent. An engine claims only at a
 *     point where it delivers what it takes, so each message sits in the log
 *     where the agent read it. What a claim takes is the turn's to deliver,
 *     at that point or, when the engine cannot take it now, as one more round
 *     of the same turn before the turn may complete; a taken message never
 *     waits for a next turn.
 *
 * What a run took is in the log as its own `user.message` events after the
 * ones it started with (`claimed`): an engine that continues a turn, or
 * ends one, delivers each it has not, so a message whose claim answer was
 * lost, or that a stopped invocation took and never handed its engine, is
 * still read by this turn.
 *
 * Without `force`, a claim makes no call while nothing is pending: Cursor
 * steers at the hint. With it, a claim always asks: an engine about to
 * finish its round asks once, so a message that arrived after the newest
 * write is still read by this turn, and the native engine asks at every
 * model call, since a silent tool writes no status to refresh the hint. A claim
 * runs one at a time; a second while one is in flight shares its answer.
 *
 * The server takes only messages sent with the turn's own authority (its
 * sender and the person it records); another sender's wait for a turn of
 * their own, and the pending hint counts only the turn's.
 *
 * The message as an engine reads it (`TurnMessage`): its text blocks joined
 * by a blank line, as a turn's own message is, and its files as the turn's
 * own are shown (`turn-context.ts` `mountMessageFiles`): mounted under the
 * conversation's `uploads/`, each an image or a document, the images the
 * model can see inline. A claim mounts files only when a message it took
 * carries some; a mount that fails fails the claim, as a File that cannot
 * be fetched fails a turn. A claim the server does not answer (a transport
 * fault) takes nothing and keeps the hint, so the next one asks again: the
 * messages still wait, and a turn never fails for a message it could not
 * fetch.
 *
 * Proven by __tests__/turn-input.test.ts.
 */
import type { ContentBlock } from "@stigmer/apis/ai/stigmer/agentic/session/v1/event_content_pb";
import type { SessionEvent } from "@stigmer/apis/ai/stigmer/agentic/session/v1/event_pb";

import type { MessageFilesView } from "./turn-context.js";

/** A message a person sent while the turn worked, as the turn delivers it. */
export interface TurnMessage extends MessageFilesView {
  /** The message's `user.message` id: the one way to tell it was delivered. */
  readonly id: string;
  readonly text: string;
}

/** How a claim shows a message's files (`turn-context.ts` `mountMessageFiles`). */
export type MessageFilesResolver = (blocks: readonly ContentBlock[]) => Promise<MessageFilesView>;

/** The log type of a person's message. */
export const USER_MESSAGE_EVENT_TYPE = "user.message";

/** A message with no files, as a claim answers it. */
const NO_FILES: MessageFilesView = { message: [], visionImages: [], visionNotViewable: [] };

/** The turn's input channel (`TurnSink.input`). */
export interface TurnInputChannel {
  /** Whether the session's queue holds messages for this turn, as the newest status write answered. */
  pending(): boolean;
  /** Calls `listener` each time pending turns true; returns the unsubscribe. */
  onPending(listener: () => void): () => void;
  /** Takes the session's queued messages for this turn (module header); none when nothing waits. */
  claim(options?: { readonly force?: boolean }): Promise<TurnMessage[]>;
  /** Every message this run took while it worked, in the order taken, but those `delivered` names (module header). */
  claimed(delivered: ReadonlySet<string>): Promise<TurnMessage[]>;
}

/** The runtime's side of the channel: it records each write's answer. */
export interface RuntimeTurnInput extends TurnInputChannel {
  setPending(pending: boolean): void;
}

/** How texts of one message's blocks join: as a turn's own message's blocks do. */
const TEXT_SEPARATOR = "\n\n";

/**
 * A `user.message` as the turn delivers it, its files shown by `resolveFiles`
 * when it carries any; undefined for any other event.
 */
export async function turnMessageOf(event: SessionEvent, resolveFiles: MessageFilesResolver): Promise<TurnMessage | undefined> {
  if (event.event.case !== "userMessage") {
    return undefined;
  }
  const { id, content } = event.event.value;
  const text = content
    .filter((block) => block.type === "text" && block.text !== "")
    .map((block) => block.text)
    .join(TEXT_SEPARATOR);
  const files = content.filter((block) => block.source?.type === "file");
  return { id, text, ...(files.length === 0 ? NO_FILES : await resolveFiles(files)) };
}

/**
 * The messages a run took while it worked, among its `user.message` events
 * in log order: every one but those it started with, which are the
 * messages its creation took from the queue (`spec.queued_message_ids`)
 * or, with none, its first.
 */
export function takenWhileWorking(
  events: ReadonlyArray<SessionEvent>,
  queuedMessageIds: ReadonlyArray<string>,
): SessionEvent[] {
  const messages = events.filter((event) => event.event.case === "userMessage");
  if (queuedMessageIds.length === 0) return messages.slice(1);
  const startedWith = new Set(queuedMessageIds);
  return messages.filter((event) => !startedWith.has(event.event.value?.id ?? ""));
}

/** The server's side of the channel: the claim call, and the run's own messages as the log holds them. */
export interface TurnInputServer {
  claim(): Promise<ReadonlyArray<SessionEvent>>;
  /** The run's `user.message` events, in log order. */
  runMessages(): Promise<ReadonlyArray<SessionEvent>>;
  /** The messages the run's creation took from the queue (`spec.queued_message_ids`). */
  readonly queuedMessageIds: () => ReadonlyArray<string>;
}

/** The channel over the runner's claim call (`client.claimInput`), showing files through `resolveFiles`. */
export function newTurnInput(server: TurnInputServer, resolveFiles: MessageFilesResolver): RuntimeTurnInput {
  const resolveAll = async (events: ReadonlyArray<SessionEvent>): Promise<TurnMessage[]> => {
    const messages: TurnMessage[] = [];
    for (const event of events) {
      const message = await turnMessageOf(event, resolveFiles);
      if (message !== undefined) messages.push(message);
    }
    return messages;
  };
  let pending = false;
  let inFlight: Promise<TurnMessage[]> | undefined;
  const listeners = new Set<() => void>();
  return {
    pending: () => pending,
    setPending(next) {
      const rose = next && !pending;
      pending = next;
      if (rose) {
        for (const listener of [...listeners]) listener();
      }
    },
    onPending(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async claim(options = {}) {
      if (!pending && options.force !== true) {
        return [];
      }
      inFlight ??= (async () => {
        let events: ReadonlyArray<SessionEvent>;
        try {
          events = await server.claim();
        } catch (error) {
          console.warn(`[turn-input] the session's queued messages could not be claimed; the next claim asks again: ${String(error)}`);
          return [];
        }
        pending = false;
        return resolveAll(events);
      })().finally(() => {
        inFlight = undefined;
      });
      return inFlight;
    },
    async claimed(delivered) {
      const taken = takenWhileWorking(await server.runMessages(), server.queuedMessageIds());
      return resolveAll(taken.filter((event) => !delivered.has(event.event.value?.id ?? "")));
    },
  };
}

/** A channel that never has input: a turn whose session has no queue to read (tests, a turn in no session). */
export const NO_TURN_INPUT: TurnInputChannel = {
  pending: () => false,
  onPending: () => () => undefined,
  claim: async () => [],
  claimed: async () => [],
};
