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

import { Code, ConnectError, createClient, createRouterTransport } from "@connectrpc/connect";
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
import { RunnerAuthService } from "../../../runnerauth/runnerauth.js";
import { registerPlatformServices } from "../controller.js";

const silentLogger = createLogger({ level: "error", pretty: false, write: () => {} });

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
        runnerAuthService: RunnerAuthService.create(undefined),
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
