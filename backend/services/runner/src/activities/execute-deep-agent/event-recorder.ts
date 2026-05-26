/**
 * V2 event recorder for capturing raw streamEvents v2 data.
 *
 * Activated by the V2_EVENT_RECORD_DIR environment variable. When set,
 * the streaming loop records every raw event and flushes them atomically
 * to a JSON file after the stream completes.
 *
 * This is test/development infrastructure for the v3 streaming migration.
 * The captured events serve as a reference for building the
 * V3ProtocolNormalizer and validating event shape mappings.
 */

import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { StreamEvent } from "./status-builder.js";

interface RecordedEvent {
  readonly seq: number;
  readonly timestamp: string;
  readonly event: string;
  readonly name: string | undefined;
  readonly run_id: string;
  readonly data: Record<string, unknown>;
  readonly metadata: Record<string, unknown> | undefined;
}

export interface V2EventRecorder {
  record(event: StreamEvent, seq: number): void;
  flush(): Promise<void>;
}

/**
 * Create a recorder if V2_EVENT_RECORD_DIR is set, otherwise return undefined.
 * The caller does `recorder?.record(event, seq)` — zero overhead when off.
 */
export function createV2EventRecorder(
  executionId: string,
  recordDir: string | undefined,
): V2EventRecorder | undefined {
  if (!recordDir) return undefined;
  return new FileV2EventRecorder(executionId, recordDir);
}

class FileV2EventRecorder implements V2EventRecorder {
  private readonly events: RecordedEvent[] = [];

  constructor(
    private readonly executionId: string,
    private readonly outputDir: string,
  ) {}

  record(event: StreamEvent, seq: number): void {
    this.events.push({
      seq,
      timestamp: new Date().toISOString(),
      event: event.event,
      name: event.name,
      run_id: event.run_id,
      data: safeClone(event.data),
      metadata: event.metadata ? safeClone(event.metadata) : undefined,
    });
  }

  async flush(): Promise<void> {
    if (this.events.length === 0) return;

    await mkdir(this.outputDir, { recursive: true });

    const filePath = join(
      this.outputDir,
      `${this.executionId}.v2-events.json`,
    );

    const payload = {
      executionId: this.executionId,
      recordedAt: new Date().toISOString(),
      eventCount: this.events.length,
      events: this.events,
    };

    await writeFile(filePath, JSON.stringify(payload, bigintReplacer, 2));
  }
}

function safeClone(obj: Record<string, unknown>): Record<string, unknown> {
  try {
    return JSON.parse(JSON.stringify(obj, bigintReplacer));
  } catch {
    return { _serializationError: true, keys: Object.keys(obj) };
  }
}

function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}
