/**
 * Cursor SDK event recorder for capturing raw SDKMessage events.
 *
 * Activated by the CURSOR_EVENT_RECORD_DIR environment variable. When set,
 * the Cursor streaming loop records every SDKMessage and flushes them
 * atomically to a JSONL file after the stream completes.
 *
 * This is development infrastructure for validating the agent_id-based
 * sub-agent routing hypothesis. The captured events reveal whether
 * sub-agent events carry distinct agent_id values and whether they
 * flow through the parent's run.stream() at all.
 *
 * Mirrors the native harness's v3-event-recorder.ts / V3_EVENT_RECORD_DIR.
 */

import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { SDKMessage } from "@cursor/sdk";

export interface CursorEventRecorder {
  record(event: SDKMessage, seq: number): void;
  flush(): Promise<void>;
}

/**
 * Create a recorder if CURSOR_EVENT_RECORD_DIR is set, otherwise undefined.
 * The caller does `recorder?.record(event, seq)` — zero overhead when off.
 */
export function createCursorEventRecorder(
  executionId: string,
): CursorEventRecorder | undefined {
  const recordDir = process.env.CURSOR_EVENT_RECORD_DIR;
  if (!recordDir) return undefined;
  return new FileCursorEventRecorder(executionId, recordDir);
}

class FileCursorEventRecorder implements CursorEventRecorder {
  private readonly lines: string[] = [];

  constructor(
    private readonly executionId: string,
    private readonly outputDir: string,
  ) {}

  record(event: SDKMessage, seq: number): void {
    const entry = {
      seq,
      capturedAt: new Date().toISOString(),
      type: event.type,
      agent_id: event.agent_id,
      run_id: event.run_id,
      event: safeClone(event),
    };
    this.lines.push(JSON.stringify(entry));
  }

  async flush(): Promise<void> {
    if (this.lines.length === 0) return;

    await mkdir(this.outputDir, { recursive: true });

    const filePath = join(
      this.outputDir,
      `${this.executionId}.cursor-events.jsonl`,
    );

    await writeFile(filePath, this.lines.join("\n") + "\n");
    console.log(
      `CursorEventRecorder: flushed ${this.lines.length} events to ${filePath}`,
    );
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
