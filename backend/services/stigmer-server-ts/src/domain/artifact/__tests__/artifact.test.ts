/**
 * Pins the artifact domain against Go's artifact_controller_test.go —
 * through the real stack (composed server, native gRPC client, the port+1
 * file server on a pre-picked free port).
 *
 * The load-bearing pins the conformance suite CANNOT cover:
 *   - the 50MB domain cap → ResourceExhausted with Go's copy (sits behind
 *     the transport's 10MB message cap on the wire — the wave-2 S1
 *     amendment names this port as the carrier; proven here through an
 *     in-process router, which has no transport cap);
 *   - the org-derivation proxy trick reading metadata.org out of a REAL
 *     stored execution row (the suite can only pin the fabricated-id
 *     fallback);
 *   - expires_at renders RFC3339 WITHOUT fractional seconds (Go
 *     time.RFC3339 byte shape);
 *   - the file server's traversal guard (a crafted key must never escape
 *     the artifact root — the SQLite db file lives right next to it).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, createClient, createRouterTransport } from "@connectrpc/connect";
import type { Client, Transport } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { ArtifactSchema } from "@stigmer/protos/ai/stigmer/agentic/artifact/v1/api_pb";
import { ArtifactCommandController } from "@stigmer/protos/ai/stigmer/agentic/artifact/v1/command_pb";
import { ArtifactStorageState } from "@stigmer/protos/ai/stigmer/agentic/artifact/v1/enum_pb";
import { ArtifactQueryController } from "@stigmer/protos/ai/stigmer/agentic/artifact/v1/query_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { LocalArtifactStorage } from "../../../artifactstorage/artifact-storage.js";
import { loadConfig } from "../../../boot/config.js";
import { composeServer } from "../../../boot/compose.js";
import type { ComposedServer } from "../../../boot/compose.js";
import { createLogger } from "../../../boot/logger.js";
import { SqliteStore } from "../../../store/sqlite/store.js";
import { MAX_CONTENT_BYTES, artifactNotFoundMessage } from "../constants.js";
import { registerArtifactServices } from "../controller.js";

const silentLogger = createLogger({ level: "error", pretty: false, write: () => {} });

type CommandClient = Client<typeof ArtifactCommandController>;
type QueryClient = Client<typeof ArtifactQueryController>;

/** A free loopback port, picked ahead so the file server can pin it. */
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = address !== null && typeof address === "object" ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

let server: ComposedServer;
let command: CommandClient;
let query: QueryClient;
let dir: string;
let artifactPort: number;

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "artifact-domain-test-"));
  artifactPort = await freePort();
  vi.stubEnv("STIGMER_ENCRYPTION_KEY", Buffer.alloc(32, 3).toString("base64"));
  vi.stubEnv("STIGMER_RUNNER_TOKEN_KEY", Buffer.alloc(32, 4).toString("base64"));
  server = composeServer({
    config: loadConfig({
      STIGMER_MODEL_REGISTRY_REFRESH: "off",
      DB_PATH: path.join(dir, "stigmer.db"),
      ARTIFACT_LOCAL_BASE_PATH: path.join(dir, "artifacts"),
      ARTIFACT_HTTP_PORT: String(artifactPort),
    }),
    logger: silentLogger,
    portOverride: 0,
    host: "127.0.0.1",
  });
  const port = await server.start();
  const transport: Transport = createGrpcTransport({
    baseUrl: `http://127.0.0.1:${port}`,
  });
  command = createClient(ArtifactCommandController, transport);
  query = createClient(ArtifactQueryController, transport);
});

