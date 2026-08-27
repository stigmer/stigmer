/**
 * Pins the platform domain against Go's platform_controller_test.go +
 * get_runner_scoped_token_test.go — through the real stack (composed
 * server, native gRPC client, full interceptor chain; the #15 pattern),
 * plus a keyless-service arm on an in-process router.
 *
 * The load-bearing pins the conformance suite deliberately does NOT cover
 * (its platform file excludes getRunnerScopedToken — the arms are gated on
 * runner-class flows):
 *   - the oss#535 FAIL-SOFT matrix: execution-id arms mint; pool_claim/
 *     renewal/unset/empty-id/keyless all answer the presence-based
 *     "not minted" EMPTY output, never a gRPC error;
 *   - a minted token actually verifies against the SAME key the
 *     executioncontext decrypt lane uses, bound to exactly the named
 *     execution id;
 *   - getRunnerBootstrapConfig echoes the configured Temporal coordinates
 *     with the token fields empty (minting a proxy token is cloud-only).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  Code,
  ConnectError,
  createClient,
  createRouterTransport,
} from "@connectrpc/connect";
import type { Client, Transport } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { MessageInitShape } from "@bufbuild/protobuf";
import {
  GetRunnerScopedTokenInputSchema,
  PlatformQueryController,
  ServerEdition,
} from "@stigmer/protos/ai/stigmer/platform/v1/server_info_pb";

import { loadConfig } from "../../../boot/config.js";
import { composeServer } from "../../../boot/compose.js";
import type { ComposedServer } from "../../../boot/compose.js";
import { createLogger } from "../../../boot/logger.js";
import { newExecutionScopedRunnerCredentialProvider } from "../../../runnerauth/runner-credential-provider.js";
import type {
  RunnerCredentialProvider,
  RunnerScopedTokenRequest,
} from "../../../runnerauth/runner-credential-provider.js";
import {
  InvalidTokenError,
  RunnerAuthService,
} from "../../../runnerauth/runnerauth.js";
import { registerPlatformServices } from "../controller.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

const RUNNER_KEY = Buffer.alloc(32, 5);
const ENC_KEY = Buffer.alloc(32, 6);

type PlatformClient = Client<typeof PlatformQueryController>;

describe("platform domain (composed server)", () => {
  let server: ComposedServer;
  let client: PlatformClient;
  let dir: string;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "platform-domain-test-"));
    vi.stubEnv("STIGMER_RUNNER_TOKEN_KEY", RUNNER_KEY.toString("base64"));
    vi.stubEnv("STIGMER_ENCRYPTION_KEY", ENC_KEY.toString("base64"));
    server = await composeServer({
      config: loadConfig({
        STIGMER_MODEL_REGISTRY_REFRESH: "off",
        DB_PATH: path.join(dir, "stigmer.db"),
        ARTIFACT_LOCAL_BASE_PATH: path.join(dir, "artifacts"),
        TEMPORAL_HOST_PORT: "127.0.0.1:7777",
        TEMPORAL_NAMESPACE: "conformance-ns",
      }),
      logger: silentLogger,
      portOverride: 0,
      host: "127.0.0.1",
    });
    const port = await server.start();
    const transport: Transport = createGrpcTransport({
      baseUrl: `http://127.0.0.1:${port}`,
    });
    client = createClient(PlatformQueryController, transport);
  });

  afterAll(async () => {
    await server.shutdown();
    rmSync(dir, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it("getServerInfo names the oss edition and the dev version, stable across calls", async () => {
    const first = await client.getServerInfo({});
    expect(first.edition).toBe(ServerEdition.oss);
    // Unbundled runs report Go's unstamped default; release bundles stamp
    // the esbuild define (scripts/bundle-slim.mjs).
    expect(first.version).toBe("dev");

    const second = await client.getServerInfo({});
    expect(second.edition).toBe(first.edition);
    expect(second.version).toBe(first.version);
  });

  it("getRunnerBootstrapConfig echoes the configured Temporal coordinates, token fields empty", async () => {
    const config = await client.getRunnerBootstrapConfig({});
    expect(config.temporalAddress).toBe("127.0.0.1:7777");
    expect(config.temporalNamespace).toBe("conformance-ns");

    // Presence-based contract: no token means no companion fields — OSS
    // never mints the proxy token (cloud-only capability).
    expect(config.runnerAccessToken).toBe("");
    expect(config.tokenType).toBe("");
    expect(config.runnerAccessTokenExpiresInSeconds).toBe(0);
    expect(config.payloadEncryptionKeyId).toBe("");
    expect(config.payloadEncryptionKey).toBe("");
  });

  it("mints for the agent_execution_id arm, bound to exactly that execution", async () => {
    const out = await client.getRunnerScopedToken({
      scope: { case: "agentExecutionId", value: "aexec_01platformtest" },
    });

    expect(out.runnerScopedToken).not.toBe("");
    expect(out.tokenType).toBe("Bearer");
    expect(out.expiresInSeconds).toBe(3600);

    // The minted token verifies against the SAME key the EC decrypt lane
    // uses, and its binding is the named execution id.
    expect(server.runnerAuthService.verify(out.runnerScopedToken)).toBe(
      "aexec_01platformtest",
    );
  });

  it("mints for the workflow_execution_id arm", async () => {
    const out = await client.getRunnerScopedToken({
      scope: { case: "workflowExecutionId", value: "wexec_01platformtest" },
    });
    expect(out.tokenType).toBe("Bearer");
    expect(server.runnerAuthService.verify(out.runnerScopedToken)).toBe(
      "wexec_01platformtest",
    );
  });

  it("answers the not-minted shape for empty ids, pool_claim, and renewal", async () => {
    const arms: MessageInitShape<typeof GetRunnerScopedTokenInputSchema>[] = [
      { scope: { case: "agentExecutionId", value: "" } },
      { scope: { case: "workflowExecutionId", value: "" } },
      { scope: { case: "poolClaim", value: { sessionId: "ses_x" } } },
      { scope: { case: "renewal", value: {} } },
    ];
    for (const input of arms) {
      const out = await client.getRunnerScopedToken(input);
      expect(out.runnerScopedToken, JSON.stringify(input)).toBe("");
      expect(out.tokenType, JSON.stringify(input)).toBe("");
      expect(out.expiresInSeconds, JSON.stringify(input)).toBe(0);
    }
  });

  it("an unset scope is rejected by protovalidate BEFORE the handler (both editions)", async () => {
    // The proto pins `scope` as a required oneof, so the wire can never
    // reach the handler's defensive undefined arm — the same InvalidArgument
    // protovalidate answers on the Go server.
    try {
      await client.getRunnerScopedToken({});
      throw new Error("expected the call to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ConnectError);
      expect((error as ConnectError).code).toBe(Code.InvalidArgument);
    }
  });
});

describe("platform domain (keyless runner-token service)", () => {
  it("a keyless service answers not-minted — fail-soft, never an error", async () => {
    const transport = createRouterTransport((router) => {
      registerPlatformServices(router, {
        temporalHostPort: "localhost:7233",
        temporalNamespace: "default",
        runnerAuthService: newExecutionScopedRunnerCredentialProvider(
          RunnerAuthService.create(undefined),
        ),
        edition: ServerEdition.oss,
        logger: silentLogger,
      });
    });
    const client = createClient(PlatformQueryController, transport);

    const out = await client.getRunnerScopedToken({
      scope: { case: "agentExecutionId", value: "aexec_01keyless" },
    });
    expect(out.runnerScopedToken).toBe("");
    expect(out.tokenType).toBe("");
    expect(out.expiresInSeconds).toBe(0);
  });
});

/**
 * The C4 capability delegation (gate ruling Q1), proven through the FULL
 * stack: a provider registered via the extension registry, the identity
 * interceptor stamping the trusted-local caller, and the platform
 * controller delegating every arm. This is the seam the cloud
 * composition's exchange rides — the fakes record exactly what crossed
 * it.
 */
