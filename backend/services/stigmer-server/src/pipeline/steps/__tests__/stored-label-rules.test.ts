/**
 * Pins what an update does to a row stored before the label and tag rules,
 * over the served chains (gRPC, the edge validator included).
 *
 * A row may hold labels and tags the rules now refuse: the edge validates
 * requests, never stored rows, and nothing rewrites a stored row when a
 * rule tightens. An update whose
 * mask leaves labels and tags out keeps them as stored and succeeds; an
 * update that sends a value the rules refuse is refused. Two kinds on two
 * chains: an agent (spec.instructions) and an organization
 * (spec.description). The step's own cases are pinned beside ValidateProto
 * (pipeline/__tests__/steps.test.ts).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { clone } from "@bufbuild/protobuf";
import { Code, ConnectError, createClient } from "@connectrpc/connect";
import type { Client, Transport } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AgentCommandController } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/command_pb";
import { AgentSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { OrganizationCommandController } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/command_pb";
import { OrganizationSchema } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/api_pb";

import { loadConfig } from "../../../boot/config.js";
import { composeServer } from "../../../boot/compose.js";
import type { ComposedServer } from "../../../boot/compose.js";
import { createLogger } from "../../../boot/logger.js";
import { organizationId, seedOrganizations } from "../../../domain/organization/__tests__/support.js";

const silentLogger = createLogger({ level: "error", pretty: false, write: () => {} });

/** Values the rules refuse: a key with a space, a tag with a capital. */
const BREAKING_LABELS = { "team name": "support" };
const BREAKING_TAGS = ["Prod"];

let dir: string;
let server: ComposedServer;
let agents: Client<typeof AgentCommandController>;
let organizations: Client<typeof OrganizationCommandController>;
let orgId: string;

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "stored-label-rules-"));
  server = await composeServer({
    config: loadConfig({
      STIGMER_MODEL_REGISTRY_REFRESH: "off",
      TEMPORAL_HOST_PORT: "127.0.0.1:1",
      DB_PATH: path.join(dir, "stigmer.db"),
      STORAGE_PATH: path.join(dir, "storage"),
      ARTIFACT_LOCAL_BASE_PATH: path.join(dir, "artifacts"),
    }),
    logger: silentLogger,
    portOverride: 0,
    host: "127.0.0.1",
  });
  const port = await server.start();
  const transport: Transport = createGrpcTransport({ baseUrl: `http://127.0.0.1:${port}` });
  agents = createClient(AgentCommandController, transport);
  organizations = createClient(OrganizationCommandController, transport);
  orgId = organizationId(await seedOrganizations(transport, ["acme"]), "acme");
});

afterAll(async () => {
  await server.shutdown();
  rmSync(dir, { recursive: true, force: true });
});

async function refusal(work: Promise<unknown>): Promise<ConnectError> {
  const error = await work.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ConnectError);
  return error as ConnectError;
}

/** An agent whose stored row holds labels and tags the rules refuse. */
async function agentStoredWithBreakingLabels() {
  const created = await agents.create({
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "Agent",
    metadata: { name: `Reviewer ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, org: "acme" },
    spec: { instructions: "Review every pull request." },
  });
  const id = created.metadata!.id;
  const stored = await server.store.getResource(ApiResourceKind.agent, id, AgentSchema);
  stored.metadata!.labels = { ...BREAKING_LABELS };
  stored.metadata!.tags = [...BREAKING_TAGS];
  await server.store.saveResource(ApiResourceKind.agent, id, AgentSchema, stored);
  return id;
}

describe("an update of a row stored with labels and tags the rules refuse", () => {
  it("an agent update masked to its instructions keeps them and succeeds", async () => {
    const id = await agentStoredWithBreakingLabels();
    const edit = clone(AgentSchema, await server.store.getResource(ApiResourceKind.agent, id, AgentSchema));
    edit.metadata!.labels = {};
    edit.metadata!.tags = [];
    edit.metadata!.etag = "";
    edit.spec!.instructions = "Review every pull request, and say why.";

    const updated = await agents.update({ resource: edit, updateMask: { paths: ["spec.instructions"] } });

    expect(updated.spec?.instructions).toBe("Review every pull request, and say why.");
    const stored = await server.store.getResource(ApiResourceKind.agent, id, AgentSchema);
    expect(stored.metadata?.labels).toEqual(BREAKING_LABELS);
    expect(stored.metadata?.tags).toEqual(BREAKING_TAGS);
  });

  it("an agent update that sends a label the rules refuse is refused", async () => {
    const id = await agentStoredWithBreakingLabels();
    const edit = clone(AgentSchema, await server.store.getResource(ApiResourceKind.agent, id, AgentSchema));
    edit.metadata!.labels = { "another bad": "x" };
    edit.metadata!.tags = [];
    edit.metadata!.etag = "";

    const error = await refusal(agents.update({ resource: edit, updateMask: { paths: ["metadata.labels"] } }));
    expect(error.code).toBe(Code.InvalidArgument);
  });

  it("an organization update masked to its description keeps them and succeeds", async () => {
    const stored = await server.store.getResource(ApiResourceKind.organization, orgId, OrganizationSchema);
    stored.metadata!.labels = { ...BREAKING_LABELS };
    stored.metadata!.tags = [...BREAKING_TAGS];
    await server.store.saveResource(ApiResourceKind.organization, orgId, OrganizationSchema, stored);

    const edit = clone(OrganizationSchema, stored);
    edit.metadata!.labels = {};
    edit.metadata!.tags = [];
    edit.metadata!.etag = "";
    edit.spec!.description = "The organization that reviews.";

    const updated = await organizations.update({
      resource: edit,
      updateMask: { paths: ["spec.description"] },
    });

    expect(updated.spec?.description).toBe("The organization that reviews.");
    const after = await server.store.getResource(ApiResourceKind.organization, orgId, OrganizationSchema);
    expect(after.metadata?.labels).toEqual(BREAKING_LABELS);
    expect(after.metadata?.tags).toEqual(BREAKING_TAGS);
  });
});
