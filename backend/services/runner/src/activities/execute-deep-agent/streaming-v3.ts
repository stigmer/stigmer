/**
 * V3 streaming execution loop for ExecuteDeepAgent.
 *
 * Feature-flagged path activated by LANGGRAPH_STREAM_EVENTS_VERSION=v3.
 * Calls the v3 streamEvents API (two-arg, returns Promise<GraphRunStream>),
 * iterates raw ProtocolEvents, records them for analysis, and extracts
 * the final state via run.output.
 *
 * Phase 1: recording-only — does NOT feed events into a StatusBuilder
 * or persist intermediate status updates. That is Phase 2+.
 */

import type { StreamDependencies, StreamResult } from "./streaming.js";
import { StallTimeoutError } from "./streaming.js";
import { createV3EventRecorder, type V3ProtocolEvent } from "./v3-event-recorder.js";
import type { InlinePublisher } from "./inline-publisher.js";
import type { WriteBackCoordinator } from "./writeback-coordinator.js";

/**
 * Minimal interface for the v3 GraphRunStream object returned by
 * `agentGraph.streamEvents(input, { version: "v3" })`.
 * We only depend on the properties Phase 1 actually uses.
 */
interface V3RunStream extends AsyncIterable<V3ProtocolEvent> {
  readonly output: Promise<unknown>;
  abort(reason?: unknown): void;
  readonly signal: AbortSignal;
}

const DEFAULT_STALL_TIMEOUT_MS = 120_000;
const HEARTBEAT_INTERVAL_MS = 2_000;
const RUN_OUTPUT_TIMEOUT_MS = 30_000;

const FILE_MODIFYING_TOOLS = new Set([
  "write_file", "edit_file", "create_file",
  "write", "edit", "create",
  "str_replace_editor",
]);

/**
 * V3 streaming execution: raw protocol loop with independent heartbeat,
 * caller-owned AbortController, event recording, and run.output extraction.
 */
export async function streamExecutionV3(
  deps: StreamDependencies,
): Promise<StreamResult> {
  const {
    agentGraph,
    langgraphInput,
    langgraphConfig,
    executionId,
    stallTimeoutMs = DEFAULT_STALL_TIMEOUT_MS,
    heartbeatFn,
    isCancelledFn,
    inlinePublisher,
    writebackCoordinator,
  } = deps;

  const abortController = new AbortController();
  const recorder = createV3EventRecorder(executionId, process.env.V3_EVENT_RECORD_DIR);

  // Pre-loop heartbeat to cover the initial await
  if (heartbeatFn) {
    try {
      heartbeatFn({ executionId, eventsProcessed: 0, phase: "streaming_v3_init" });
    } catch { /* swallow */ }
  }

  // v3 call: two-arg signature returns Promise<GraphRunStream>.
  // The StreamDependencies.agentGraph interface is typed for v2 (3 args, sync return).
  // At runtime, the DeepAgent supports both overloads. We cast through the v3 call.
  const run = await (agentGraph as any).streamEvents(langgraphInput, {
    ...langgraphConfig,
    version: "v3",
    signal: abortController.signal,
  }) as V3RunStream;

  let eventsProcessed = 0;
  let lastActivityAt = performance.now();
  let cancelledByPlatform = false;
  const pendingPublishPromises: Promise<void>[] = [];
  const pendingWritebackPromises: Promise<void>[] = [];

  const heartbeatTimer = setInterval(() => {
    if (heartbeatFn) {
      try {
        heartbeatFn({ executionId, eventsProcessed, phase: "streaming_v3" });
      } catch { /* swallow */ }
    }
  }, HEARTBEAT_INTERVAL_MS);

  try {
    for await (const event of run as AsyncIterable<V3ProtocolEvent>) {
      if (isCancelledFn?.()) {
        cancelledByPlatform = true;
        abortController.abort("Cancelled by platform");
        break;
      }

      lastActivityAt = performance.now();
      recorder?.record(event, eventsProcessed);
      eventsProcessed++;

      if (event.method === "tools") {
        handleToolEvent(
          event, inlinePublisher, writebackCoordinator,
          pendingPublishPromises, pendingWritebackPromises,
        );
      }

      checkStallTimeout(lastActivityAt, stallTimeoutMs, executionId);
    }
  } catch (err: unknown) {
    if (isGraphRecursionError(err)) {
      await recorder?.flush();
      return { eventsProcessed, pendingPublishPromises, pendingWritebackPromises };
    }
    throw err;
  } finally {
    clearInterval(heartbeatTimer);
  }

  await recorder?.flush();

  if (eventsProcessed === 0 && !cancelledByPlatform) {
    throw new Error(
      "Stream completed without processing any events. " +
      "This may indicate a configuration error or v3 API incompatibility.",
    );
  }

  console.log(
    `[streaming-v3] execution=${executionId} stream finished — ` +
    `processed ${eventsProcessed} events`,
  );

  const runOutput = await extractRunOutput(run, executionId);

  return { eventsProcessed, runOutput, pendingPublishPromises, pendingWritebackPromises };
}

