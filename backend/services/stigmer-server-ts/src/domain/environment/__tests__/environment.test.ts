/**
 * Pins the environment domain against Go's environment_controller_test.go
 * + environment_encryption_test.go + update_visibility_test.go — through
 * the REAL stack: a composed server on an ephemeral port, a native gRPC
 * client, the full interceptor chain.
 *
 * The load-bearing pins the conformance suite CANNOT cover (it is a black
 * box; these need direct store access or key control):
 *   - secrets rest as enc:v1: CIPHERTEXT in the store, never plaintext;
 *   - the marker round-trip re-persists the IDENTICAL ciphertext (no
 *     double encryption — the sentinels→encrypt ordering proof);
 *   - the keyless WARN-degrade path (invalid explicit key config) stores
 *     plaintext, still redacts on read, and reveal of a stranded
 *     ciphertext row fails LOUD (Internal), never returns junk.
 *
 * Keys are injected via env (vi.stubEnv) so the ladder short-circuits
 * before its file steps — the real ~/.stigmer is never touched (DD-002).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, createClient } from "@connectrpc/connect";
import type { Client, Transport } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { EnvironmentSchema } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/api_pb";
import { EnvironmentCommandController } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/command_pb";
import { EnvironmentQueryController } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/query_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { loadConfig } from "../../../boot/config.js";
import { composeServer } from "../../../boot/compose.js";
import type { ComposedServer } from "../../../boot/compose.js";
import { createLogger } from "../../../boot/logger.js";
import { ENCRYPTED_PREFIX, isCiphertextShaped } from "../../../encryption/encryption.js";
import { REDACTED_MARKER } from "../constants.js";

const silentLogger = createLogger({ level: "error", pretty: false, write: () => {} });

const TEST_KEY_B64 = Buffer.alloc(32, 7).toString("base64");
const API_VERSION = "agentic.stigmer.ai/v1";
const KIND = "Environment";
const ORG = "acme";

type CommandClient = Client<typeof EnvironmentCommandController>;
type QueryClient = Client<typeof EnvironmentQueryController>;

interface TestServer {
  server: ComposedServer;
  command: CommandClient;
  query: QueryClient;
  dir: string;
}

async function startServer(env: Record<string, string>): Promise<TestServer> {
  const dir = mkdtempSync(path.join(tmpdir(), "env-domain-test-"));
  for (const [key, value] of Object.entries(env)) {
    vi.stubEnv(key, value);
  }
  const server = composeServer({
    config: loadConfig({
      STIGMER_MODEL_REGISTRY_REFRESH: "off",
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
    command: createClient(EnvironmentCommandController, transport),
    query: createClient(EnvironmentQueryController, transport),
    dir,
  };
}

async function stopServer(ts: TestServer): Promise<void> {
  await ts.server.shutdown();
  rmSync(ts.dir, { recursive: true, force: true });
}

let counter = 0;
function envInput(overrides?: {
  name?: string;
  org?: string;
  labels?: Record<string, string>;
  data?: Record<string, { value: string; isSecret?: boolean; description?: string }>;
}) {
  counter += 1;
  return {
    apiVersion: API_VERSION,
    kind: KIND,
    metadata: {
      name: overrides?.name ?? `Env ${counter}`,
      org: overrides?.org ?? ORG,
      labels: overrides?.labels ?? {},
    },
    spec: {
      description: "created by the domain test",
      data: Object.fromEntries(
        Object.entries(overrides?.data ?? {}).map(([k, v]) => [
          k,
          { value: v.value, isSecret: v.isSecret ?? false, description: v.description ?? "" },
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

// ---------------------------------------------------------------------------
// Encryption-enabled server (the production shape).
// ---------------------------------------------------------------------------

describe("environment domain (encryption enabled)", () => {
  let ts: TestServer;

  beforeAll(async () => {
    ts = await startServer({
      STIGMER_ENCRYPTION_KEY: TEST_KEY_B64,
      STIGMER_RUNNER_TOKEN_KEY: Buffer.alloc(32, 8).toString("base64"),
    });
  });

  afterAll(async () => {
    await stopServer(ts);
    vi.unstubAllEnvs();
  });

  describe("create + redaction doctrine", () => {
    it("mints an env_ id, redacts secrets in the response, and leaves non-secrets readable", async () => {
      const created = await ts.command.create(
        envInput({
          data: {
            API_KEY: { value: "sk-secret-1", isSecret: true, description: "the key" },
            REGION: { value: "us-east-1" },
          },
        }),
      );
      expect(created.metadata?.id).toMatch(/^env_[0-9a-z]{26}$/);
      expect(created.spec?.data["API_KEY"]?.value).toBe(REDACTED_MARKER);
      expect(created.spec?.data["API_KEY"]?.isSecret).toBe(true);
      expect(created.spec?.data["API_KEY"]?.description).toBe("the key");
      expect(created.spec?.data["REGION"]?.value).toBe("us-east-1");
    });

    it("stores enc:v1: CIPHERTEXT at rest — never the plaintext, never the marker", async () => {
      const created = await ts.command.create(
        envInput({ data: { TOKEN: { value: "super-secret", isSecret: true } } }),
      );
      const stored = await ts.server.store.getResource(
        ApiResourceKind.environment,
        created.metadata?.id ?? "",
        EnvironmentSchema,
      );
      const atRest = stored.spec?.data["TOKEN"]?.value ?? "";
      expect(isCiphertextShaped(atRest)).toBe(true);
      expect(atRest).not.toContain("super-secret");
    });

    it("leaves an EMPTY secret declaration empty — no false marker", async () => {
      const created = await ts.command.create(
        envInput({ data: { PENDING: { value: "", isSecret: true } } }),
      );
      expect(created.spec?.data["PENDING"]?.value).toBe("");
    });
  });

  describe("getSecretValue (the reveal path)", () => {
    it("reveals the decrypted plaintext with is_secret and description intact", async () => {
      const created = await ts.command.create(
        envInput({
          data: { DB_PASS: { value: "p@ss w0rd", isSecret: true, description: "db" } },
        }),
      );
      const revealed = await ts.query.getSecretValue({
        environmentId: created.metadata?.id ?? "",
        key: "DB_PASS",
      });
      expect(revealed.value).toBe("p@ss w0rd");
      expect(revealed.isSecret).toBe(true);
      expect(revealed.description).toBe("db");
    });

    it("returns a non-secret value as-is", async () => {
      const created = await ts.command.create(
        envInput({ data: { REGION: { value: "eu-west-1" } } }),
      );
      const value = await ts.query.getSecretValue({
        environmentId: created.metadata?.id ?? "",
        key: "REGION",
      });
      expect(value.value).toBe("eu-west-1");
      expect(value.isSecret).toBe(false);
    });

    it("answers NotFound with the pinned copy for a missing key", async () => {
      const created = await ts.command.create(envInput());
      const error = await grpcError(() =>
        ts.query.getSecretValue({
          environmentId: created.metadata?.id ?? "",
          key: "GHOST",
        }),
      );
      expect(error.code).toBe(Code.NotFound);
      expect(error.rawMessage).toBe("environment key not found: GHOST");
    });
  });

  describe("the marker round-trip (sentinels → encrypt ordering)", () => {
    it("update with the marker preserves the stored secret — ciphertext IDENTICAL (no double encryption)", async () => {
      const created = await ts.command.create(
        envInput({ data: { API_KEY: { value: "keep-me", isSecret: true } } }),
      );
      const id = created.metadata?.id ?? "";
      const before = await ts.server.store.getResource(
        ApiResourceKind.environment,
        id,
        EnvironmentSchema,
      );
      const cipherBefore = before.spec?.data["API_KEY"]?.value ?? "";

      // Full-resource update echoing the redacted read back (the client
      // round-trip shape), plus a spec change.
      const updated = await ts.command.update(
        create(EnvironmentSchema, {
          apiVersion: API_VERSION,
          kind: KIND,
          metadata: created.metadata,
          spec: {
            description: "updated description",
            data: {
              API_KEY: { value: REDACTED_MARKER, isSecret: true, description: "" },
            },
          },
        }),
      );
      expect(updated.spec?.data["API_KEY"]?.value).toBe(REDACTED_MARKER);

      const after = await ts.server.store.getResource(
        ApiResourceKind.environment,
        id,
        EnvironmentSchema,
      );
      expect(after.spec?.data["API_KEY"]?.value).toBe(cipherBefore);

      const revealed = await ts.query.getSecretValue({ environmentId: id, key: "API_KEY" });
      expect(revealed.value).toBe("keep-me");
    });

    it("rejects the marker on create with the pinned copy (nothing to preserve)", async () => {
      const error = await grpcError(() =>
        ts.command.create(
          envInput({ data: { API_KEY: { value: REDACTED_MARKER, isSecret: true } } }),
        ),
      );
      expect(error.code).toBe(Code.InvalidArgument);
      expect(error.rawMessage).toBe(
        "variable 'API_KEY': cannot use the redaction marker as a secret value",
      );
    });

    it("rejects the marker on update for a key that had no prior secret", async () => {
      const created = await ts.command.create(envInput());
      const error = await grpcError(() =>
        ts.command.update(
          create(EnvironmentSchema, {
            apiVersion: API_VERSION,
            kind: KIND,
            metadata: created.metadata,
            spec: {
              data: { NEW_KEY: { value: REDACTED_MARKER, isSecret: true } },
            },
          }),
        ),
      );
      expect(error.code).toBe(Code.InvalidArgument);
      expect(error.rawMessage).toBe(
        "variable 'NEW_KEY': cannot use the redaction marker as a secret value",
      );
    });
  });

  describe("forged-ciphertext rejection (oss#395)", () => {
    const FORGED = "enc:v1:Zm9yZ2VkLWNpcGhlcnRleHQ=";
    const PINNED_MESSAGE =
      "variable 'EVIL' must be plaintext — values carrying the 'enc:' " +
      "encryption prefix are not accepted from clients";

    it("rejects a ciphertext-shaped SECRET on create, any version prefix", async () => {
      for (const forged of [FORGED, "enc:v2:whatever"]) {
        const error = await grpcError(() =>
          ts.command.create(
            envInput({ data: { EVIL: { value: forged, isSecret: true } } }),
          ),
        );
        expect(error.code).toBe(Code.InvalidArgument);
        expect(error.rawMessage).toBe(PINNED_MESSAGE);
      }
    });

    it("rejects a ciphertext-shaped secret on updateVariables", async () => {
      const created = await ts.command.create(envInput());
      const error = await grpcError(() =>
        ts.command.updateVariables({
          environmentId: created.metadata?.id ?? "",
          variables: { EVIL: { value: FORGED, isSecret: true, description: "" } },
        }),
      );
      expect(error.code).toBe(Code.InvalidArgument);
      expect(error.rawMessage).toBe(PINNED_MESSAGE);
    });

    it("passes a ciphertext-shaped NON-secret through — the pinned exemption (inert value)", async () => {
      const created = await ts.command.create(
        envInput({ data: { DOC_EXAMPLE: { value: FORGED } } }),
      );
      expect(created.spec?.data["DOC_EXAMPLE"]?.value).toBe(FORGED);
    });
  });

  describe("personal-environment uniqueness (per org, create-only)", () => {
    const personal = { "stigmer.ai/personal": "true" };

    it("allows one personal env per org, rejects the second with the pinned copy", async () => {
      const first = await ts.command.create(
        envInput({ org: "personal-org-a", labels: personal }),
      );
      const error = await grpcError(() =>
        ts.command.create(envInput({ org: "personal-org-a", labels: personal })),
      );
      expect(error.code).toBe(Code.AlreadyExists);
      expect(error.rawMessage).toBe(
        `a personal environment already exists for this organization: ${first.metadata?.id}`,
      );
    });

    it("scopes the check per org — another org gets its own personal env", async () => {
      await ts.command.create(envInput({ org: "personal-org-b", labels: personal }));
      const other = await ts.command.create(
        envInput({ org: "personal-org-c", labels: personal }),
      );
      expect(other.metadata?.id).toMatch(/^env_/);
    });

    it("update of the personal env never matches itself (create-only check)", async () => {
      const created = await ts.command.create(
        envInput({ org: "personal-org-d", labels: personal }),
      );
      const updated = await ts.command.update(
        create(EnvironmentSchema, {
          apiVersion: API_VERSION,
          kind: KIND,
          metadata: created.metadata,
          spec: { description: "still unique" },
        }),
      );
      expect(updated.spec?.description).toBe("still unique");
    });
  });

  describe("updateVisibility (ceiling: org; share restrictions)", () => {
    it("widens a normal environment to org and stamps the status audit", async () => {
      const created = await ts.command.create(envInput());
      const updated = await ts.command.updateVisibility({
        resourceId: created.metadata?.id ?? "",
        visibility: ApiResourceVisibility.visibility_org,
      });
      expect(updated.metadata?.visibility).toBe(ApiResourceVisibility.visibility_org);
      expect(updated.status?.audit?.statusAudit?.event).toBe("updated");
    });

    it("rejects org sharing of a personal env with the pinned FailedPrecondition copy", async () => {
      const created = await ts.command.create(
        envInput({ org: "vis-org-a", labels: { "stigmer.ai/personal": "true" } }),
      );
      const error = await grpcError(() =>
        ts.command.updateVisibility({
          resourceId: created.metadata?.id ?? "",
          visibility: ApiResourceVisibility.visibility_org,
        }),
      );
      expect(error.code).toBe(Code.FailedPrecondition);
      expect(error.rawMessage).toBe(
        "personal environments cannot be shared with the organization - " +
          "create a dedicated environment with only the credentials the agent needs",
      );
    });

    it("rejects org sharing of an OAuth-managed env", async () => {
      const created = await ts.command.create(
        envInput({ labels: { "stigmer.ai/managed": "true" } }),
      );
      const error = await grpcError(() =>
        ts.command.updateVisibility({
          resourceId: created.metadata?.id ?? "",
          visibility: ApiResourceVisibility.visibility_org,
        }),
      );
      expect(error.code).toBe(Code.FailedPrecondition);
      expect(error.rawMessage).toBe(
        "OAuth-managed environments cannot be shared with the organization - " +
          "OAuth tokens are per-user credentials",
      );
    });

    it("always allows restoring a share-restricted env to private (only widening is gated)", async () => {
      const created = await ts.command.create(
        envInput({ org: "vis-org-b", labels: { "stigmer.ai/personal": "true" } }),
      );
      const restored = await ts.command.updateVisibility({
        resourceId: created.metadata?.id ?? "",
        visibility: ApiResourceVisibility.visibility_private,
      });
      expect(restored.metadata?.visibility).toBe(
        ApiResourceVisibility.visibility_private,
      );
    });

    it("NOT_FOUND wins over a bad level for an unknown id (cross-edition precedence)", async () => {
      const error = await grpcError(() =>
        ts.command.updateVisibility({
          resourceId: "env_does_not_exist",
          visibility: ApiResourceVisibility.visibility_public,
        }),
      );
      expect(error.code).toBe(Code.NotFound);
    });
  });

  describe("incremental variable management", () => {
    it("updateVariables merges: request keys overwrite, absent keys preserved, secrets encrypted", async () => {
      const created = await ts.command.create(
        envInput({
          data: {
            KEEP: { value: "kept" },
            OVERWRITE: { value: "old" },
          },
        }),
      );
      const id = created.metadata?.id ?? "";
      const updated = await ts.command.updateVariables({
        environmentId: id,
        variables: {
          OVERWRITE: { value: "new", isSecret: false, description: "" },
          ADDED_SECRET: { value: "shh", isSecret: true, description: "" },
        },
      });
      expect(updated.spec?.data["KEEP"]?.value).toBe("kept");
      expect(updated.spec?.data["OVERWRITE"]?.value).toBe("new");
      expect(updated.spec?.data["ADDED_SECRET"]?.value).toBe(REDACTED_MARKER);

      const stored = await ts.server.store.getResource(
        ApiResourceKind.environment,
        id,
        EnvironmentSchema,
      );
      expect(
        (stored.spec?.data["ADDED_SECRET"]?.value ?? "").startsWith(ENCRYPTED_PREFIX),
      ).toBe(true);
    });

    it("updateVariables preserves an existing secret sent back as the marker", async () => {
      const created = await ts.command.create(
        envInput({ data: { TOKEN: { value: "original", isSecret: true } } }),
      );
      const id = created.metadata?.id ?? "";
      await ts.command.updateVariables({
        environmentId: id,
        variables: { TOKEN: { value: REDACTED_MARKER, isSecret: true, description: "" } },
      });
      const revealed = await ts.query.getSecretValue({ environmentId: id, key: "TOKEN" });
      expect(revealed.value).toBe("original");
    });

    it("removeVariables deletes named keys and silently ignores unknown ones", async () => {
      const created = await ts.command.create(
        envInput({ data: { A: { value: "1" }, B: { value: "2" } } }),
      );
      const updated = await ts.command.removeVariables({
        environmentId: created.metadata?.id ?? "",
        keys: ["A", "GHOST"],
      });
      expect(updated.spec?.data["A"]).toBeUndefined();
      expect(updated.spec?.data["B"]?.value).toBe("2");
    });

    it("rejects an empty removeVariables key list at the protovalidate boundary", async () => {
      const created = await ts.command.create(envInput());
      const error = await grpcError(() =>
        ts.command.removeVariables({
          environmentId: created.metadata?.id ?? "",
          keys: [],
        }),
      );
      expect(error.code).toBe(Code.InvalidArgument);
    });

    it("answers NotFound for variable operations on an unknown environment", async () => {
      const error = await grpcError(() =>
        ts.command.updateVariables({
          environmentId: "env_ghost",
          variables: { X: { value: "1", isSecret: false, description: "" } },
        }),
      );
      expect(error.code).toBe(Code.NotFound);
      expect(error.rawMessage).toBe("environment not found: env_ghost");
    });
  });

  describe("list", () => {
    it("filters by org + AND-labels, redacts every item, sorts newest first", async () => {
      const org = "list-org";
      const a = await ts.command.create(
        envInput({
          org,
          labels: { tier: "prod" },
          data: { S: { value: "secret", isSecret: true } },
        }),
      );
      const b = await ts.command.create(envInput({ org, labels: { tier: "prod", extra: "y" } }));
      await ts.command.create(envInput({ org, labels: { tier: "dev" } }));
      await ts.command.create(envInput({ org: "other-org", labels: { tier: "prod" } }));

      const all = await ts.query.list({ org });
      expect(all.totalCount).toBe(3);
      // Newest first: b was created after a.
      const ids = all.items.map((e) => e.metadata?.id);
      expect(ids.indexOf(b.metadata?.id ?? "")).toBeLessThan(
        ids.indexOf(a.metadata?.id ?? ""),
      );
      const withSecret = all.items.find((e) => e.metadata?.id === a.metadata?.id);
      expect(withSecret?.spec?.data["S"]?.value).toBe(REDACTED_MARKER);

      const prodOnly = await ts.query.list({ org, labels: { tier: "prod" } });
      expect(prodOnly.totalCount).toBe(2);

      const narrow = await ts.query.list({ org, labels: { tier: "prod", extra: "y" } });
      expect(narrow.totalCount).toBe(1);
      expect(narrow.items[0]?.metadata?.id).toBe(b.metadata?.id);
    });
  });

  describe("get / getByReference / delete return redacted resources", () => {
    it("get and getByReference redact; delete returns the redacted parting copy", async () => {
      const created = await ts.command.create(
        envInput({ org: "read-org", data: { K: { value: "v", isSecret: true } } }),
      );
      const id = created.metadata?.id ?? "";

      const got = await ts.query.get({ value: id });
      expect(got.spec?.data["K"]?.value).toBe(REDACTED_MARKER);

      const byRef = await ts.query.getByReference({
        slug: created.metadata?.slug ?? "",
        org: "read-org",
        kind: ApiResourceKind.environment,
      });
      expect(byRef.metadata?.id).toBe(id);
      expect(byRef.spec?.data["K"]?.value).toBe(REDACTED_MARKER);

      const deleted = await ts.command.delete({ resourceId: id });
      expect(deleted.spec?.data["K"]?.value).toBe(REDACTED_MARKER);

      const error = await grpcError(() => ts.query.get({ value: id }));
      expect(error.code).toBe(Code.NotFound);
    });
  });
});

// ---------------------------------------------------------------------------
// Keyless server (the WARN-degrade path): an INVALID explicit key makes
// compose fall back to the disabled pass-through service.
// ---------------------------------------------------------------------------

describe("environment domain (encryption degraded to plaintext)", () => {
  let ts: TestServer;

  beforeAll(async () => {
    ts = await startServer({
      STIGMER_ENCRYPTION_KEY: "not!!valid@@base64",
      STIGMER_RUNNER_TOKEN_KEY: Buffer.alloc(32, 8).toString("base64"),
    });
  });

  afterAll(async () => {
    await stopServer(ts);
    vi.unstubAllEnvs();
  });

  it("stores secrets as PLAINTEXT (degraded), still redacts on read, reveal works", async () => {
    const created = await ts.command.create(
      envInput({ data: { S: { value: "plain-secret", isSecret: true } } }),
    );
    const id = created.metadata?.id ?? "";
    expect(created.spec?.data["S"]?.value).toBe(REDACTED_MARKER);

    const stored = await ts.server.store.getResource(
      ApiResourceKind.environment,
      id,
      EnvironmentSchema,
    );
    expect(stored.spec?.data["S"]?.value).toBe("plain-secret");

    const revealed = await ts.query.getSecretValue({ environmentId: id, key: "S" });
    expect(revealed.value).toBe("plain-secret");
  });

  it("still rejects forged enc:v<N>: input — the guard is unconditional on keyless deployments", async () => {
    const error = await grpcError(() =>
      ts.command.create(
        envInput({ data: { EVIL: { value: "enc:v1:Zm9yZ2Vk", isSecret: true } } }),
      ),
    );
    expect(error.code).toBe(Code.InvalidArgument);
  });

  it("fails LOUD (Internal) revealing a stranded ciphertext row — never returns ciphertext", async () => {
    // Seed a row holding real ciphertext (as if the key file were lost).
    const seeded = create(EnvironmentSchema, {
      apiVersion: API_VERSION,
      kind: KIND,
      metadata: { id: "env_stranded", name: "Stranded", slug: "stranded", org: ORG },
      spec: {
        data: {
          LOST: { value: "enc:v1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=", isSecret: true },
        },
      },
    });
    await ts.server.store.saveResource(
      ApiResourceKind.environment,
      "env_stranded",
      EnvironmentSchema,
      seeded,
    );

    const error = await grpcError(() =>
      ts.query.getSecretValue({ environmentId: "env_stranded", key: "LOST" }),
    );
    expect(error.code).toBe(Code.Internal);
    expect(error.rawMessage).toBe("failed to decrypt secret value");
  });
});
