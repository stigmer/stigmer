/**
 * HTTP-backed LangGraph checkpoint saver.
 *
 * Routes checkpoint persistence through the Stigmer Side-Channel Proxy
 * (api.stigmer.ai/v1/proxy) instead of connecting directly to MongoDB.
 * The runner never touches MongoDB — the Java CheckpointerProxyController
 * handles all database operations server-side.
 *
 * Serialization uses the LangGraph JsonPlusSerializer. Binary payloads
 * are transported as MongoDB Extended JSON v2 $binary objects:
 *
 *   {"$binary": {"base64": "<base64-data>", "subType": "00"}}
 *
 * The Java proxy calls Document.parse(json) which handles $binary
 * natively, and doc.toJson() emits the same format on reads.
 *
 * Every request runs through the shared bounded-backoff loop
 * (http-retry.ts's fetchWithRetry, with this saver's policy: transient
 * classification + a per-request abort timeout). That loop is the ONLY
 * retry layer between an agent execution and its checkpoints — the deep
 * agent activity is deliberately non-retryable at the Temporal level
 * (maximumAttempts: 1; replaying a whole agent run is not safe), so before
 * this existed a single dropped request killed the execution
 * (stigmer/stigmer-cloud#188). Retrying puts is safe by server contract:
 * CheckpointStore documents putCheckpoint/putWrite as keyed save-or-replace
 * upserts. Budget exhaustion still fails loudly — checkpoints are not
 * lossy-tolerable (unlike status updates, see status.ts), and silently
 * dropping one would corrupt resume state.
 */

import type { RunnableConfig } from "@langchain/core/runnables";
import {
  BaseCheckpointSaver,
  type Checkpoint,
  type CheckpointListOptions,
  type CheckpointPendingWrite,
  type CheckpointTuple,
  type ChannelVersions,
} from "@langchain/langgraph-checkpoint";
import type { CheckpointMetadata, PendingWrite } from "@langchain/langgraph-checkpoint";
import type { RetryOptions } from "../grpc-retry.js";
import { fetchWithRetry, type FetchRetryPolicy } from "../http-retry.js";

function encodeB64(data: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(data).toString("base64");
  }
  let binary = "";
  for (const byte of data) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function decodeB64(b64: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(b64, "base64"));
  }
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

interface BinaryObj {
  $binary: { base64: string; subType: string };
}

function encodeBinary(payload: Uint8Array): BinaryObj {
  return { $binary: { base64: encodeB64(payload), subType: "00" } };
}

function decodeBinary(obj: BinaryObj): Uint8Array {
  return decodeB64(obj.$binary.base64);
}

function configThread(config: RunnableConfig): string {
  return (config.configurable?.thread_id as string) ?? "";
}

function configNs(config: RunnableConfig): string {
  return (config.configurable?.checkpoint_ns as string) ?? "";
}

function configCheckpointId(config: RunnableConfig): string | undefined {
  return config.configurable?.checkpoint_id as string | undefined;
}

function configOrg(config: RunnableConfig): string | undefined {
  return config.configurable?.org as string | undefined;
}

/** Retry policy plus the per-request bound; every field is defaulted. */
export interface HttpCheckpointSaverOptions extends RetryOptions {
  /**
   * Milliseconds before an in-flight request is aborted and the attempt is
   * classified retryable. Without it a hung connection (the realistic
   * unplanned-pod-kill symptom) stalls forever and the retry never engages.
   */
  readonly requestTimeoutMs?: number;
}

/**
 * Default transient-retry policy. Wider than status.ts's DEFAULT_PERSIST_RETRY
 * (3 retries, ~700 ms) on purpose: a dropped status update is lossy-tolerable,
 * a dropped checkpoint kills the execution, so the budget here is sized to
 * span a pod-restart reroute (~7.75 s of delays across 5 retries). Worst case
 * with every attempt hanging — 6 x 30 s + delays, ~3.7 min — stays well inside
 * the deep-agent activity's 1 h startToCloseTimeout (no heartbeatTimeout).
 */
const DEFAULT_RETRY = {
  baseDelayMs: 250,
  backoffFactor: 2,
  maxRetries: 5,
  requestTimeoutMs: 30_000,
} as const;

export class HttpCheckpointSaver extends BaseCheckpointSaver {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;
  private readonly retryPolicy: FetchRetryPolicy;

