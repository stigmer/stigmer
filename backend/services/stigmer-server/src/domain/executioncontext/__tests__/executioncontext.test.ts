/**
 * Pins the executioncontext domain against Go's
 * executioncontext_controller_test.go + executioncontext_secrets_test.go —
 * through the REAL stack: a composed server on an ephemeral port, a native
 * gRPC client, the full interceptor chain.
 *
 * The load-bearing pins the conformance suite CANNOT cover (its harness
 * authenticates as a user and asserts redaction unconditionally; these
 * need direct store access, key control, or a runner token):
 *   - secrets rest as enc:v1: CIPHERTEXT in the store, never plaintext;
 *   - the decrypt-lane dispatch matrix: only a valid, unexpired token
 *     bound to THIS execution decrypts — every other credential state
 *     (absent, malformed, forged, expired, wrong scheme, wrong execution)
 *     falls closed to redaction AS A SUCCESS, never an error;
 *   - the decrypt error doctrine: tampered ciphertext drops the one key
 *     while the read succeeds; an encrypted row on a keyless server fails
 *     LOUD (Internal, pinned copy), never returns junk;
 *   - the keyless WARN-degrade write path (legacy plaintext rows) still
 *     redacts user reads and passes through on the runner lane;
 *   - the DeleteExecutionContext activity seam: idempotent, best-effort,
 *     never throws.
 *
 * Keys are injected via env (vi.stubEnv) so the ladder short-circuits
 * before its file steps — the real ~/.stigmer is never touched (DD-002).
 * Adversarial tokens (expired, forged) are HAND-CRAFTED HS256 JWTs, not
 * sleeps or timer games — determinism is non-negotiable.
 */
import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, createClient } from "@connectrpc/connect";
import type { Client, Transport } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { ExecutionContextSchema } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/api_pb";
import type { ExecutionContext } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/api_pb";
import { ExecutionContextCommandController } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/command_pb";
import { ExecutionContextQueryController } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/query_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { loadConfig } from "../../../boot/config.js";
import { composeServer } from "../../../boot/compose.js";
import type { ComposedServer } from "../../../boot/compose.js";
import { createLogger } from "../../../boot/logger.js";
import {
  ENCRYPTED_PREFIX,
  SecretService,
} from "../../../encryption/encryption.js";
import { SqliteStore } from "../../../store/sqlite/store.js";
import { REDACTED_MARKER } from "../../environment/constants.js";
import {
  DELETE_EXECUTION_CONTEXT_ACTIVITY_NAME,
  deleteExecutionContextForExecution,
} from "../temporal/delete-execution-context.js";
import { executionContextSearchExtractor } from "../search-extractor.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

const ENCRYPTION_KEY = Buffer.alloc(32, 7);
const RUNNER_KEY = Buffer.alloc(32, 8);
const API_VERSION = "agentic.stigmer.ai/v1";
const KIND = "ExecutionContext";
const ORG = "acme";

type CommandClient = Client<typeof ExecutionContextCommandController>;
type QueryClient = Client<typeof ExecutionContextQueryController>;

interface TestServer {
  server: ComposedServer;
  command: CommandClient;
  query: QueryClient;
  dir: string;
}

async function startServer(env: Record<string, string>): Promise<TestServer> {
  const dir = mkdtempSync(path.join(tmpdir(), "ectx-domain-test-"));
  for (const [key, value] of Object.entries(env)) {
    vi.stubEnv(key, value);
  }
  const server = composeServer({
    config: loadConfig({
      STIGMER_MODEL_REGISTRY_REFRESH: "off",
      // No engine behind composed tests: 127.0.0.1:1 is deterministically
      // closed, so boots fail the non-fatal connect fast and can never touch
      // a live local Temporal (the conformance CRUD harness does the same).
      TEMPORAL_HOST_PORT: "127.0.0.1:1",
      DB_PATH: path.join(dir, "stigmer.db"),
      // The skill artifact store + staging wipe (#8) must stay inside the
      // test dir — the default resolves to ~/.stigmer/storage.
      STORAGE_PATH: path.join(dir, "storage"),
      // Keep the artifact store inside the test dir — the default
      // resolves to ~/.stigmer, which tests must never touch.
      ARTIFACT_LOCAL_BASE_PATH: path.join(dir, "artifacts"),
    }),
    logger: silentLogger,
    portOverride: 0,
    host: "127.0.0.1",
  });
  const port = await server.start();
  const transport: Transport = createGrpcTransport({
    baseUrl: `http://127.0.0.1:${port}`,
  });
  return {
    server,
    command: createClient(ExecutionContextCommandController, transport),
    query: createClient(ExecutionContextQueryController, transport),
    dir,
  };
}

