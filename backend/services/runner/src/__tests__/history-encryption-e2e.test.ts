/**
 * History-encryption tripwire (stigmer-cloud#227).
 *
 * Runs a secret-bearing workflow through a real Temporal server with the
 * encryption codec installed, then scans the RAW workflow history and
 * asserts the secret bytes appear in no payload. This is the test that
 * proves the issue's claim is closed: without the codec, the secret
 * appears in the hydrate activity result, in every per-task activity
 * input (the engine passes the full env map), and in local-activity
 * markers from expression evaluation.
 *
 * Also pins the cross-language completion contract: the
 * execute-from-execution workflow must complete with a data-less result
 * (void), because the Java parent awaits it as Void and Temporal Java's
 * converter has no Void special-case — a data-bearing encrypted result
 * would fail its converter lookup.
 *
 * Follows the golden-e2e pattern: tests skip gracefully when the
 * Temporal test server cannot start.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadWorkflowFromYaml } from "../workflow-engine/loader.js";
import { evaluateExpressionBatch } from "../workflow-engine/expression.js";
import { EncryptionPayloadCodec } from "@stigmer/temporal-codecs";
import type { ExecuteServerlessWorkflowInput } from "../workflows/execute-serverless-workflow.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKFLOWS_PATH = join(__dirname, "../workflows/index.ts");
const TASK_QUEUE = "history-encryption-e2e";

const SECRET = "sup3r-s3cret-t0ken-do-not-persist";

const SECRET_BEARING_YAML = `
document:
  dsl: '1.0.0'
  namespace: tripwire
  name: secret-bearing
  version: '1.0.0'
  description: Exercises every env-to-history crossing with a secret value
do:
  # Expression evaluation: the secret flows through an EvaluateExpressions
  # local activity whose result is recorded as a history marker.
  - stampToken:
      set:
        authHeader: \${ "Bearer " + $env.API_TOKEN }
  # Per-task activity: CallHttp receives the interpolated config AND the
  # full runtime env map as activity input.
  - callApi:
      call: http
      with:
        method: GET
        endpoint:
          uri: https://example.com/data
        headers:
          Authorization: \${ $context.authHeader }
  - done:
      set:
        finished: true
`;

type TestWorkflowEnvironment = import("@temporalio/testing").TestWorkflowEnvironment;
type Worker = import("@temporalio/worker").Worker;

let env: TestWorkflowEnvironment | null = null;
let worker: Worker | null = null;
let workerRunPromise: Promise<void> | null = null;
let envReady = false;

function createMockActivities() {
  return {
    HydrateWorkflowExecution: async (): Promise<ExecuteServerlessWorkflowInput> => ({
      model: loadWorkflowFromYaml(SECRET_BEARING_YAML),
      workflow_input: null,
      env: { API_TOKEN: SECRET },
      metadata: { execution_id: "tripwire-exec", org_id: "tripwire-org" },
    }),
    EvaluateExpressions: async (
      expressions: Record<string, string>,
      input: unknown,
      stateVars: Record<string, unknown>,
    ): Promise<Record<string, unknown>> => {
      return evaluateExpressionBatch(expressions, input, stateVars);
    },
    CallHttp: async (): Promise<unknown> => ({ ok: true }),
    ResetEventSequence: async (): Promise<number> => 0,
    EmitWorkflowEvents: async (): Promise<void> => {},
    LoadRecoveryContext: async (): Promise<unknown[]> => [],
    PromoteTaskOutput: async (): Promise<void> => {},
  };
}

/** Recursively collects every byte field in the raw history proto. */
function collectByteFields(value: unknown, out: Uint8Array[]): void {
  if (value instanceof Uint8Array) {
    out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectByteFields(item, out);
    return;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectByteFields(item, out);
  }
}