// ── Run Output Extraction ────────────────────────────────────────────

async function extractRunOutput(
  run: { output: Promise<unknown> },
  executionId: string,
): Promise<Record<string, unknown> | undefined> {
  try {
    const finalState = await Promise.race([
      run.output,
      timeoutPromise(RUN_OUTPUT_TIMEOUT_MS),
    ]);

    if (finalState === TIMEOUT_SENTINEL) {
      console.warn(
        `[streaming-v3] execution=${executionId} — run.output did not resolve ` +
        `within ${RUN_OUTPUT_TIMEOUT_MS}ms. Proceeding without final state.`,
      );
      return undefined;
    }

    const output = finalState as Record<string, unknown>;
    console.log(
      `[streaming-v3] execution=${executionId} — run.output resolved. ` +
      `Keys: [${Object.keys(output ?? {}).join(", ")}]. ` +
      `hasStructuredResponse=${output?.structuredResponse !== undefined}`,
    );
    return output;
  } catch (err) {
    console.warn(
      `[streaming-v3] execution=${executionId} — run.output rejected: ${err}`,
    );
    return undefined;
  }
}

const TIMEOUT_SENTINEL = Symbol("timeout");

function timeoutPromise(ms: number): Promise<typeof TIMEOUT_SENTINEL> {
  return new Promise((resolve) => setTimeout(() => resolve(TIMEOUT_SENTINEL), ms));
}

// ── Tool Event Handling ──────────────────────────────────────────────

function handleToolEvent(
  event: V3ProtocolEvent,
  inlinePublisher: InlinePublisher | undefined,
  writebackCoordinator: WriteBackCoordinator | undefined,
  pendingPublishPromises: Promise<void>[],
  pendingWritebackPromises: Promise<void>[],
): void {
  if (!inlinePublisher && !writebackCoordinator) return;

  const data = event.params.data as Record<string, unknown> | undefined;
  if (!data) return;

  const eventType = data.type ?? data.event;
  if (eventType !== "tool-finished") return;

  const toolName = normalizeField(data, "name", "tool_name", "toolName") as string | undefined;
  if (!toolName || !FILE_MODIFYING_TOOLS.has(toolName)) return;

  const input = (data.input ?? data.args) as Record<string, unknown> | undefined;
  const filePath = extractFilePath(input);
  if (!filePath) return;

  if (inlinePublisher) {
    pendingPublishPromises.push(inlinePublisher.publish(filePath));
  }
  if (writebackCoordinator) {
    pendingWritebackPromises.push(writebackCoordinator.onFileModified(filePath));
  }
}

function extractFilePath(input: Record<string, unknown> | undefined): string | null {
  if (!input) return null;
  if (typeof input.path === "string") return input.path;
  if (typeof input.file_path === "string") return input.file_path;
  if (typeof input.filePath === "string") return input.filePath;
  if (typeof input.filename === "string") return input.filename;
  if (typeof input.file === "string") return input.file;
  return null;
}

function normalizeField(
  obj: Record<string, unknown>,
  ...candidates: string[]
): unknown {
  for (const key of candidates) {
    if (obj[key] !== undefined) return obj[key];
  }
  return undefined;
}

// ── Helpers ──────────────────────────────────────────────────────────

function checkStallTimeout(
  lastActivityAt: number,
  stallTimeoutMs: number,
  executionId: string,
): void {
  const elapsed = performance.now() - lastActivityAt;
  if (elapsed > stallTimeoutMs) {
    throw new StallTimeoutError(
      `Agent stream stalled: no events received for ${Math.round(elapsed / 1000)}s ` +
      `for execution ${executionId}`,
    );
  }
}

function isGraphRecursionError(err: unknown): boolean {
  if (err instanceof Error) {
    return err.constructor.name === "GraphRecursionError" ||
      err.message.includes("GraphRecursionError") ||
      err.message.includes("Recursion limit");
  }
  return false;
}