afterAll(async () => {
  await server.shutdown();
  rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

let counter = 0;
function artifactInput(overrides?: {
  content?: Uint8Array;
  ttlDays?: number;
  agentExecutionId?: string;
  workflowExecutionId?: string;
}) {
  counter += 1;
  const source =
    overrides?.agentExecutionId !== undefined ||
    overrides?.workflowExecutionId !== undefined
      ? {
          agentExecutionId: overrides.agentExecutionId ?? "",
          workflowExecutionId: overrides.workflowExecutionId ?? "",
        }
      : { agentExecutionId: `aexec_01test${counter}` };
  return {
    spec: {
      displayName: `artifact-${counter}.txt`,
      contentType: "text/plain",
      source,
      ...(overrides?.ttlDays !== undefined
        ? { retention: { ttlDays: overrides.ttlDays } }
        : {}),
    },
    content: overrides?.content ?? new TextEncoder().encode(`content ${counter}\n`),
  };
}

async function grpcError(run: () => Promise<unknown>): Promise<ConnectError> {
  try {
    await run();
    throw new Error("expected the call to fail");
  } catch (error) {
    if (error instanceof ConnectError) {
      return error;
    }
    throw error;
  }
}

describe("artifact domain — create & content addressing", () => {
  it("assigns an art_ id and stamps the content-addressed status", async () => {
    const input = artifactInput();
    const created = await command.create(input);

    expect(created.metadata?.id).toMatch(/^art_/);
    expect(created.metadata?.name).toBe(input.spec.displayName);
    expect(created.status?.contentHash).toBe(
      createHash("sha256").update(input.content).digest("hex"),
    );
    expect(created.status?.sizeBytes).toBe(BigInt(input.content.byteLength));
    expect(created.status?.storageState).toBe(ArtifactStorageState.storage_state_stored);
  });

  it("expires_at is RFC3339 WITHOUT fractional seconds, ~30 days out by default", async () => {
    const created = await command.create(artifactInput());
    const expiresAt = created.status?.expiresAt ?? "";
    // Go time.RFC3339: no millis (toISOString would emit .000Z).
    expect(expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    const delta = Date.parse(expiresAt) - Date.now();
    expect(delta).toBeGreaterThan(29.9 * 24 * 3600 * 1000);
    expect(delta).toBeLessThan(30.1 * 24 * 3600 * 1000);
  });

  it("ttl_days -1 is permanent; other non-positive values fall back to 30", async () => {
    const permanent = await command.create(artifactInput({ ttlDays: -1 }));
    expect(permanent.status?.expiresAt).toBe("");

    const fallback = await command.create(artifactInput({ ttlDays: -7 }));
    expect(fallback.status?.expiresAt).not.toBe("");
  });

  it("derives the org from a REAL stored source execution (the proxy trick)", async () => {
    // Seed a workflow_execution row carrying an org. The row is written
    // through the Artifact schema — the SAME wire-layout proxy the reader
    // uses (all resources share metadata at field 3).
    const executionId = "wexec_01orgproxy";
    await server.store.saveResource(
      ApiResourceKind.workflow_execution,
      executionId,
      ArtifactSchema,
      create(ArtifactSchema, {
        metadata: { id: executionId, name: "seed", org: "proxy-org" },
      }),
    );

    const created = await command.create(
      artifactInput({ workflowExecutionId: executionId }),
    );
    expect(created.metadata?.org).toBe("proxy-org");
  });

  it("falls back to the empty org for a fabricated execution id (OSS posture)", async () => {
    const created = await command.create(
      artifactInput({ agentExecutionId: "aexec_01neverexisted" }),
    );
    expect(created.metadata?.org).toBe("");
  });

  it("rejects content over the 50MB domain cap with ResourceExhausted (unit-level arm)", async () => {
    // Through an in-process router — the wire path hits the transport's
    // 10MB cap first (the S1 amendment), so the domain arm is provable
    // only here.
    const storeDir = mkdtempSync(path.join(tmpdir(), "artifact-cap-test-"));
    const store = SqliteStore.open(path.join(storeDir, "cap.db"), silentLogger);
    try {
      const transport = createRouterTransport((router) => {
        registerArtifactServices(router, {
          store,
          artifactStorage: new LocalArtifactStorage(
            path.join(storeDir, "artifacts"),
            "http://localhost:1",
          ),
          logger: silentLogger,
        });
      });
      const local = createClient(ArtifactCommandController, transport);
      const err = await grpcError(() =>
        local.create(
          artifactInput({ content: new Uint8Array(MAX_CONTENT_BYTES + 1) }),
        ),
      );
      expect(err.code).toBe(Code.ResourceExhausted);
      expect(err.rawMessage).toBe(
        `content exceeds maximum size of ${MAX_CONTENT_BYTES} bytes`,
      );
    } finally {
      await store.close();
      rmSync(storeDir, { recursive: true, force: true });
    }
  });
});

describe("artifact domain — read surfaces", () => {
  it("get resolves by id; listByExecution filters on the matching source arm", async () => {
    const executionId = `wexec_01list${++counter}`;
    const created = await command.create(
      artifactInput({ workflowExecutionId: executionId }),
    );

    const fetched = await query.get({ value: created.metadata!.id });
    expect(fetched.status?.contentHash).toBe(created.status?.contentHash);

    const listed = await query.listByExecution({ workflowExecutionId: executionId });
    expect(listed.totalPages).toBe(1);
    expect(listed.entries).toHaveLength(1);

    // The OTHER source arm must not match the same id.
    const other = await query.listByExecution({ agentExecutionId: executionId });
    expect(other.entries).toHaveLength(0);
  });

  it("listByExecution without any filter answers InvalidArgument", async () => {
    const err = await grpcError(() => query.listByExecution({}));
    expect(err.code).toBe(Code.InvalidArgument);
    expect(err.rawMessage).toBe(
      "workflow_execution_id or agent_execution_id is required",
    );
  });

  it("getContent truncates to max_bytes and reports the FULL size", async () => {
    const content = new TextEncoder().encode("0123456789".repeat(100)); // 1000 bytes
    const created = await command.create(artifactInput({ content }));

    const full = await query.getContent({ artifactId: created.metadata!.id });
    expect(full.truncated).toBe(false);
    expect(full.totalSizeBytes).toBe(1000n);
    expect(new Uint8Array(full.content)).toEqual(content);

    const truncated = await query.getContent({
      artifactId: created.metadata!.id,
      maxBytes: 100n,
    });
    expect(truncated.truncated).toBe(true);
    expect(truncated.totalSizeBytes).toBe(1000n);
    expect(truncated.content).toHaveLength(100);
  });

  it("getDownloadUrl reports the unconditional 604800 ttl and blob facts", async () => {
    const created = await command.create(artifactInput());
    const download = await query.getDownloadUrl({ value: created.metadata!.id });
    expect(download.url).toContain(created.status!.contentHash);
    expect(download.ttlSeconds).toBe(604800);
    expect(download.sizeBytes).toBe(created.status?.sizeBytes);
    expect(download.contentType).toBe("text/plain");
  });

  it("unknown ids answer NotFound with the pinned copy on all read surfaces", async () => {
    const missing = "art_01domainmissing";
    for (const call of [
      () => query.get({ value: missing }),
      () => query.getDownloadUrl({ value: missing }),
      () => query.getContent({ artifactId: missing }),
    ]) {
      const err = await grpcError(call);
      expect(err.code).toBe(Code.NotFound);
      expect(err.rawMessage).toBe(artifactNotFoundMessage(missing));
    }
  });
});

describe("artifact domain — soft delete", () => {
  it("flips storage_state, keeps the metadata row, fails blob reads closed", async () => {
    const created = await command.create(artifactInput());

    const deleted = await command.delete({ value: created.metadata!.id });
    expect(deleted.status?.storageState).toBe(ArtifactStorageState.storage_state_deleted);

    const fetched = await query.get({ value: created.metadata!.id });
    expect(fetched.status?.storageState).toBe(ArtifactStorageState.storage_state_deleted);

    const download = await grpcError(() =>
      query.getDownloadUrl({ value: created.metadata!.id }),
    );
    expect(download.code).toBe(Code.FailedPrecondition);
    expect(download.rawMessage).toBe(
      `artifact blob has been deleted: ${created.metadata!.id}`,
    );
    const content = await grpcError(() =>
      query.getContent({ artifactId: created.metadata!.id }),
    );
    expect(content.code).toBe(Code.FailedPrecondition);
  });

  it("deleting a missing artifact answers NotFound", async () => {
    const err = await grpcError(() => command.delete({ value: "art_01nothere" }));
    expect(err.code).toBe(Code.NotFound);
  });
});

describe("artifact domain — the local file-server lane", () => {
  it("serves the blob inline; ?download= adds the attachment disposition", async () => {
    const content = new TextEncoder().encode("file-server domain test body\n");
    const created = await command.create(artifactInput({ content }));
    const download = await query.getDownloadUrl({ value: created.metadata!.id });

    const inline = await fetch(download.url);
    expect(inline.status).toBe(200);
    expect(inline.headers.get("content-disposition")).toBeNull();
    expect(new Uint8Array(await inline.arrayBuffer())).toEqual(content);

    const attachment = await fetch(`${download.url}?download=report.txt`);
    expect(attachment.status).toBe(200);
    expect(attachment.headers.get("content-disposition")).toBe(
      'attachment; filename="report.txt"',
    );
  });

  it("answers 404 for missing keys and refuses path traversal out of the root", async () => {
    const missing = await fetch(`http://127.0.0.1:${artifactPort}/nope`);
    expect(missing.status).toBe(404);

    // The SQLite db sits one level above the artifact root — a traversal
    // escape would serve it.
    const traversal = await fetch(
      `http://127.0.0.1:${artifactPort}/..%2Fstigmer.db`,
    );
    expect(traversal.status).toBe(404);
  });
});
