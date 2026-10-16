// Pins the CLI's generic verbs on an eval, against a real Connect backend
// over h2c: `stigmer get eval <org>/<slug>` reads the current version
// through the eval client's reference read; `stigmer list evals` lists the
// organization's evals through their list RPC, as JSON and as a table whose
// row names the eval, its case count, its tag and its level (an eval with
// no status counts no cases); `stigmer delete eval` warns that every version
// goes with it, and deletes it by its id.

import { create, toJson } from "@bufbuild/protobuf";
import { Code, ConnectError, type ConnectRouter } from "@connectrpc/connect";
import { connectNodeAdapter } from "@connectrpc/connect-node";
import { EvalSchema } from "@stigmer/apis/ai/stigmer/agentic/eval/v1/api_pb";
import { EvalCommandController } from "@stigmer/apis/ai/stigmer/agentic/eval/v1/command_pb";
import { EvalQueryController } from "@stigmer/apis/ai/stigmer/agentic/eval/v1/query_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/apis/ai/stigmer/commons/apiresource/enum_pb";
import { PlatformQueryController } from "@stigmer/apis/ai/stigmer/platform/v1/server_info_pb";
import { OrganizationSchema } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/api_pb";
import { OrganizationQueryController } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/query_pb";
import type { Stigmer } from "@stigmer/client";
import { createNodeClient, normalizeEndpoint } from "@stigmer/client/node";
import { createServer as createHttp2Server, type Http2Server, type ServerHttp2Session } from "node:http2";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { planDelete } from "../delete.js";
import { fetchResource } from "../get.js";
import { listResources } from "../list.js";

const ACME_ID = "org_01jaaaaaaaaaaaaaaaaaaaaaaa";

const acme = create(OrganizationSchema, {
  apiVersion: "tenancy.stigmer.ai/v1",
  kind: "Organization",
  metadata: { name: "Acme", slug: "acme", org: ACME_ID, id: ACME_ID },
});

const supportEval = create(EvalSchema, {
  apiVersion: "agentic.stigmer.ai/v1",
  kind: "Eval",
  metadata: { name: "support", slug: "support", org: ACME_ID, id: "evs_1", visibility: ApiResourceVisibility.visibility_org },
  spec: { tag: "stable" },
  status: { digest: "a".repeat(64), caseCount: 9 },
});

// Pushed by a server that wrote no status: the table counts no cases.
const bareEval = create(EvalSchema, {
  apiVersion: "agentic.stigmer.ai/v1",
  kind: "Eval",
  metadata: { name: "bare", slug: "bare", org: ACME_ID, id: "evs_2" },
});

let backend: Http2Server;
let client: Stigmer;
const deleted: string[] = [];
const openSessions = new Set<ServerHttp2Session>();

beforeAll(async () => {
  const routes = (router: ConnectRouter) => {
    router.service(EvalQueryController, {
      get: (req) => {
        if (req.value !== "evs_1") throw new ConnectError("eval not found", Code.NotFound);
        return supportEval;
      },
      getByReference: (req) => {
        if (req.slug !== "support") throw new ConnectError("eval not found", Code.NotFound);
        return supportEval;
      },
      list: (req) => {
        if (req.org !== "acme") throw new ConnectError("org is required", Code.InvalidArgument);
        return { entries: [supportEval, bareEval] };
      },
    });
    router.service(EvalCommandController, {
      delete: (req) => {
        deleted.push(req.value);
        return supportEval;
      },
    });
    router.service(OrganizationQueryController, {
      listMine: () => ({ entries: [acme] }),
      get: (req) => {
        if (req.value === ACME_ID || req.value === "acme") return acme;
        throw new ConnectError("organization not found", Code.NotFound);
      },
    });
    router.service(PlatformQueryController, {
      getServerInfo: () => ({ singleOrg: false }),
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

describe("the eval verbs", () => {
  it("gets an eval's current version by its organization and slug", async () => {
    const { schema, message } = await fetchResource(client, ApiResourceKind.eval, { kind: "ref", org: "acme", slug: "support" });
    expect(toJson(schema, message)).toEqual(toJson(EvalSchema, supportEval));
  });

  it("lists the organization's evals as JSON", async () => {
    const out = await listResources(client, ApiResourceKind.eval, "acme", 50, "json");
    expect(JSON.parse(out)).toEqual([
      toJson(EvalSchema, supportEval, { useProtoFieldName: true }),
      toJson(EvalSchema, bareEval, { useProtoFieldName: true }),
    ]);
  });

  it("lists them as a table of name, cases, tag and level", async () => {
    const out = await listResources(client, ApiResourceKind.eval, "acme", 50, "table");
    expect(out).toMatch(/NAME\s+CASES\s+TAG\s+VISIBILITY\s+CREATED/);
    expect(out).toMatch(/acme\/support\s+9\s+stable\s+visibility_org/);
    expect(out).toMatch(/acme\/bare\s+0\s/);
  });

  it("warns that a delete takes every version, then deletes the eval by its id", async () => {
    const plan = await planDelete(client, "eval", "support", "acme");
    expect(plan.warning.hints).toContain("This will delete the eval and all its versions.");
    await plan.perform();
    expect(deleted).toEqual(["evs_1"]);
  });
});