  constructor(
    proxyEndpoint: string,
    authToken: string,
    options: HttpCheckpointSaverOptions = {},
  ) {
    super();
    this.baseUrl = `${proxyEndpoint.replace(/\/+$/, "")}/v1/proxy/checkpoints`;
    this.headers = {
      Authorization: `Bearer ${authToken}`,
      "Content-Type": "application/json",
    };
    this.retryPolicy = {
      label: "HttpCheckpointSaver",
      baseDelayMs: options.baseDelayMs ?? DEFAULT_RETRY.baseDelayMs,
      backoffFactor: options.backoffFactor ?? DEFAULT_RETRY.backoffFactor,
      maxRetries: options.maxRetries ?? DEFAULT_RETRY.maxRetries,
      requestTimeoutMs: options.requestTimeoutMs ?? DEFAULT_RETRY.requestTimeoutMs,
      delayFn: options.delayFn,
    };
  }

  private fetchWithRetry(url: string, init?: RequestInit): Promise<Response> {
    return fetchWithRetry(url, init, this.retryPolicy);
  }

  private async serializeTyped(obj: unknown): Promise<[string, BinaryObj]> {
    const [typeTag, payload] = await this.serde.dumpsTyped(obj);
    return [typeTag, encodeBinary(payload)];
  }

  private async deserializeTyped(typeTag: string, binaryObj: BinaryObj): Promise<unknown> {
    const payload = decodeBinary(binaryObj);
    return this.serde.loadsTyped(typeTag, payload);
  }

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const threadId = configThread(config);
    const checkpointNs = configNs(config);
    const checkpointId = configCheckpointId(config);

    const params = new URLSearchParams({
      thread_id: threadId,
      checkpoint_ns: checkpointNs,
    });
    if (checkpointId) {
      params.set("checkpoint_id", checkpointId);
    }

    const resp = await this.fetchWithRetry(`${this.baseUrl}/checkpoint?${params}`, {
      headers: this.headers,
    });
    if (resp.status === 404) return undefined;
    if (!resp.ok) {
      throw new Error(`Checkpoint GET failed: ${resp.status} ${resp.statusText}`);
    }

