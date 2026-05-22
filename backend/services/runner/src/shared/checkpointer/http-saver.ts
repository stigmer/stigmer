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

export class HttpCheckpointSaver extends BaseCheckpointSaver {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;

  constructor(proxyEndpoint: string, authToken: string) {
    super();
    this.baseUrl = `${proxyEndpoint.replace(/\/+$/, "")}/v1/proxy/checkpoints`;
    this.headers = {
      Authorization: `Bearer ${authToken}`,
      "Content-Type": "application/json",
    };
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

    const resp = await fetch(`${this.baseUrl}/checkpoint?${params}`, {
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

    const resp = await fetch(`${this.baseUrl}/checkpoints?${params}`, {
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

    const resp = await fetch(`${this.baseUrl}/checkpoint`, {
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

    const resp = await fetch(`${this.baseUrl}/writes`, {
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

    const writesResp = await fetch(
      `${this.baseUrl}/writes?${new URLSearchParams({
        thread_id: threadId,
        checkpoint_ns: checkpointNs,
        checkpoint_id: doc.checkpoint_id,
      })}`,
      { headers: this.headers },
    );
    const pendingWrites = await this.parseWrites(
      writesResp.ok ? (await writesResp.json()) as Record<string, any> : {},
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
