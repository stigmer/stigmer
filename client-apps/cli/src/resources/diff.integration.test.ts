// In-process integration test for `diff` against a workflow's remote state.

import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, type ConnectRouter } from "@connectrpc/connect";
import { connectNodeAdapter } from "@connectrpc/connect-node";
import { WorkflowSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import { WorkflowQueryController } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/query_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { createNodeClient, normalizeEndpoint } from "@stigmer/sdk/node";
import type { Stigmer } from "@stigmer/sdk";
import { createServer as createHttp2Server, type Http2Server, type ServerHttp2Session } from "node:http2";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { renderProtoYaml } from "../output/index.js";
import { diffDocument } from "./diff.js";

const knownWorkflow = create(WorkflowSchema, {
  apiVersion: "agentic.stigmer.ai/v1",
  kind: "Workflow",
  metadata: { name: "Deploy", slug: "deploy", org: "acme", id: "wfl_1" },
  spec: { description: "deploys things" },
});

let backend: Http2Server;
let client: Stigmer;
const openSessions = new Set<ServerHttp2Session>();

beforeAll(async () => {
  const routes = (router: ConnectRouter) => {
    router.service(WorkflowQueryController, {
      getByReference: (req) => {
        if (req.slug !== "deploy") throw new ConnectError("workflow not found", Code.NotFound);
        return knownWorkflow;
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
  client = createNodeClient({ baseUrl: normalizeEndpoint(`127.0.0.1:${port}`) });
});

afterAll(async () => {
  for (const session of openSessions) session.destroy();
  await new Promise<void>((resolve) => backend.close(() => resolve()));
});

describe("diffDocument (workflow)", () => {
  const doc = { kind: "Workflow", metadata: { slug: "deploy" } } as const;

  it("reports an unchanged document as 'same'", async () => {
    const remoteYaml = renderProtoYaml(WorkflowSchema, knownWorkflow);
    const result = await diffDocument(client, ApiResourceKind.workflow, remoteYaml, doc, "wf.yaml", "acme", 3);
    expect(result.status).toBe("same");
  });

  it("reports a changed document with a unified diff", async () => {
    const result = await diffDocument(
      client,
      ApiResourceKind.workflow,
      "kind: Workflow\nspec:\n  description: something else\n",
      doc,
      "wf.yaml",
      "acme",
      3,
    );
    expect(result.status).toBe("changed");
    if (result.status === "changed") {
      expect(result.text).toContain("@@");
      expect(result.text).toContain("remote/wf.yaml");
    }
  });

  it("reports a not-yet-deployed workflow as 'new'", async () => {
    const result = await diffDocument(
      client,
      ApiResourceKind.workflow,
      "kind: Workflow\nmetadata:\n  slug: missing\n",
      { kind: "Workflow", metadata: { slug: "missing" } },
      "wf.yaml",
      "acme",
      3,
    );
    expect(result.status).toBe("new");
  });

  it("treats non-workflow kinds as 'new' (diff not implemented)", async () => {
    const result = await diffDocument(
      client,
      ApiResourceKind.agent,
      "kind: Agent\n",
      { kind: "Agent", metadata: { slug: "x" } },
      "a.yaml",
      "acme",
      3,
    );
    expect(result.status).toBe("new");
  });
});
