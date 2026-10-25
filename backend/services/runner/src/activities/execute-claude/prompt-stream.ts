/**
 * The prompt an invocation hands the Claude engine: a stream of user
 * messages held open until the turn's result, never a string.
 *
 * Held open because the SDK answers the engine's hook and permission
 * requests over the same channel the prompt feeds (measured: a stream that
 * closes at once leaves a gated call refused), and because a message a
 * person sends while the turn works is pushed into it, reaching the engine
 * before its next model call. Closed once the turn's last result has
 * arrived, which ends the engine's process.
 */

import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";

/** A held prompt stream (the header). */
export class PromptStream implements AsyncIterable<SDKUserMessage> {
  private readonly queue: SDKUserMessage[] = [];
  private wake: (() => void) | undefined;
  private closed = false;

  /** Hand the engine one more message; ignored once closed. */
  push(message: SDKUserMessage): void {
    if (this.closed) return;
    this.queue.push(message);
    this.wake?.();
  }

  /** End the stream: the engine reads what is queued, then the end. */
  close(): void {
    this.closed = true;
    this.wake?.();
  }

  get isClosed(): boolean {
    return this.closed;
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: async (): Promise<IteratorResult<SDKUserMessage>> => {
        while (this.queue.length === 0 && !this.closed) {
          await new Promise<void>((resolve) => {
            this.wake = resolve;
          });
          this.wake = undefined;
        }
        const value = this.queue.shift();
        return value === undefined ? { done: true, value: undefined } : { done: false, value };
      },
    };
  }
}
