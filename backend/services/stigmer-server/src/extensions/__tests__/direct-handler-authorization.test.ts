/**
 * Pins the C2 Stage-4 enforcement END TO END for the direct handlers whose
 * domain suites run through full composed servers (session updateSubject,
 * workflow getVersion, artifact delete/getDownloadUrl/getContent, and the
 * channel install pair added at the C2 close-out): one
 * composed server with a DENYING extension Authorizer, probed over the
 * wire. This proves the whole path — transport → registered handler →
 * authorizeDirect → the composed Authorizer — not just the handler
 * function, and each method's byte-pinned annotation copy doubles as the
 * descriptor-mismatch guard. Denials must also be side-effect free: the
 * denied writes leave the stored rows untouched.
 *
 * The streaming/connect lanes' enforcement is pinned in their domain
 * suites (workflowexecution/agentexecution read-authorization.test.ts,
 * mcpserver connect-authorization.test.ts); the decision mapping itself
 * in pipeline/steps/__tests__/authorize.test.ts.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, createClient } from "@connectrpc/connect";
import type { Transport } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AgentChannelSchema } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/api_pb";
import { AgentChannelCommandController } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/command_pb";
import { ArtifactSchema } from "@stigmer/protos/ai/stigmer/agentic/artifact/v1/api_pb";
import { ArtifactCommandController } from "@stigmer/protos/ai/stigmer/agentic/artifact/v1/command_pb";
import { ArtifactStorageState } from "@stigmer/protos/ai/stigmer/agentic/artifact/v1/enum_pb";
import { ArtifactQueryController } from "@stigmer/protos/ai/stigmer/agentic/artifact/v1/query_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { SessionCommandController } from "@stigmer/protos/ai/stigmer/agentic/session/v1/command_pb";
import { WorkflowQueryController } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/query_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { loadConfig } from "../../boot/config.js";
import { composeServer } from "../../boot/compose.js";
import type { ComposedServer } from "../../boot/compose.js";
import { createLogger } from "../../boot/logger.js";
import type { ServerExtension } from "../registry.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

describe("direct-handler authorization (composed server, denying authorizer)", () => {
  let server: ComposedServer;
  let dir: string;
  let transport: Transport;

  const denyEverything: ServerExtension = {
    name: "deny-everything",
    authorizer: {
      authorize: () => Promise.resolve({ kind: "deny", reason: "" }),
    },
  };

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "direct-authz-test-"));
    server = await composeServer({
      config: loadConfig({
        STIGMER_MODEL_REGISTRY_REFRESH: "off",
        TEMPORAL_HOST_PORT: "127.0.0.1:1",
        DB_PATH: path.join(dir, "stigmer.db"),
        STORAGE_PATH: path.join(dir, "storage"),
        ARTIFACT_LOCAL_BASE_PATH: path.join(dir, "artifacts"),
      }),
      logger: silentLogger,
      extensions: [denyEverything],
      portOverride: 0,
      host: "127.0.0.1",
    });
    const port = await server.start();
    transport = createGrpcTransport({ baseUrl: `http://127.0.0.1:${port}` });

    // Seed the load-first targets directly through the store — the write
    // path is not under test and the denying authorizer would refuse it.
    await server.store.saveResource(
      ApiResourceKind.session,
      "ses_01authztarget",
      SessionSchema,
      create(SessionSchema, {
        apiVersion: "agentic.stigmer.ai/v1",
        kind: "Session",
        metadata: { id: "ses_01authztarget", name: "target", org: "acme" },
        spec: { agentInstanceId: "ain_01x", subject: "original" },
      }),
    );
    await server.store.saveResource(
      ApiResourceKind.artifact,
      "art_01authztarget",
      ArtifactSchema,
      create(ArtifactSchema, {
        apiVersion: "agentic.stigmer.ai/v1",
        kind: "Artifact",
        metadata: { id: "art_01authztarget", name: "target", org: "acme" },
        status: {
          contentHash: "0".repeat(64),
          storageState: ArtifactStorageState.storage_state_stored,
        },
      }),
    );
    await server.store.saveResource(
      ApiResourceKind.agent_channel,
      "ach_01authztarget",
      AgentChannelSchema,
      create(AgentChannelSchema, {
        apiVersion: "agentic.stigmer.ai/v1",
        kind: "AgentChannel",
        metadata: { id: "ach_01authztarget", name: "target", org: "acme" },
      }),
    );
  });

  afterAll(async () => {
    await server.shutdown();
    rmSync(dir, { recursive: true, force: true });
  });

  async function expectDenied(run: () => Promise<unknown>, copy: string) {
    const error = await run().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConnectError);
    expect((error as ConnectError).code).toBe(Code.PermissionDenied);
    expect((error as ConnectError).rawMessage).toBe(copy);
  }

  it("session updateSubject denies with its annotation copy and leaves the row unchanged", async () => {
    const command = createClient(SessionCommandController, transport);
    await expectDenied(
      () =>
        command.updateSubject({ id: "ses_01authztarget", subject: "stolen" }),
      "unauthorized to update session subject",
    );
    const stored = await server.store.getResource(
      ApiResourceKind.session,
      "ses_01authztarget",
      SessionSchema,
    );
    expect(stored.spec?.subject).toBe("original");
  });

  it("session updateSubject on a MISSING id answers NotFound even under denial (load-first, #224)", async () => {
    const command = createClient(SessionCommandController, transport);
    const error = await command
      .updateSubject({ id: "ses_doesnotexist", subject: "anything" })
      .catch((e: unknown) => e);
    expect((error as ConnectError).code).toBe(Code.NotFound);
    expect((error as ConnectError).rawMessage).toBe(
      "session not found: ses_doesnotexist",
    );
  });

  it("workflow getVersion denies with its annotation copy (the ruled Java-gap divergence)", async () => {
    const query = createClient(WorkflowQueryController, transport);
    await expectDenied(
      () =>
        query.getVersion({
          workflowId: "wfl_01any",
          versionHash: "a".repeat(64),
        }),
      "unauthorized to get workflow version",
    );
  });

  it("artifact delete denies with its annotation copy and leaves the storage state unchanged", async () => {
    const command = createClient(ArtifactCommandController, transport);
    await expectDenied(
      () => command.delete({ value: "art_01authztarget" }),
      "unauthorized to delete artifact",
    );
    const stored = await server.store.getResource(
      ApiResourceKind.artifact,
      "art_01authztarget",
      ArtifactSchema,
    );
    expect(stored.status?.storageState).toBe(
      ArtifactStorageState.storage_state_stored,
    );
  });

  it("artifact getDownloadUrl and getContent deny with their annotation copies", async () => {
    const query = createClient(ArtifactQueryController, transport);
    await expectDenied(
      () => query.getDownloadUrl({ value: "art_01authztarget" }),
      "unauthorized to download artifact",
    );
    await expectDenied(
      () => query.getContent({ artifactId: "art_01authztarget" }),
      "unauthorized to read artifact content",
    );
  });

  it("channel initiateInstall and completeInstall deny with their annotation copy (C2 close-out — the arm both sides deferred)", async () => {
    const command = createClient(AgentChannelCommandController, transport);
    // PermissionDenied — NOT the storing edition's FailedPrecondition —
    // proves the authorization runs before the refuse-or-delegate split.
    await expectDenied(
      () => command.initiateInstall({ resourceId: "ach_01authztarget" }),
      "unauthorized to install agent channel",
    );
    await expectDenied(
      () =>
        command.completeInstall({
          resourceId: "ach_01authztarget",
          state: "some-state",
          code: "some-code",
        }),
      "unauthorized to install agent channel",
    );
  });

  it("channel install on a MISSING id answers NotFound even under denial (load-first)", async () => {
    const command = createClient(AgentChannelCommandController, transport);
    const error = await command
      .initiateInstall({ resourceId: "ach_doesnotexist" })
      .catch((e: unknown) => e);
    expect((error as ConnectError).code).toBe(Code.NotFound);
    expect((error as ConnectError).rawMessage).toBe(
      "AgentChannel not found: ach_doesnotexist",
    );
  });
});