/**
 * Failure-path safe: ts is undefined when startServer threw in beforeAll —
 * the env stubs must STILL be cleared or they leak into the next describe
 * (the keyless suite stubs an invalid encryption key on purpose).
 */
async function stopServer(ts: TestServer | undefined): Promise<void> {
  try {
    if (ts !== undefined) {
      await ts.server.shutdown();
      rmSync(ts.dir, { recursive: true, force: true });
    }
  } finally {
    vi.unstubAllEnvs();
  }
}

let counter = 0;
function ecInput(overrides?: {
  name?: string;
  org?: string;
  executionId?: string;
  data?: Record<string, { value: string; isSecret?: boolean }>;
}) {
  counter += 1;
  return {
    apiVersion: API_VERSION,
    kind: KIND,
    metadata: {
      name: overrides?.name ?? `Ectx ${counter}`,
      org: overrides?.org ?? ORG,
    },
    spec: {
      executionId: overrides?.executionId ?? `aex_test_${counter}`,
      data: Object.fromEntries(
        Object.entries(
          overrides?.data ?? {
            API_TOKEN: { value: "super-secret-token", isSecret: true },
            REGION: { value: "us-east-1" },
            EMPTY_SEC: { value: "", isSecret: true },
          },
        ).map(([k, v]) => [
          k,
          { value: v.value, isSecret: v.isSecret ?? false },
        ]),
      ),
    },
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

/** Reads the raw stored row — the at-rest truth redaction must never touch. */
async function storedRow(
  ts: TestServer,
  id: string,
): Promise<ExecutionContext> {
  return await ts.server.store.getResource(
    ApiResourceKind.execution_context,
    id,
    ExecutionContextSchema,
  );
}

function bearerHeaders(token: string): { authorization: string } {
  return { authorization: `Bearer ${token}` };
}

/**
 * Hand-crafts an HS256 runner token — the adversarial arms (expired,
 * forged key) that RunnerAuthService.mint refuses to produce.
 */
function craftToken(
  key: Buffer,
  claims: {
    token_type?: string;
    execution_id?: string;
    iat?: number;
    exp?: number;
  },
): string {
  const header = Buffer.from('{"alg":"HS256","typ":"JWT"}').toString(
    "base64url",
  );
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signingInput = `${header}.${payload}`;
  const signature = createHmac("sha256", key)
    .update(signingInput)
    .digest("base64url");
  return `${signingInput}.${signature}`;
}

// ---------------------------------------------------------------------------
// Encryption + runner key enabled (the production shape).
// ---------------------------------------------------------------------------

describe("executioncontext domain (encryption + runner auth enabled)", () => {
  let ts: TestServer;

  beforeAll(async () => {
    ts = await startServer({
      STIGMER_ENCRYPTION_KEY: ENCRYPTION_KEY.toString("base64"),
      STIGMER_RUNNER_TOKEN_KEY: RUNNER_KEY.toString("base64"),
    });
  });

  afterAll(async () => {
    await stopServer(ts);
  });

  describe("secrets rest encrypted (Go TestSecrets_EncryptedAtRest)", () => {
    it("stores is_secret values as enc:v1: ciphertext, non-secrets plaintext, empty secrets empty", async () => {
      const created = await ts.command.create(
        ecInput({ executionId: "aex_atrest" }),
      );

      const stored = await storedRow(ts, created.metadata!.id);
      const secret = stored.spec!.data["API_TOKEN"]!;
      expect(secret.value, "is_secret value must rest encrypted").toMatch(
        new RegExp(`^${ENCRYPTED_PREFIX}`),
      );
      expect(secret.value).not.toContain("super-secret-token");
      expect(secret.isSecret).toBe(true);
      expect(
        stored.spec!.data["REGION"]!.value,
        "non-secret values rest plaintext",
      ).toBe("us-east-1");
      expect(
        stored.spec!.data["EMPTY_SEC"]!.value,
        "empty secret declarations stay empty",
      ).toBe("");
    });
  });

  describe("user-shaped reads redact (Go TestSecrets_UserShapedReadsRedact)", () => {
    it("presents the identical contract on all five boundaries: create echo, get, getByReference, tokenless getByExecutionId, delete echo", async () => {
      const created = await ts.command.create(
        ecInput({ executionId: "aex_redact" }),
      );

      const reads: Array<[string, () => Promise<ExecutionContext>]> = [
        ["create echo", () => Promise.resolve(created)],
        ["get", () => ts.query.get({ value: created.metadata!.id })],
        [
          "getByReference",
          () =>
            ts.query.getByReference({
              kind: ApiResourceKind.execution_context,
              slug: created.metadata!.slug,
            }),
        ],
        [
          "getByExecutionId without token",
          () => ts.query.getByExecutionId({ executionId: "aex_redact" }),
        ],
        // Runs last: it removes the row.
        [
          "delete echo",
          () => ts.command.delete({ resourceId: created.metadata!.id }),
        ],
      ];

      for (const [name, read] of reads) {
        const ec = await read();
        const data = ec.spec!.data;
        expect(
          data["API_TOKEN"]!.value,
          `${name}: non-empty secret must be the marker`,
        ).toBe(REDACTED_MARKER);
        expect(
          data["API_TOKEN"]!.isSecret,
          `${name}: is_secret preserved`,
        ).toBe(true);
        expect(
          data["REGION"]!.value,
          `${name}: non-secrets never redacted`,
        ).toBe("us-east-1");
        expect(
          data["EMPTY_SEC"]!.value,
          `${name}: empty secrets stay empty (a marker would fake a stored value)`,
        ).toBe("");
      }
    });

    it("redaction never reaches the store (Go TestSecrets_RedactionNeverReachesTheStore)", async () => {
      const created = await ts.command.create(
        ecInput({ executionId: "aex_immut" }),
      );
      await ts.query.get({ value: created.metadata!.id });

      const stored = await storedRow(ts, created.metadata!.id);
      expect(
        stored.spec!.data["API_TOKEN"]!.value,
        "the store must never hold the redaction marker",
      ).toMatch(new RegExp(`^${ENCRYPTED_PREFIX}`));
    });
  });

  describe("decrypt-lane dispatch (Go TestSecrets_GetByExecutionIdDispatch + adversarial arms)", () => {
    const EXEC_ID = "aex_dispatch";

    beforeAll(async () => {
      await ts.command.create(ecInput({ executionId: EXEC_ID }));
    });

    async function read(
      headers?: Record<string, string>,
    ): Promise<ExecutionContext> {
      return await ts.query.getByExecutionId(
        { executionId: EXEC_ID },
        { headers },
      );
    }

    it("a scope-bound token decrypts; is_secret survives decryption; empty secrets stay empty", async () => {
      const { token } = ts.server.runnerAuthService.mint(EXEC_ID);
      const ec = await read(bearerHeaders(token));
      expect(ec.spec!.data["API_TOKEN"]!.value).toBe("super-secret-token");
      expect(
        ec.spec!.data["API_TOKEN"]!.isSecret,
        "is_secret survives decryption",
      ).toBe(true);
      expect(ec.spec!.data["REGION"]!.value).toBe("us-east-1");
      expect(
        ec.spec!.data["EMPTY_SEC"]!.value,
        "empty secret declarations pass through the decrypt walk untouched",
      ).toBe("");
    });

    it("repeated authorization headers honor the FIRST value (Go metadata.Get semantics)", async () => {
      // Node joins repeated headers with ", " before Connect sees them —
      // this pre-joined shape is exactly what a two-header request
      // presents to the server. Go reads values[0] and decrypts.
      const { token } = ts.server.runnerAuthService.mint(EXEC_ID);
      const ec = await read({
        authorization: `Bearer ${token}, Bearer junk-second-credential`,
      });
      expect(ec.spec!.data["API_TOKEN"]!.value).toBe("super-secret-token");
    });

    it("a token for another execution redacts (WARN, not error)", async () => {
      const { token } = ts.server.runnerAuthService.mint("aex_someone_else");
      const ec = await read(bearerHeaders(token));
      expect(ec.spec!.data["API_TOKEN"]!.value).toBe(REDACTED_MARKER);
    });

    it("a malformed token redacts", async () => {
      const ec = await read(bearerHeaders("not-a-real-token"));
      expect(ec.spec!.data["API_TOKEN"]!.value).toBe(REDACTED_MARKER);
    });

    it("a non-Bearer authorization scheme redacts", async () => {
      const { token } = ts.server.runnerAuthService.mint(EXEC_ID);
      const ec = await read({ authorization: `Basic ${token}` });
      expect(ec.spec!.data["API_TOKEN"]!.value).toBe(REDACTED_MARKER);
    });

    it("no authorization header at all redacts", async () => {
      const ec = await read();
      expect(ec.spec!.data["API_TOKEN"]!.value).toBe(REDACTED_MARKER);
    });

    it("an EXPIRED scope-bound token redacts (crafted, no sleeps)", async () => {
      const now = Math.floor(Date.now() / 1000);
      const expired = craftToken(RUNNER_KEY, {
        token_type: "execution_scoped",
        execution_id: EXEC_ID,
        iat: now - 120,
        exp: now - 60,
      });
      const ec = await read(bearerHeaders(expired));
      expect(ec.spec!.data["API_TOKEN"]!.value).toBe(REDACTED_MARKER);
    });

    it("a token forged with a DIFFERENT key redacts", async () => {
      const now = Math.floor(Date.now() / 1000);
      const forged = craftToken(Buffer.alloc(32, 9), {
        token_type: "execution_scoped",
        execution_id: EXEC_ID,
        iat: now,
        exp: now + 3600,
      });
      const ec = await read(bearerHeaders(forged));
      expect(ec.spec!.data["API_TOKEN"]!.value).toBe(REDACTED_MARKER);
    });

    it("bearer prefix matching is case-insensitive (Go strings.EqualFold)", async () => {
      const { token } = ts.server.runnerAuthService.mint(EXEC_ID);
      const ec = await read({ authorization: `bearer ${token}` });
      expect(ec.spec!.data["API_TOKEN"]!.value).toBe("super-secret-token");
    });
  });

  describe("decrypt error doctrine", () => {
    it("tampered stored ciphertext drops the ONE key while the read succeeds; intact keys decrypt", async () => {
      const created = await ts.command.create(
        ecInput({
          executionId: "aex_tampered",
          data: {
            GOOD_SECRET: { value: "good-value", isSecret: true },
            BAD_SECRET: { value: "will-be-tampered", isSecret: true },
          },
        }),
      );

      // Corrupt one ciphertext directly in the store: valid prefix, junk
      // payload — the tampered/truncated/wrong-key class.
      const stored = await storedRow(ts, created.metadata!.id);
      stored.spec!.data["BAD_SECRET"]!.value =
        ENCRYPTED_PREFIX +
        Buffer.from("garbage-not-a-ciphertext").toString("base64");
      await ts.server.store.saveResource(
        ApiResourceKind.execution_context,
        created.metadata!.id,
        ExecutionContextSchema,
        stored,
      );

      const { token } = ts.server.runnerAuthService.mint("aex_tampered");
      const ec = await ts.query.getByExecutionId(
        { executionId: "aex_tampered" },
        { headers: bearerHeaders(token) },
      );
      expect(
        ec.spec!.data["GOOD_SECRET"]!.value,
        "intact keys still decrypt",
      ).toBe("good-value");
      expect(
        ec.spec!.data["BAD_SECRET"],
        "the undecryptable key is DROPPED from the runner read, not errored",
      ).toBeUndefined();
    });
  });

  describe("write-boundary guard (Go TestSecrets_ForgedCiphertextInputRejected)", () => {
    it("rejects ciphertext-shaped SECRET input with the pinned copy", async () => {
      const error = await grpcError(() =>
        ts.command.create(
          ecInput({
            data: {
              API_TOKEN: { value: "enc:v1:Zm9yZ2VkLWJsb2I=", isSecret: true },
            },
          }),
        ),
      );
      expect(error.code).toBe(Code.InvalidArgument);
      expect(error.rawMessage).toBe(
        "value for 'API_TOKEN' looks like stored ciphertext (enc:v<N>: prefix); supply the plaintext value",
      );
    });

    it("rejects ciphertext-shaped NON-secret input too (the prefix is server-reserved)", async () => {
      const error = await grpcError(() =>
        ts.command.create(
          ecInput({ data: { PLAIN: { value: "enc:v1:Zm9yZ2VkLWJsb2I=" } } }),
        ),
      );
      expect(error.code).toBe(Code.InvalidArgument);
    });

    it("rejects FUTURE ciphertext versions (enc:v2:) — the guard fails closed on unknown versions", async () => {
      const error = await grpcError(() =>
        ts.command.create(
          ecInput({
            data: {
              API_TOKEN: { value: "enc:v2:Zm9yZ2VkLWJsb2I=", isSecret: true },
            },
          }),
        ),
      );
      expect(error.code).toBe(Code.InvalidArgument);
    });
  });

  describe("pinned wire copy conformance asserts only by code", () => {
    it("apply over an existing slug returns Go's exact AlreadyExists copy (metadata.NAME, not slug)", async () => {
      const name = "Apply Twice";
      await ts.command.apply(ecInput({ name, executionId: "aex_apply_1" }));
      const error = await grpcError(() =>
        ts.command.apply(ecInput({ name, executionId: "aex_apply_2" })),
      );
      expect(error.code).toBe(Code.AlreadyExists);
      expect(error.rawMessage).toBe(`ExecutionContext already exists: ${name}`);
    });

    it("getByExecutionId of an unknown execution returns Go's exact NotFound copy", async () => {
      const error = await grpcError(() =>
        ts.query.getByExecutionId({ executionId: "aex_never_created" }),
      );
      expect(error.code).toBe(Code.NotFound);
      expect(error.rawMessage).toBe(
        "execution_context not found: execution_id=aex_never_created",
      );
    });
  });
});

// ---------------------------------------------------------------------------
// Keyless encryption (WARN-degrade — the legacy plaintext shape).
// ---------------------------------------------------------------------------

describe("executioncontext domain (encryption keyless, runner auth enabled)", () => {
  let ts: TestServer;

  beforeAll(async () => {
    ts = await startServer({
      // Unusable explicit key config → SecretService.fromEnv throws →
      // compose WARN-degrades to the keyless pass-through service.
      STIGMER_ENCRYPTION_KEY: "definitely-not-a-valid-key",
      STIGMER_RUNNER_TOKEN_KEY: RUNNER_KEY.toString("base64"),
    });
  });

  afterAll(async () => {
    await stopServer(ts);
  });

  it("legacy plaintext rows: rest plaintext, redact on user reads, pass through on the runner lane (Go TestSecrets_LegacyPlaintextRows...)", async () => {
    const created = await ts.command.create(
      ecInput({ executionId: "aex_legacy" }),
    );

    const stored = await storedRow(ts, created.metadata!.id);
    expect(
      stored.spec!.data["API_TOKEN"]!.value,
      "precondition: rests plaintext",
    ).toBe("super-secret-token");

    const fetched = await ts.query.get({ value: created.metadata!.id });
    expect(
      fetched.spec!.data["API_TOKEN"]!.value,
      "user read still redacts",
    ).toBe(REDACTED_MARKER);

    const { token } = ts.server.runnerAuthService.mint("aex_legacy");
    const ec = await ts.query.getByExecutionId(
      { executionId: "aex_legacy" },
      { headers: bearerHeaders(token) },
    );
    expect(
      ec.spec!.data["API_TOKEN"]!.value,
      "runner lane passes legacy plaintext through unchanged",
    ).toBe("super-secret-token");
  });

  it("an ENCRYPTED row on the keyless server fails LOUD with the pinned Internal copy (never silent junk)", async () => {
    // Plant a row whose secret is genuine ciphertext (produced with a real
    // key this server does not hold) — the key-file-lost scenario.
    const keyed = SecretService.create(ENCRYPTION_KEY);
    const created = await ts.command.create(
      ecInput({
        executionId: "aex_keyloss",
        data: { HELD_SECRET: { value: "placeholder", isSecret: true } },
      }),
    );
    const stored = await storedRow(ts, created.metadata!.id);
    stored.spec!.data["HELD_SECRET"]!.value = keyed.encrypt(
      "the-real-credential",
    );
    await ts.server.store.saveResource(
      ApiResourceKind.execution_context,
      created.metadata!.id,
      ExecutionContextSchema,
      stored,
    );

    const { token } = ts.server.runnerAuthService.mint("aex_keyloss");
    const error = await grpcError(() =>
      ts.query.getByExecutionId(
        { executionId: "aex_keyloss" },
        { headers: bearerHeaders(token) },
      ),
    );
    expect(error.code).toBe(Code.Internal);
    expect(error.rawMessage).toBe(
      "execution context for aex_keyloss holds encrypted secret 'HELD_SECRET' but no encryption key is configured",
    );
  });
});

// ---------------------------------------------------------------------------
// The DeleteExecutionContext activity seam (store-direct, no server).
// ---------------------------------------------------------------------------

describe("DeleteExecutionContext activity seam", () => {
  it("exports Go's registration name byte-identically", () => {
    expect(DELETE_EXECUTION_CONTEXT_ACTIVITY_NAME).toBe(
      "DeleteExecutionContext",
    );
  });

  it("deletes the EC for an execution and is a no-op when none exists (idempotent)", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ectx-activity-test-"));
    const store = SqliteStore.open(path.join(dir, "stigmer.db"), silentLogger);
    try {
      const ec = ecInput({ executionId: "aex_cleanup" });
      const message = create(ExecutionContextSchema, {
        ...ec,
        metadata: { ...ec.metadata, id: "ectx_cleanup" },
      });
      await store.saveResource(
        ApiResourceKind.execution_context,
        "ectx_cleanup",
        ExecutionContextSchema,
        message,
      );

      await deleteExecutionContextForExecution(
        store,
        silentLogger,
        "aex_cleanup",
      );
      await expect(
        store.getResource(
          ApiResourceKind.execution_context,
          "ectx_cleanup",
          ExecutionContextSchema,
        ),
      ).rejects.toThrow();

      // Second run: the row is gone — best-effort means no throw, ever.
      await expect(
        deleteExecutionContextForExecution(store, silentLogger, "aex_cleanup"),
      ).resolves.toBeUndefined();
    } finally {
      await store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("swallows QUERY failures (closed store: findByField throws before the delete is reached)", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ectx-activity-closed-"));
    const store = SqliteStore.open(path.join(dir, "stigmer.db"), silentLogger);
    await store.close();
    try {
      await expect(
        deleteExecutionContextForExecution(store, silentLogger, "aex_whatever"),
      ).resolves.toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("swallows DELETE failures (row found, delete throws → WARN, row left in place, no throw)", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ectx-activity-delfail-"));
    const store = SqliteStore.open(path.join(dir, "stigmer.db"), silentLogger);
    try {
      const ec = ecInput({ executionId: "aex_delfail" });
      await store.saveResource(
        ApiResourceKind.execution_context,
        "ectx_delfail",
        ExecutionContextSchema,
        create(ExecutionContextSchema, {
          ...ec,
          metadata: { ...ec.metadata, id: "ectx_delfail" },
        }),
      );

      // A delegating stub that fails ONLY the delete — exercises the
      // second best-effort branch (find succeeds, delete throws).
      const failingStore = {
        findByField: store.findByField.bind(store),
        deleteResource: () =>
          Promise.reject(new Error("simulated delete failure")),
      } as unknown as Parameters<typeof deleteExecutionContextForExecution>[0];

      await expect(
        deleteExecutionContextForExecution(
          failingStore,
          silentLogger,
          "aex_delfail",
        ),
      ).resolves.toBeUndefined();

      const survivor = await store.getResource(
        ApiResourceKind.execution_context,
        "ectx_delfail",
        ExecutionContextSchema,
      );
      expect(survivor.metadata?.id, "the row survives a failed delete").toBe(
        "ectx_delfail",
      );
    } finally {
      await store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Search extractor (metadata only — secrets never reach FTS).
// ---------------------------------------------------------------------------

describe("search extractor", () => {
  it("indexes name/tags/org/visibility with an EMPTY description (no spec field is indexed)", () => {
    const ec = create(ExecutionContextSchema, {
      metadata: {
        name: "Indexed",
        org: ORG,
        tags: ["a", "b"],
      },
      spec: {
        executionId: "aex_idx",
        data: { API_TOKEN: { value: "must-never-be-indexed", isSecret: true } },
      },
    });
    const entry = executionContextSearchExtractor.getSearchIndexEntry(ec);
    expect(entry).toBeDefined();
    expect(entry!.name).toBe("Indexed");
    expect(
      entry!.description,
      "EC has no description; Go's summary is empty",
    ).toBe("");
    expect(entry!.tags).toBe("a b");
    expect(entry!.org).toBe(ORG);
    expect(JSON.stringify(entry)).not.toContain("must-never-be-indexed");
  });

  it("returns undefined without metadata (Go's nil guard)", () => {
    const ec = create(ExecutionContextSchema, {});
    expect(
      executionContextSearchExtractor.getSearchIndexEntry(ec),
    ).toBeUndefined();
  });
});

// Bearer extraction precision — the two parsing arms the dispatch matrix
// above does not isolate: Go's length guard ("Bearer " with an empty
// remainder) and strings.TrimSpace on the extracted token.
describe("bearer header edge shapes (through the enabled server)", () => {
  let ts: TestServer;

  beforeAll(async () => {
    ts = await startServer({
      STIGMER_ENCRYPTION_KEY: ENCRYPTION_KEY.toString("base64"),
      STIGMER_RUNNER_TOKEN_KEY: RUNNER_KEY.toString("base64"),
    });
    await ts.command.create(ecInput({ executionId: "aex_edges" }));
  });

  afterAll(async () => {
    await stopServer(ts);
  });

  it("'Bearer' with an empty remainder redacts (Go's length guard)", async () => {
    const ec = await ts.query.getByExecutionId(
      { executionId: "aex_edges" },
      { headers: { authorization: "Bearer " } },
    );
    expect(ec.spec!.data["API_TOKEN"]!.value).toBe(REDACTED_MARKER);
  });

  it("surrounding whitespace around the token is trimmed (Go strings.TrimSpace)", async () => {
    const { token } = ts.server.runnerAuthService.mint("aex_edges");
    const ec = await ts.query.getByExecutionId(
      { executionId: "aex_edges" },
      { headers: { authorization: `Bearer   ${token}  ` } },
    );
    expect(ec.spec!.data["API_TOKEN"]!.value).toBe("super-secret-token");
  });
});