describe("platform domain (capability-delegating provider — C4)", () => {
  let server: ComposedServer;
  let client: PlatformClient;
  let dir: string;
  const exchanged: {
    request: RunnerScopedTokenRequest;
    callerIdentityId: string;
    callerClass: string;
  }[] = [];
  let bootstrapCallerIds: string[] = [];
  let bootstrapThrows = false;

  const capabilityProvider: RunnerCredentialProvider = {
    isEnabled: () => false,
    mint: () => {
      throw new Error("primitive mint is not under test here");
    },
    verify: () => {
      throw new InvalidTokenError();
    },
    async exchangeScopedToken(request, caller) {
      exchanged.push({
        request,
        callerIdentityId: caller.identityId,
        callerClass: caller.callerClass,
      });
      if (request.arm === "pool-claim" && request.sessionId === "ses_denied") {
        throw new ConnectError(
          "pool member holds no claim for session ses_denied",
          Code.PermissionDenied,
        );
      }
      if (request.arm === "renewal") {
        return { minted: false };
      }
      return { minted: true, token: "cloud-token", expiresInSeconds: 14400 };
    },
    async bootstrapCredentials(caller) {
      if (bootstrapThrows) {
        throw new Error("payload key store unavailable");
      }
      bootstrapCallerIds.push(caller.identityId);
      return {
        accessToken: { token: "cloud-bootstrap-token", expiresInSeconds: 900 },
        payloadKeys: {
          keyId: "rpk_test1",
          keyBase64: "a2V5",
          secondaryKeyId: "rpk_test0",
          secondaryKeyBase64: "b2xk",
        },
      };
    },
  };

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "platform-capability-test-"));
    vi.stubEnv("STIGMER_ENCRYPTION_KEY", ENC_KEY.toString("base64"));
    server = await composeServer({
      config: loadConfig({
        STIGMER_MODEL_REGISTRY_REFRESH: "off",
        DB_PATH: path.join(dir, "stigmer.db"),
        ARTIFACT_LOCAL_BASE_PATH: path.join(dir, "artifacts"),
        TEMPORAL_HOST_PORT: "127.0.0.1:7777",
        TEMPORAL_NAMESPACE: "conformance-ns",
      }),
      logger: silentLogger,
      portOverride: 0,
      host: "127.0.0.1",
      extensions: [
        {
          name: "fake-cloud-credentials",
          drivers: { runnerCredentialProvider: capabilityProvider },
        },
      ],
    });
    const port = await server.start();
    client = createClient(
      PlatformQueryController,
      createGrpcTransport({ baseUrl: `http://127.0.0.1:${port}` }),
    );
  });

  afterAll(async () => {
    await server.shutdown();
    rmSync(dir, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it("delegates every exchange arm with the stamped caller identity", async () => {
    exchanged.length = 0;

    const minted = await client.getRunnerScopedToken({
      scope: { case: "agentExecutionId", value: "aexec_cap1" },
    });
    expect(minted.runnerScopedToken).toBe("cloud-token");
    expect(minted.tokenType).toBe("Bearer");
    expect(minted.expiresInSeconds).toBe(14400);

    await client.getRunnerScopedToken({
      scope: { case: "workflowExecutionId", value: "wexec_cap1" },
    });
    const renewal = await client.getRunnerScopedToken({
      scope: { case: "renewal", value: {} },
    });
    // The implementation's not-minted degrade rides the presence-based
    // empty output — same wire shape as the OSS pool/renewal answer.
    expect(renewal.runnerScopedToken).toBe("");
    expect(renewal.tokenType).toBe("");
    expect(renewal.expiresInSeconds).toBe(0);

    expect(exchanged.map((e) => e.request)).toEqual([
      { arm: "agent-execution", executionId: "aexec_cap1" },
      { arm: "workflow-execution", executionId: "wexec_cap1" },
      { arm: "renewal" },
    ]);
    // The trusted-local identity the chain stamped is what crossed the
    // seam — the cloud implementation gates its arms on exactly this.
    for (const call of exchanged) {
      expect(call.callerIdentityId).not.toBe("");
      expect(call.callerClass).toBe("user");
    }
  });

  it("a refusal thrown by the implementation propagates as the gRPC error", async () => {
    try {
      await client.getRunnerScopedToken({
        scope: { case: "poolClaim", value: { sessionId: "ses_denied" } },
      });
      throw new Error("expected the call to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ConnectError);
      expect((error as ConnectError).code).toBe(Code.PermissionDenied);
      expect((error as ConnectError).rawMessage).toBe(
        "pool member holds no claim for session ses_denied",
      );
    }
  });

  it("merges bootstrap credentials into the coordinate response", async () => {
    bootstrapCallerIds = [];
    const config = await client.getRunnerBootstrapConfig({});
    expect(config.temporalAddress).toBe("127.0.0.1:7777");
    expect(config.runnerAccessToken).toBe("cloud-bootstrap-token");
    expect(config.tokenType).toBe("Bearer");
    expect(config.runnerAccessTokenExpiresInSeconds).toBe(900);
    expect(config.payloadEncryptionKeyId).toBe("rpk_test1");
    expect(config.payloadEncryptionKey).toBe("a2V5");
    expect(config.payloadEncryptionSecondaryKeyId).toBe("rpk_test0");
    expect(config.payloadEncryptionSecondaryKey).toBe("b2xk");
    expect(bootstrapCallerIds).toHaveLength(1);
  });

  it("a bootstrap-credentials failure degrades to coordinates-only, never an error", async () => {
    bootstrapThrows = true;
    try {
      const config = await client.getRunnerBootstrapConfig({});
      expect(config.temporalAddress).toBe("127.0.0.1:7777");
      expect(config.runnerAccessToken).toBe("");
      expect(config.tokenType).toBe("");
      expect(config.payloadEncryptionKey).toBe("");
    } finally {
      bootstrapThrows = false;
    }
  });
});
