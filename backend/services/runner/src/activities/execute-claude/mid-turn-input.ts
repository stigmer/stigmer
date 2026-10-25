/**
 * The messages a person sends while a Claude turn works
 * (`harness/turn-input.ts`), taken where the engine reads them.
 *
 * The engine reads a message pushed into its open prompt while a tool call
 * runs with that call's result, before its next model call; one pushed once
 * the call has ended waits for a later step (measured on SDK 0.3.310). So
 * the queue is taken while a call is open and the model's message that made
 * it has finished: when that message finishes with the runtime's hint up, or
 * when the hint rises afterwards (`TurnInputChannel.onPending`). What was
 * folded is persisted first, so each message sits in the session's log after
 * the agent's words that came before it (the log writes a message once it
 * is finished), where the agent read it. At each result, before the turn
 * may end, the queue is taken once more whatever the hint says; a message
 * taken then is the engine's next round of the same turn. Each message is pushed under its own id (`engine-session-id.ts`
 * `sentMessageIdOf`).
 *
 * A pushed message is read once the engine reports taking it up
 * ({@link MidTurnInput.observe}); the turn ends only once every pushed
 * message is read. A turn that is stopping or
 * yielding takes nothing: what waits is its continuation's to read.
 */

import type { SDKMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";

import type { TurnMessage } from "../../harness/turn-input.js";
import type { TurnSink } from "../../harness/types.js";
import { toAnthropicImageBlocks } from "../../shared/attachment-vision.js";
import { userMessageOf } from "./engine-options.js";
import { sentMessageIdOf } from "./engine-session-id.js";
import type { PromptStream } from "./prompt-stream.js";

/** A message sent while the turn worked, as the engine reads it, under its own id: its images first, then its text. */
export function sentMessageOf(message: TurnMessage): SDKUserMessage {
  const content: SDKUserMessage["message"]["content"] =
    message.visionImages.length === 0 ? message.text : [...toAnthropicImageBlocks(message.visionImages), { type: "text", text: message.text }];
  return userMessageOf(content, sentMessageIdOf(message.id));
}

/** The engine's frame reporting a pushed message's progress, by its id. */
const COMMAND_LIFECYCLE = "command_lifecycle";

/** The lifecycle states after which the engine has taken a message up. */
const READ_STATES: ReadonlySet<string> = new Set(["started", "completed", "cancelled"]);

/** One invocation's mid-turn input (the header). */
export class MidTurnInput {
  /** Sent-message ids pushed and not yet read. */
  private readonly unread = new Set<string>();
  private halted = false;

  constructor(
    private readonly sink: Pick<TurnSink, "input" | "transcript" | "requestPersist">,
    private readonly stream: Pick<PromptStream, "push">,
  ) {}

  /** The turn is stopping or yielding: nothing more is taken. */
  halt(): void {
    this.halted = true;
  }

  /** Whether a pushed message is still unread. */
  get owed(): boolean {
    return this.unread.size > 0;
  }

  /** While a call is open and its message has finished: persist, then take what the hint says waits (the header). */
  async whileWorking(): Promise<void> {
    if (this.halted || !this.sink.input.pending()) return;
    await this.take(false);
  }

  /** At a result: persist, then take whatever waits (the header). */
  async atResult(): Promise<void> {
    if (this.halted) return;
    await this.take(true);
  }

  private async take(force: boolean): Promise<void> {
    this.sink.transcript.markPersisted();
    await this.sink.requestPersist();
    if (this.halted) return;
    for (const message of await this.sink.input.claim(force ? { force: true } : {})) {
      const sent = sentMessageOf(message);
      this.unread.add(String(sent.uuid));
      this.stream.push(sent);
    }
  }

  /**
   * Mark read every pushed message the engine has begun: its
   * `command_lifecycle` frame names the message's id once the engine takes
   * it up (`started`), or ends it (`completed`, `cancelled`). The frame is
   * outside the SDK's typed message union (0.3.310), so it is read by shape;
   * a reply frame's typed `user_message_uuids`, which names a message only
   * when a turn starts from it, counts too.
   */
  observe(message: SDKMessage): void {
    const lifecycle = message as { readonly type: string; readonly command_uuid?: unknown; readonly state?: unknown };
    if (lifecycle.type === COMMAND_LIFECYCLE && typeof lifecycle.command_uuid === "string" && READ_STATES.has(String(lifecycle.state))) {
      this.unread.delete(lifecycle.command_uuid);
      return;
    }
    if (message.type !== "assistant" && message.type !== "stream_event") return;
    if (message.parent_tool_use_id !== null) return;
    for (const id of message.user_message_uuids ?? []) this.unread.delete(id);
  }
}
