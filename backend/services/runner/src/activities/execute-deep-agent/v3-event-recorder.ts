/**
 * V3 event recorder for capturing raw LangGraph v3 ProtocolEvents.
 *
 * Activated by the V3_EVENT_RECORD_DIR environment variable. When set,
 * the v3 streaming loop records every raw protocol event and flushes
 * them atomically to a JSON file after the stream completes.
 *
 * This is test/development infrastructure for the v3 streaming migration.
 * The captured events serve as ground-truth for building the
 * V3StatusBuilder and validating v3 event shape assumptions.
 */

import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

interface RecordedV3Event {
  readonly seq: number;
  readonly capturedAt: string;
  readonly type: string;
  readonly method: string;
  readonly namespace: string[];
  readonly timestamp: number;
  readonly node: string | undefined;
  readonly data: unknown;
}

export interface V3EventRecorder {
  record(event: V3ProtocolEvent, seq: number): void;
  flush(): Promise<void>;
}

export interface V3ProtocolEvent {
  readonly type: string;
  readonly seq: number;
  readonly method: string;
  readonly params: {
    readonly namespace: string[];
    readonly timestamp: number;
    readonly node?: string;
    readonly data: unknown;
  };
}

/**
 * Create a recorder if V3_EVENT_RECORD_DIR is set, otherwise return undefined.
 * The caller does `recorder?.record(event, seq)` — zero overhead when off.
 */
export function createV3EventRecorder(
  executionId: string,
  recordDir: string | undefined,
): V3EventRecorder | undefined {
  if (!recordDir) return undefined;
  return new FileV3EventRecorder(executionId, recordDir);
}

class FileV3EventRecorder implements V3EventRecorder {
  private readonly events: RecordedV3Event[] = [];

  constructor(
    private readonly executionId: string,
    private readonly outputDir: string,
  ) {}

  record(event: V3ProtocolEvent, seq: number): void {
    this.events.push({
      seq,
      capturedAt: new Date().toISOString(),
      type: event.type,
      method: event.method,
      namespace: event.params.namespace,
      timestamp: event.params.timestamp,
      node: event.params.node,
      data: safeClone(event.params.data),
    });
  }

  async flush(): Promise<void> {
    if (this.events.length === 0) return;

    await mkdir(this.outputDir, { recursive: true });

    const filePath = join(
      this.outputDir,
      `${this.executionId}.v3-events.json`,
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

function safeClone(obj: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(obj, bigintReplacer));
  } catch {
    if (obj && typeof obj === "object") {
      return { _serializationError: true, keys: Object.keys(obj) };
    }
    return { _serializationError: true };
  }
}

function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}