describe("History encryption tripwire — Temporal TestWorkflowEnvironment", () => {
  beforeAll(async () => {
    try {
      const { TestWorkflowEnvironment: TWE } = await import("@temporalio/testing");
      const { Worker: W } = await import("@temporalio/worker");

      env = await TWE.createLocal();
      worker = await W.create({
        connection: env.nativeConnection,
        taskQueue: TASK_QUEUE,
        workflowsPath: WORKFLOWS_PATH,
        activities: createMockActivities(),
        dataConverter: {
          payloadCodecs: [
            new EncryptionPayloadCodec({
              primary: { keyId: "tripwire-key", key: randomBytes(32) },
            }),
          ],
        },
      });
      workerRunPromise = worker.run();
      envReady = true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`Temporal test server unavailable (tests will be skipped): ${msg}`);
      envReady = false;
    }
  }, 60_000);

  afterAll(async () => {
    if (worker) {
      worker.shutdown();
      await workerRunPromise?.catch(() => {});
    }
    if (env) await env.teardown();
  }, 30_000);

  it("records no plaintext secret bytes anywhere in workflow history", async () => {
    if (!envReady || !env) return;

    const workflowId = `tripwire-${Date.now()}`;
    // The starting client has NO codec, mirroring the Java/Go
    // orchestrators: the slim input is plaintext and the void result must
    // be readable without a key.
    const result = await env.client.workflow.execute(
      "stigmer/workflow/execute-from-execution",
      {
        taskQueue: TASK_QUEUE,
        workflowId,
        args: [
          {
            execution_id: "tripwire-exec",
            workflow_instance_id: "",
            workflow_id: "tripwire-wf",
            org_id: "tripwire-org",
          },
        ],
        workflowExecutionTimeout: "30s",
      },
    );
    expect(result).toBeUndefined();

    // Fetch the RAW history (no codec on this read — we want the bytes
    // exactly as Temporal persisted them).
    const secretBytes = Buffer.from(SECRET);
    const byteFields: Uint8Array[] = [];
    let encryptedPayloadCount = 0;
    let completedResultHasData = false;

    let nextPageToken: Uint8Array | undefined;
    do {
      const response = await env.client.workflowService.getWorkflowExecutionHistory({
        namespace: "default",
        execution: { workflowId },
        nextPageToken,
      });
      for (const event of response.history?.events ?? []) {
        collectByteFields(event, byteFields);

        const completed = event.workflowExecutionCompletedEventAttributes;
        if (completed?.result?.payloads?.some((p) => p.data && p.data.length > 0)) {
          completedResultHasData = true;
        }
      }
      encryptedPayloadCount += countEncryptedEncodings(response.history?.events ?? []);
      nextPageToken =
        response.nextPageToken && response.nextPageToken.length > 0
          ? response.nextPageToken
          : undefined;
    } while (nextPageToken);

    // The tripwire itself: the secret must not appear in any byte field
    // of any history event — payload data, marker details, anywhere.
    expect(byteFields.length).toBeGreaterThan(0);
    for (const bytes of byteFields) {
      expect(Buffer.from(bytes).includes(secretBytes)).toBe(false);
    }

    // Sanity: encryption was actually active (otherwise this test would
    // pass vacuously against a broken codec setup).
    expect(encryptedPayloadCount).toBeGreaterThan(0);

    // Cross-language completion contract: void result, no data payload.
    expect(completedResultHasData).toBe(false);
  }, 60_000);
});

function countEncryptedEncodings(events: unknown[]): number {
  let count = 0;
  const encodings: Uint8Array[] = [];
  for (const event of events) {
    collectEncodingMetadata(event, encodings);
  }
  for (const encoding of encodings) {
    if (Buffer.from(encoding).toString("utf-8") === "binary/encrypted") count++;
  }
  return count;
}

function collectEncodingMetadata(value: unknown, out: Uint8Array[]): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) collectEncodingMetadata(item, out);
    return;
  }
  const record = value as Record<string, unknown>;
  const metadata = record["metadata"];
  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
    const encoding = (metadata as Record<string, unknown>)["encoding"];
    if (encoding instanceof Uint8Array) out.push(encoding);
  }
  for (const item of Object.values(record)) collectEncodingMetadata(item, out);
}
