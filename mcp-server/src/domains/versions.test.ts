// In-process integration test for the versioning tools: list_workflow_versions
// (timeline projection — validated_yaml stripped), get_workflow's version
// argument (slug→ID two-step into getVersion), tag_workflow_version, and
// list_skill_versions. Same harness as reads.integration.test.ts.

import { create, toJson } from "@bufbuild/protobuf";
import type { ConnectRouter } from "@connectrpc/connect";
import { connectNodeAdapter } from "@connectrpc/connect-node";
import {
  createServer as createHttp2Server,
  type Http2Server,
  type ServerHttp2Session,
} from "node:http2";
import type { AddressInfo } from "node:net";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { SkillQueryController } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/query_pb";
import {
  ListSkillVersionsResponseSchema,
  type ListSkillVersionsInput,
} from "@stigmer/protos/ai/stigmer/agentic/skill/v1/io_pb";
import { WorkflowSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import { WorkflowCommandController } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/command_pb";
import { WorkflowQueryController } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/query_pb";
import {
  ListWorkflowVersionsResponseSchema,
  WorkflowVersionEntrySchema,
  type GetWorkflowVersionInput,
  type TagWorkflowVersionInput,
} from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/version_pb";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { configureLogger } from "../logger";
import { createServer } from "../server";

configureLogger({ level: "error", format: "text" });

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

const knownWorkflow = create(WorkflowSchema, {
  apiVersion: "v1",
  kind: "workflow",
  metadata: { name: "Release", slug: "release", org: "acme", id: "wkf_1" },
});

const workflowVersions = create(ListWorkflowVersionsResponseSchema, {
  versions: [
    { versionHash: HASH_A, tag: "stable", isCurrent: true, validatedYaml: "document: {}" },
    { versionHash: HASH_B, validatedYaml: "document: {old: true}" },
  ],
  totalCount: 2,
});

const versionEntry = create(WorkflowVersionEntrySchema, {
  versionHash: HASH_B,
  validatedYaml: "document: {old: true}",
});

const skillVersions = create(ListSkillVersionsResponseSchema, {
  versions: [{ versionHash: HASH_A, tag: "stable", isCurrent: true }],
  totalCount: 1,
});

let backend: Http2Server;
let client: Client;
let lastGetVersion: GetWorkflowVersionInput | undefined;
let lastTagVersion: TagWorkflowVersionInput | undefined;
let lastSkillVersionsRequest: ListSkillVersionsInput | undefined;
const openSessions = new Set<ServerHttp2Session>();

interface ToolResult {
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
}

async function callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  return (await client.callTool({ name, arguments: args })) as ToolResult;
}

function parseText(result: ToolResult): Record<string, unknown> {
  return JSON.parse(result.content[0]?.text ?? "{}") as Record<string, unknown>;
}

beforeAll(async () => {
  const routes = (router: ConnectRouter) => {
    router.service(WorkflowQueryController, {
      getByReference: () => knownWorkflow,
      listVersions: () => workflowVersions,
      getVersion: (req) => {
        lastGetVersion = req;
        return versionEntry;
      },
    });
    router.service(WorkflowCommandController, {
      tagVersion: (req) => {
        lastTagVersion = req;
        return knownWorkflow;
      },
    });
    router.service(SkillQueryController, {
      listVersions: (req) => {
        lastSkillVersionsRequest = req;
        return skillVersions;
      },
    });
  };
  backend = createHttp2Server(connectNodeAdapter({ routes }));
  backend.on("session", (session) => {
    openSessions.add(session);
    session.on("close", () => openSessions.delete(session));
  });
  await new Promise<void>((resolve) => backend.listen(0, "127.0.0.1", resolve));
  const port = (backend.address() as AddressInfo).port;

  const mcp = createServer({ serverAddress: `127.0.0.1:${port}`, apiKey: "" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "versions-integration", version: "test" });
  await Promise.all([mcp.connect(serverTransport), client.connect(clientTransport)]);
});

beforeEach(() => {
  lastGetVersion = undefined;
  lastTagVersion = undefined;
  lastSkillVersionsRequest = undefined;
});

afterAll(async () => {
  await client?.close();
  for (const session of openSessions) session.destroy();
  await new Promise<void>((resolve) => backend.close(() => resolve()));
});

describe("versioning tools integration", () => {
  it("advertises the versioning tools", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(
      expect.arrayContaining([
        "list_workflow_versions",
        "tag_workflow_version",
        "list_skill_versions",
      ]),
    );
  });

  it("list_workflow_versions strips validated_yaml from the timeline", async () => {
    const result = await callTool("list_workflow_versions", { org: "acme", slug: "release" });
    expect(result.isError).toBeFalsy();

    const body = parseText(result);
    expect(body.total_count).toBe(2);
    const versions = body.versions as Array<Record<string, unknown>>;
    expect(versions).toHaveLength(2);
    expect(versions[0]).toMatchObject({ version_hash: HASH_A, tag: "stable", is_current: true });
    for (const entry of versions) {
      expect(entry.validated_yaml).toBeUndefined();
    }
  });

  it("get_workflow with a version resolves the id and fetches that version", async () => {
    const result = await callTool("get_workflow", {
      org: "acme",
      slug: "release",
      version: HASH_B,
    });
    expect(result.isError).toBeFalsy();
    expect(lastGetVersion?.workflowId).toBe("wkf_1");
    expect(lastGetVersion?.versionHash).toBe(HASH_B);
    // The version entry carries the YAML the timeline omits.
    expect(parseText(result)).toEqual(
      toJson(WorkflowVersionEntrySchema, versionEntry, { useProtoFieldName: true }),
    );
  });

  it("get_workflow without a version returns the live workflow", async () => {
    const result = await callTool("get_workflow", { org: "acme", slug: "release" });
    expect(result.isError).toBeFalsy();
    expect(lastGetVersion).toBeUndefined();
    expect(parseText(result)).toEqual(
      toJson(WorkflowSchema, knownWorkflow, { useProtoFieldName: true }),
    );
  });

  it("tag_workflow_version resolves the id and forwards hash and tag", async () => {
    const result = await callTool("tag_workflow_version", {
      org: "acme",
      slug: "release",
      version: HASH_B,
      tag: "stable",
    });
    expect(result.isError).toBeFalsy();
    expect(lastTagVersion?.workflowId).toBe("wkf_1");
    expect(lastTagVersion?.versionHash).toBe(HASH_B);
    expect(lastTagVersion?.tag).toBe("stable");
  });

  it("list_skill_versions forwards the reference and returns the timeline", async () => {
    const result = await callTool("list_skill_versions", {
      org: "acme",
      slug: "code-review",
      page_size: 10,
    });
    expect(result.isError).toBeFalsy();
    expect(lastSkillVersionsRequest?.org).toBe("acme");
    expect(lastSkillVersionsRequest?.slug).toBe("code-review");
    expect(lastSkillVersionsRequest?.pageSize).toBe(10);
    expect(parseText(result)).toEqual(
      toJson(ListSkillVersionsResponseSchema, skillVersions, { useProtoFieldName: true }),
    );
  });
});
