/**
 * Pins the agentinstance domain against Go's pkg/domain/agentinstance
 * tests — through the REAL stack: a composed server on an ephemeral port,
 * a native gRPC client, the full interceptor chain, and the DD-002
 * in-process parent-agent edge (instance create loads its agent through
 * the router transport).
 *
 * The load-bearing pins:
 *   - the defaultinstance factory names the instance from the agent's
 *     SLUG, never the display name (stigmer/stigmer#355), stamps both
 *     reserved labels, and binds spec.agent_id to metadata.id;
 *   - create rejects an unknown spec.agent_id with NotFound (oss#645);
 *   - update enforces the immutable spec.agent_id with the exact
 *     FAILED_PRECONDITION copy (oss#646); a same-id update passes;
 *   - the default-instance visibility guard (stigmer/stigmer#556) rejects
 *     on the LABEL branch and on the parent-POINTER branch (no label
 *     needed), while an orphan instance and an ordinary personal instance
 *     pass through.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, createClient } from "@connectrpc/connect";
import type { Client, Transport } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AgentCommandController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/command_pb";
import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/status_pb";
import { AgentInstanceCommandController } from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/command_pb";
import { AgentInstanceQueryController } from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/query_pb";
import { AgentInstanceSchema } from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/api_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { loadConfig } from "../../../boot/config.js";
import { composeServer } from "../../../boot/compose.js";
import type { ComposedServer } from "../../../boot/compose.js";
import { createLogger } from "../../../boot/logger.js";
import {
  DEFAULT_INSTANCE_LABEL,
  RESERVED_LABEL_TRUE,
  SYSTEM_MANAGED_LABEL,
} from "../../../pipeline/apiresource-labels.js";
import {
  buildDefaultInstanceRequest,
  defaultInstanceSlug,
} from "../defaultinstance.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

const API_VERSION = "agentic.stigmer.ai/v1";
const ORG = "acme";

const DEFAULT_INSTANCE_VISIBILITY_REFUSAL =
  "Default instances do not have their own visibility - access always " +
  "follows the parent blueprint. Change the blueprint's visibility instead.";

let dir: string;
let server: ComposedServer;
let transport: Transport;
let agentCommand: Client<typeof AgentCommandController>;
let command: Client<typeof AgentInstanceCommandController>;
let query: Client<typeof AgentInstanceQueryController>;

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "agentinstance-domain-test-"));
  server = composeServer({
    config: loadConfig({
      STIGMER_MODEL_REGISTRY_REFRESH: "off",
      DB_PATH: path.join(dir, "stigmer.db"),
      // Keep the artifact store inside the test dir — the default
      // resolves to ~/.stigmer, which tests must never touch.
      ARTIFACT_LOCAL_BASE_PATH: path.join(dir, "artifacts"),
    }),
    logger: silentLogger,
    portOverride: 0,
    host: "127.0.0.1",
  });
  const port = await server.start();
  transport = createGrpcTransport({ baseUrl: `http://127.0.0.1:${port}` });
  agentCommand = createClient(AgentCommandController, transport);
  command = createClient(AgentInstanceCommandController, transport);
  query = createClient(AgentInstanceQueryController, transport);
});

afterAll(async () => {
  await server.shutdown();
  rmSync(dir, { recursive: true, force: true });
});

async function createAgent(name: string) {
  return agentCommand.create({
    apiVersion: API_VERSION,
    kind: "Agent",
    metadata: { name, org: ORG },
    spec: {
      instructions: "You are a helpful agent used by the instance tests.",
    },
  });
}

function instanceInput(name: string, agentId: string, org: string = ORG) {
  return {
    apiVersion: API_VERSION,
    kind: "AgentInstance",
    metadata: { name, org },
    spec: { agentId },
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

describe("defaultinstance factory (the #355 pin)", () => {
  it("names the instance from the agent's SLUG, not the display name", () => {
    const metadata = create(ApiResourceMetadataSchema, {
      id: "agt_factory_test",
      name: "Fancy Display Name",
      slug: "real-slug",
      org: ORG,
    });

    const request = buildDefaultInstanceRequest(metadata);

    // The wrong-field mistake (metadata.name) held together only while
    // GenerateSlug(name + "-default") happened to re-derive the slug.
    expect(request.metadata?.name).toBe("real-slug-default");
    expect(defaultInstanceSlug("real-slug")).toBe("real-slug-default");
    expect(request.metadata?.org).toBe(ORG);
    // Both reserved marker labels are stamped.
    expect(request.metadata?.labels[DEFAULT_INSTANCE_LABEL]).toBe(
      RESERVED_LABEL_TRUE,
    );
    expect(request.metadata?.labels[SYSTEM_MANAGED_LABEL]).toBe(
      RESERVED_LABEL_TRUE,
    );
    // The parent binding comes from metadata.id.
    expect(request.spec?.agentId).toBe("agt_factory_test");
    // Default instances carry no visibility of their own.
    expect(request.metadata?.visibility).toBe(
      ApiResourceVisibility.api_resource_visibility_unspecified,
    );
  });
});

describe("agent instance create (parent edge, oss#645)", () => {
  it("rejects an unknown spec.agent_id with NotFound instead of persisting a dangling instance", async () => {
    const error = await grpcError(() =>
      command.create(instanceInput("Dangling Instance", "agt_does_not_exist")),
    );
    expect(error.code).toBe(Code.NotFound);
    expect(error.rawMessage).toBe("Agent not found: agt_does_not_exist");
  });
});

describe("agent instance update (immutable agent_id, oss#646)", () => {
  it("rejects a differing spec.agent_id with the exact FailedPrecondition copy", async () => {
    const agent = await createAgent("Update Guard Agent");
    const agentId = agent.metadata!.id;
    const instance = await command.create(
      instanceInput("Update Guard Instance", agentId),
    );

    const error = await grpcError(() =>
      command.update({
        apiVersion: API_VERSION,
        kind: "AgentInstance",
        metadata: {
          id: instance.metadata!.id,
          name: instance.metadata!.name,
          slug: instance.metadata!.slug,
          org: instance.metadata!.org,
        },
        spec: { agentId: "agt_a_different_agent" },
      }),
    );
    expect(error.code).toBe(Code.FailedPrecondition);
    expect(error.rawMessage).toBe(
      `spec.agent_id is immutable (instance instantiates agent ${agentId}) — create a new instance for a different agent`,
    );
  });

  it("passes an update that keeps the same agent_id", async () => {
    const agent = await createAgent("Update Pass Agent");
    const agentId = agent.metadata!.id;
    const instance = await command.create(
      instanceInput("Update Pass Instance", agentId),
    );

    const updated = await command.update({
      apiVersion: API_VERSION,
      kind: "AgentInstance",
      metadata: {
        id: instance.metadata!.id,
        name: instance.metadata!.name,
        slug: instance.metadata!.slug,
        org: instance.metadata!.org,
      },
      spec: { agentId, description: "updated by the domain test" },
    });
    expect(updated.spec?.description).toBe("updated by the domain test");
    expect(updated.status?.audit?.specAudit?.event).toBe("updated");
  });
});

describe("default-instance visibility guard (stigmer/stigmer#556)", () => {
  it("rejects via the LABEL branch on the agent's system-managed default instance", async () => {
    const agent = await createAgent("Label Branch Agent");
    const defaultInstanceId = agent.status!.defaultInstanceId;
    expect(defaultInstanceId).not.toBe("");

    // The auto-created default instance carries the reserved label and the
    // slug convention (the factory shape, persisted end-to-end).
    const defaultInstance = await query.get({ value: defaultInstanceId });
    expect(defaultInstance.metadata?.labels[DEFAULT_INSTANCE_LABEL]).toBe(
      RESERVED_LABEL_TRUE,
    );
    expect(defaultInstance.metadata?.slug).toBe(
      defaultInstanceSlug(agent.metadata!.slug),
    );

    const error = await grpcError(() =>
      command.updateVisibility({
        resourceId: defaultInstanceId,
        visibility: ApiResourceVisibility.visibility_org,
      }),
    );
    expect(error.code).toBe(Code.FailedPrecondition);
    expect(error.rawMessage).toBe(DEFAULT_INSTANCE_VISIBILITY_REFUSAL);
  });

  it("rejects via the parent-POINTER branch even without the label", async () => {
    const agent = await createAgent("Pointer Branch Agent");
    const agentId = agent.metadata!.id;
    const personal = await command.create(
      instanceInput("Pointer Branch Instance", agentId),
    );
    const personalId = personal.metadata!.id;
    expect(personal.metadata?.labels[DEFAULT_INSTANCE_LABEL]).toBeUndefined();

    // Repoint the parent's server-owned record at the unlabeled instance
    // — the pre-label legacy-row shape the pointer branch exists to cover.
    const stored = await server.store.getResource(
      ApiResourceKind.agent,
      agentId,
      AgentSchema,
    );
    if (stored.status === undefined) {
      stored.status = create(AgentStatusSchema, {});
    }
    stored.status.defaultInstanceId = personalId;
    await server.store.saveResource(
      ApiResourceKind.agent,
      agentId,
      AgentSchema,
      stored,
    );

    const error = await grpcError(() =>
      command.updateVisibility({
        resourceId: personalId,
        visibility: ApiResourceVisibility.visibility_org,
      }),
    );
    expect(error.code).toBe(Code.FailedPrecondition);
    expect(error.rawMessage).toBe(DEFAULT_INSTANCE_VISIBILITY_REFUSAL);
  });

  it("passes through for an orphan instance whose parent no longer exists", async () => {
    // Seeded directly: an orphan predating the delete cascade — nothing
    // marks it default, so the one operation it supports must work.
    const orphan = create(AgentInstanceSchema, {
      apiVersion: API_VERSION,
      kind: "AgentInstance",
      metadata: {
        id: "ain_orphan_test",
        name: "Orphan Instance",
        slug: "orphan-instance",
        org: ORG,
      },
      spec: { agentId: "agt_long_gone" },
    });
    await server.store.saveResource(
      ApiResourceKind.agent_instance,
      "ain_orphan_test",
      AgentInstanceSchema,
      orphan,
    );

    const updated = await command.updateVisibility({
      resourceId: "ain_orphan_test",
      visibility: ApiResourceVisibility.visibility_org,
    });
    expect(updated.metadata?.visibility).toBe(
      ApiResourceVisibility.visibility_org,
    );
  });

  it("passes through for an ordinary personal instance and persists the change", async () => {
    const agent = await createAgent("Non Default Agent");
    const personal = await command.create(
      instanceInput("Non Default Instance", agent.metadata!.id),
    );
    const personalId = personal.metadata!.id;

    const updated = await command.updateVisibility({
      resourceId: personalId,
      visibility: ApiResourceVisibility.visibility_org,
    });
    expect(updated.metadata?.visibility).toBe(
      ApiResourceVisibility.visibility_org,
    );

    const fetched = await query.get({ value: personalId });
    expect(fetched.metadata?.visibility).toBe(
      ApiResourceVisibility.visibility_org,
    );
  });
});