    const doc = (await resp.json()) as Record<string, any>;
    return this.parseCheckpointDoc(doc, threadId, checkpointNs);
  }

  async *list(
    config: RunnableConfig,
    options?: CheckpointListOptions,
  ): AsyncGenerator<CheckpointTuple> {
    const threadId = configThread(config);
    const checkpointNs = configNs(config);
    const limit = options?.limit ?? 10;

    const params = new URLSearchParams({
      thread_id: threadId,
      checkpoint_ns: checkpointNs,
      limit: String(limit),
    });
    const beforeId = options?.before?.configurable?.checkpoint_id as string | undefined;
    if (beforeId) {
      params.set("before", beforeId);
    }

    const resp = await this.fetchWithRetry(`${this.baseUrl}/checkpoints?${params}`, {
      headers: this.headers,
    });
    if (!resp.ok) {
      throw new Error(`Checkpoints list failed: ${resp.status} ${resp.statusText}`);
    }

    const data = (await resp.json()) as { checkpoints?: Record<string, any>[] };
    for (const doc of data.checkpoints ?? []) {
      yield await this.parseCheckpointDocWithoutWrites(doc);
    }
  }

  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
    _newVersions: ChannelVersions,
  ): Promise<RunnableConfig> {
    const threadId = configThread(config);
    const checkpointNs = configNs(config);
    const checkpointId = checkpoint.id;

    const [cpType, cpBinary] = await this.serializeTyped(checkpoint);
    const [mdType, mdBinary] = await this.serializeTyped(metadata);

    const doc: Record<string, unknown> = {
      thread_id: threadId,
      checkpoint_ns: checkpointNs,
      checkpoint_id: checkpointId,
      parent_checkpoint_id: configCheckpointId(config),
      type: cpType,
      checkpoint: cpBinary,
      metadata_type: mdType,
      metadata: mdBinary,
    };

    const orgId = configOrg(config);
    if (orgId) doc.org_id = orgId;

    const resp = await this.fetchWithRetry(`${this.baseUrl}/checkpoint`, {
      method: "PUT",
      headers: this.headers,
      body: JSON.stringify(doc),
    });
    if (!resp.ok) {
      throw new Error(`Checkpoint PUT failed: ${resp.status} ${resp.statusText}`);
    }

    return {
      configurable: {
        thread_id: threadId,
        checkpoint_ns: checkpointNs,
        checkpoint_id: checkpointId,
      },
    };
  }

  async deleteThread(threadId: string): Promise<void> {
    const params = new URLSearchParams({ thread_id: threadId });
    const resp = await this.fetchWithRetry(`${this.baseUrl}/thread?${params}`, {
      method: "DELETE",
      headers: this.headers,
    });
    if (!resp.ok && resp.status !== 404) {
      throw new Error(`Checkpoint DELETE thread failed: ${resp.status} ${resp.statusText}`);
    }
  }

  async putWrites(
    config: RunnableConfig,
    writes: PendingWrite[],
    taskId: string,
  ): Promise<void> {
    const threadId = configThread(config);
    const checkpointNs = configNs(config);
    const checkpointId = configCheckpointId(config);
    const orgId = configOrg(config);

    const docs = await Promise.all(writes.map(async ([channel, value], idx) => {
      const [typeTag, binaryVal] = await this.serializeTyped(value);
      const doc: Record<string, unknown> = {
        thread_id: threadId,
        checkpoint_ns: checkpointNs,
        checkpoint_id: checkpointId,
        task_id: taskId,
        idx,
        channel,
        type: typeTag,
        value: binaryVal,
      };
      if (orgId) doc.org_id = orgId;
      return doc;
    }));

    const resp = await this.fetchWithRetry(`${this.baseUrl}/writes`, {
      method: "PUT",
      headers: this.headers,
      body: JSON.stringify({ writes: docs }),
    });
    if (!resp.ok) {
      throw new Error(`Checkpoint writes PUT failed: ${resp.status} ${resp.statusText}`);
    }
  }

  private async parseCheckpointDoc(
    doc: Record<string, any>,
    threadId: string,
    checkpointNs: string,
  ): Promise<CheckpointTuple> {
    const cpType = doc.type ?? "json";
    const checkpoint = (await this.deserializeTyped(cpType, doc.checkpoint)) as Checkpoint;

    const mdType = doc.metadata_type ?? cpType;
    const metadata = doc.metadata
      ? ((await this.deserializeTyped(mdType, doc.metadata)) as CheckpointMetadata)
      : undefined;

    let parentConfig: RunnableConfig | undefined;
    if (doc.parent_checkpoint_id) {
      parentConfig = {
        configurable: {
          thread_id: doc.thread_id,
          checkpoint_ns: doc.checkpoint_ns ?? "",
          checkpoint_id: doc.parent_checkpoint_id,
        },
      };
    }

    const writesResp = await this.fetchWithRetry(
      `${this.baseUrl}/writes?${new URLSearchParams({
        thread_id: threadId,
        checkpoint_ns: checkpointNs,
        checkpoint_id: doc.checkpoint_id,
      })}`,
      { headers: this.headers },
    );
    // Fail loudly, never degrade: this used to map ANY non-ok response to "no
    // pending writes", which silently stripped resume state on a transient
    // 500 — a checkpoint would load without the writes recorded against it.
    if (!writesResp.ok) {
      throw new Error(`Checkpoint writes GET failed: ${writesResp.status} ${writesResp.statusText}`);
    }
    const pendingWrites = await this.parseWrites(
      (await writesResp.json()) as Record<string, any>,
    );

    return {
      config: {
        configurable: {
          thread_id: doc.thread_id,
          checkpoint_ns: doc.checkpoint_ns ?? "",
          checkpoint_id: doc.checkpoint_id,
        },
      },
      checkpoint,
      metadata,
      parentConfig,
      pendingWrites,
    };
  }

  private async parseCheckpointDocWithoutWrites(
    doc: Record<string, any>,
  ): Promise<CheckpointTuple> {
    const cpType = doc.type ?? "json";
    const checkpoint = (await this.serde.loadsTyped(cpType, decodeBinary(doc.checkpoint))) as Checkpoint;

    const mdType = doc.metadata_type ?? cpType;
    const metadata = doc.metadata
      ? ((await this.serde.loadsTyped(mdType, decodeBinary(doc.metadata))) as CheckpointMetadata)
      : undefined;

    let parentConfig: RunnableConfig | undefined;
    if (doc.parent_checkpoint_id) {
      parentConfig = {
        configurable: {
          thread_id: doc.thread_id,
          checkpoint_ns: doc.checkpoint_ns ?? "",
          checkpoint_id: doc.parent_checkpoint_id,
        },
      };
    }

    return {
      config: {
        configurable: {
          thread_id: doc.thread_id,
          checkpoint_ns: doc.checkpoint_ns ?? "",
          checkpoint_id: doc.checkpoint_id,
        },
      },
      checkpoint,
      metadata,
      parentConfig,
    };
  }

  private async parseWrites(
    data: Record<string, any>,
  ): Promise<CheckpointPendingWrite[]> {
    const result: CheckpointPendingWrite[] = [];
    for (const w of data.writes ?? []) {
      const wType = w.type ?? "json";
      const value = await this.serde.loadsTyped(wType, decodeBinary(w.value));
      result.push([w.task_id, w.channel, value]);
    }
    return result;
  }
}
