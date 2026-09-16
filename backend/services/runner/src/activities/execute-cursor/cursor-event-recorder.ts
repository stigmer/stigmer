/**
 * The raw recording of the Cursor translator's input — both SDK channels, in
 * arrival order — for checking the translator against what the real SDK sends.
 *
 * Off unless `CURSOR_EVENT_RECORD_DIR` is set: `turn-settle.ts` reads the env
 * once per turn and hands the directory in, so this module touches no process
 * state and its tests need no env. When off, {@link createCursorEventRecorder}
 * returns undefined and the loop's `recorder?.record(...)` costs nothing.
 *
 * Two channels, one sequence. The Cursor SDK hands the runner a turn on two
 * channels: the discrete `run.stream()` `SDKMessage`s (message boundaries, tool
 * calls, the result) and the fine-grained `onDelta` `InteractionUpdate`s (text
 * and thinking tokens, live shell output, tool-call completion instants,
 * usage). The translator (`translator.ts`) reads both, and the questions a
 * recording exists to answer — what shape `shell-output-delta` carries, whether
 * `tool-call-completed` arrives before or after the stream's own completed
 * `tool_call` — are questions about the ORDER across channels. So the recorder
 * owns one monotonic `seq` and stamps every line with its `channel`; a reader
 * sorts nothing, it reads the file top to bottom. Until #1097's live-run gate
 * this module recorded the stream channel alone, under the loop's own
 * event counter, which could not place a delta relative to a stream event.
 *
 * Output: `<dir>/<executionId>.cursor-events.jsonl`, one JSON object per line,
 * flushed once after the stream completes (`turn-settle.ts`). Payloads pass
 * through {@link safeClone} so a cyclic event cannot fail the flush. The native
 * harness's `v3-event-recorder.ts` is the same idea for its one channel.
 */

import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { InteractionUpdate, SDKMessage } from "@cursor/sdk";

/** Which of the SDK's two channels a recorded line came from. */
export type CursorRecordedChannel = "stream" | "delta";

export interface CursorEventRecorder {
  /** A discrete `run.stream()` event, sequenced with the deltas around it. */
  record(event: SDKMessage): void;
  /** An `onDelta` update, sequenced with the stream events around it. */
  recordDelta(update: InteractionUpdate): void;
  /** Write every recorded line, once. A no-op when nothing was recorded. */
  flush(): Promise<void>;
}

/**
 * Create a recorder for `recordDir`, or undefined when there is none (the
 * env var unset or empty) — the caller does `recorder?.record(event)`.
 */
export function createCursorEventRecorder(
  executionId: string,
  recordDir: string | undefined,
): CursorEventRecorder | undefined {
  if (!recordDir) return undefined;
  return new FileCursorEventRecorder(executionId, recordDir);
}

class FileCursorEventRecorder implements CursorEventRecorder {
  private readonly lines: string[] = [];
  /** The one arrival counter both channels share (the header's reason). */
  private seq = 0;

  constructor(
    private readonly executionId: string,
    private readonly outputDir: string,
  ) {}

  record(event: SDKMessage): void {
    this.append("stream", event.type, {
      agent_id: event.agent_id,
      run_id: event.run_id,
      event: safeClone(event),
    });
  }

  recordDelta(update: InteractionUpdate): void {
    this.append("delta", update.type, { update: safeClone(update) });
  }

  private append(channel: CursorRecordedChannel, type: string, payload: Record<string, unknown>): void {
    this.lines.push(
      JSON.stringify({
        seq: this.seq++,
        capturedAt: new Date().toISOString(),
        channel,
        type,
        ...payload,
      }),
    );
  }

  async flush(): Promise<void> {
    if (this.lines.length === 0) return;

    await mkdir(this.outputDir, { recursive: true });

    const filePath = join(this.outputDir, `${this.executionId}.cursor-events.jsonl`);

    await writeFile(filePath, this.lines.join("\n") + "\n");
    console.log(`CursorEventRecorder: flushed ${this.lines.length} lines to ${filePath}`);
  }
}

function safeClone(obj: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(obj));
  } catch {
    if (obj && typeof obj === "object") {
      return { _serializationError: true, keys: Object.keys(obj) };
    }
    return { _serializationError: true };
  }
}
