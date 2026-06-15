// Capstone end-to-end test — the test the Go feature could never have.
//
// A real TypeScript entry point that imports `@stigmer/sdk/synth` is executed by
// the REAL synthesize() (which spawns `npx tsx`), writing genuine `.pb` files;
// those are then read and reconciled against an in-process backend. This is the
// single test that exercises BOTH halves of the feature across the subprocess
// boundary — producer (SDK) and consumer (CLI) — proving they actually connect.
//
// The fixture is created inside this package so the spawned `tsx` resolves
// `@stigmer/sdk/synth` through the workspace node_modules via upward traversal
// (a tmp dir under the OS temp root could not resolve the workspace packages).
// Flakiness mitigations: a generous timeout (first `tsx` run transpiles the SDK)
// and `prepare` disabled (the fixture borrows the workspace node_modules rather
// than installing its own).

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createHttp2Server, type Http2Server, type ServerHttp2Session } from "node:http2";
import type { AddressInfo } from "node:net";
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
import type { Stigmer } from "@stigmer/sdk";
import { createNodeClient, createNodeTransport, normalizeEndpoint } from "@stigmer/sdk/node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { detectTrack } from "../declarative.js";
import type { ControllerFn } from "../handlers.js";
import { applyProjectTrack } from "./project-track.js";

let backend: Http2Server;
let stigmer: Stigmer;
let controllerFn: ControllerFn;
const openSessions = new Set<ServerHttp2Session>();
let appliedProject: Project | undefined;

// A real entry point exercising the public producer API end to end.
const ENTRY_SOURCE = `import { defineProject } from "@stigmer/sdk/synth";

const project = defineProject((ctx) => {
  ctx.skill.fromDir("my-skill");
  ctx.agent({ name: "Reviewer", slug: "reviewer", org: "acme", instructions: "review code" });
});

await project.synth();
`;

function makeFixture(dir: string): void {
  writeFileSync(
    join(dir, "stigmer.yaml"),
    ["kind: Project", "metadata:", "  name: Demo", "  slug: demo", "spec:", "  entry_point: index.ts", ""].join("\n"),
  );
  writeFileSync(join(dir, "index.ts"), ENTRY_SOURCE);
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

describe("capstone: real SDK synthesis → CLI reconcile", () => {
  it(
    "runs a real @stigmer/sdk/synth entry point through tsx and reconciles it",
    async () => {
      // Created inside the package so the spawned tsx resolves @stigmer/sdk.
      const dir = mkdtempSync(join(process.cwd(), "capstone-"));
      try {
        makeFixture(dir);
        const detect = detectTrack(dir);
        expect(detect.track).toBe("project");

        const result = await applyProjectTrack(detect, {
          controller: controllerFn,
          stigmer,
          org: "acme",
          info: () => {},
          warn: () => {},
          // Real spawn (default); only skip the node_modules readiness check —
          // the fixture borrows the workspace install via upward traversal.
          synthesizeDeps: { prepare: () => {} },
        });

        expect(result.status).toBe("success");
        const members = appliedProject?.spec?.members ?? [];
        const skill = members.find((m) => m.kind === ApiResourceKind.skill);
        const agent = members.find((m) => m.kind === ApiResourceKind.agent);
        expect(skill).toMatchObject({ org: "acme", slug: "my-skill" });
        expect(agent).toMatchObject({ org: "acme", slug: "reviewer" });
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    120_000,
  );
});
