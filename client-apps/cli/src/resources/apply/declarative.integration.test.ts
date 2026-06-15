// In-process integration test for declarative apply.
//
// Stands up a Connect backend (agent + skill + project controllers) and drives
// applyDeclarative end to end against a temp project directory: a stigmer.yaml,
// one agent resource, and one skill directory. The assertions lock the
// membership contract — skills are pushed first, member-eligible resources are
// collected as references, and the project is applied with that exact member
// set so the server can reconcile.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createHttp2Server, type Http2Server, type ServerHttp2Session } from "node:http2";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { create } from "@bufbuild/protobuf";
import { type ConnectRouter, createClient } from "@connectrpc/connect";
import { connectNodeAdapter } from "@connectrpc/connect-node";
import { AgentCommandController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/command_pb";
import { SkillSchema } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/api_pb";
import { SkillCommandController } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/command_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { Project } from "@stigmer/protos/ai/stigmer/tenancy/project/v1/api_pb";
import { ProjectCommandController } from "@stigmer/protos/ai/stigmer/tenancy/project/v1/command_pb";
import { createNodeClient, createNodeTransport, normalizeEndpoint } from "@stigmer/sdk/node";
import type { Stigmer } from "@stigmer/sdk";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyDeclarative, detectTrack } from "./declarative.js";
import type { ControllerFn } from "./handlers.js";

let backend: Http2Server;
let stigmer: Stigmer;
let controllerFn: ControllerFn;
const openSessions = new Set<ServerHttp2Session>();

let appliedProject: Project | undefined;

beforeEach(() => {
  appliedProject = undefined;
});

function makeProject(dir: string): void {
  writeFileSync(
    join(dir, "stigmer.yaml"),
    ["kind: Project", "metadata:", "  name: Demo", "  slug: demo", "spec:", "  description: d", ""].join("\n"),
  );
  writeFileSync(
    join(dir, "agent.yaml"),
    ["kind: Agent", "metadata:", "  name: Reviewer", "  slug: reviewer", "spec:", "  description: r", ""].join("\n"),
  );
  mkdirSync(join(dir, "my-skill"));
  writeFileSync(join(dir, "my-skill", "SKILL.md"), ["---", "name: my-skill", "---", "# My Skill"].join("\n"));
}

beforeAll(async () => {
  const routes = (router: ConnectRouter) => {
    router.service(AgentCommandController, { apply: (req) => req });
    router.service(SkillCommandController, {
      push: (req) =>
        create(SkillSchema, {
          metadata: { id: "skl_1", slug: "my-skill", version: { id: "v1" } },
          spec: { tag: req.tag },
          status: { versionHash: "abc123" },
        }),
    });
    router.service(ProjectCommandController, {
      apply: (req) => {
        appliedProject = req;
        return req;
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
  const baseUrl = normalizeEndpoint(`127.0.0.1:${port}`);
  stigmer = createNodeClient({ baseUrl });
  const transport = createNodeTransport({ baseUrl });
  controllerFn = (service) => createClient(service, transport);
});

afterAll(async () => {
  for (const session of openSessions) session.destroy();
  await new Promise<void>((resolve) => backend.close(() => resolve()));
});

describe("applyDeclarative", () => {
  it("pushes skills, applies resources, and sets project membership", async () => {
    const dir = mkdtempSync(join(tmpdir(), "decl-it-"));
    try {
      makeProject(dir);
      const detect = detectTrack(dir);
      expect(detect.track).toBe("declarative");

      const result = await applyDeclarative(detect, {
        controller: controllerFn,
        stigmer,
        org: "acme",
        info: () => {},
        warn: () => {},
      });

      expect(result.status).toBe("success");

      // The project was applied with exactly two members: the pushed skill and
      // the applied agent (both member-eligible kinds), each carrying org+slug.
      expect(appliedProject).toBeDefined();
      const members = appliedProject?.spec?.members ?? [];
      expect(members).toHaveLength(2);

      const skill = members.find((m) => m.kind === ApiResourceKind.skill);
      const agent = members.find((m) => m.kind === ApiResourceKind.agent);
      expect(skill).toMatchObject({ org: "acme", slug: "my-skill" });
      expect(agent).toMatchObject({ org: "acme", slug: "reviewer" });

      // Org is injected into the project metadata when the YAML omitted it.
      expect(appliedProject?.metadata?.org).toBe("acme");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
