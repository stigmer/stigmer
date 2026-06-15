// In-process integration test for the synthesis (project) track.
//
// Stands up a Connect backend (agent + skill + project controllers) and drives
// applyProjectTrack end to end against a temp project directory whose
// entry_point is "synthesized" by an injected spawn that writes `.pb` fixtures
// into STIGMER_OUT_DIR (the same contract the real SDK writer produces). This
// proves the consumer half — synthesize → read → shared reconciler — without a
// real subprocess; the capstone test exercises the real `tsx` run.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createHttp2Server, type Http2Server, type ServerHttp2Session } from "node:http2";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { create, toBinary } from "@bufbuild/protobuf";
import { type ConnectRouter, createClient } from "@connectrpc/connect";
import { connectNodeAdapter } from "@connectrpc/connect-node";
import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentCommandController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/command_pb";
import { SkillSchema } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/api_pb";
import { SkillCommandController } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/command_pb";
import { LocalDirSchema, SkillSynthSchema } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/synth_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { Project } from "@stigmer/protos/ai/stigmer/tenancy/project/v1/api_pb";
import { ProjectCommandController } from "@stigmer/protos/ai/stigmer/tenancy/project/v1/command_pb";
import type { Stigmer } from "@stigmer/sdk";
import { createNodeClient, createNodeTransport, normalizeEndpoint } from "@stigmer/sdk/node";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { detectTrack } from "../declarative.js";
import type { ControllerFn } from "../handlers.js";
import type { SpawnFn } from "./synthesize.js";
import { applyProjectTrack, previewProjectTrack } from "./project-track.js";

let backend: Http2Server;
let stigmer: Stigmer;
let controllerFn: ControllerFn;
const openSessions = new Set<ServerHttp2Session>();

let appliedProject: Project | undefined;

beforeEach(() => {
  appliedProject = undefined;
});

// A stigmer.yaml with entry_point makes detectTrack pick the project track; the
// my-skill dir is the target of the synthesized local SkillSynth.
function makeProject(dir: string): void {
  writeFileSync(
    join(dir, "stigmer.yaml"),
    [
      "kind: Project",
      "metadata:",
      "  name: Demo",
      "  slug: demo",
      "spec:",
      "  entry_point: index.ts",
      "",
    ].join("\n"),
  );
  writeFileSync(join(dir, "index.ts"), "// synthesized by the injected spawn in this test\n");
  mkdirSync(join(dir, "my-skill"));
  writeFileSync(join(dir, "my-skill", "SKILL.md"), ["---", "name: my-skill", "---", "# My Skill"].join("\n"));
}

// Injected spawn standing in for `npx tsx index.ts`: writes the .pb files the
// SDK writer would produce into STIGMER_OUT_DIR.
const fakeSpawn: SpawnFn = async (_command, _args, options) => {
  const outDir = options.env.STIGMER_OUT_DIR ?? "";
  writeFileSync(
    join(outDir, "agent-0.pb"),
    toBinary(
      AgentSchema,
      create(AgentSchema, {
        apiVersion: "agentic.stigmer.ai/v1",
        kind: "Agent",
        metadata: { name: "Reviewer", slug: "reviewer" },
        spec: { description: "r" },
      }),
    ),
  );
  writeFileSync(
    join(outDir, "skill-0.pb"),
    toBinary(
      SkillSynthSchema,
      create(SkillSynthSchema, {
        source: { case: "local", value: create(LocalDirSchema, { path: "my-skill" }) },
        tag: "latest",
      }),
    ),
  );
  return { exitCode: 0, stdout: "", stderr: "" };
};

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

describe("applyProjectTrack", () => {
  it("synthesizes, reads, and reconciles project membership", async () => {
    const dir = mkdtempSync(join(tmpdir(), "synth-it-"));
    try {
      makeProject(dir);
      const detect = detectTrack(dir);
      expect(detect.track).toBe("project");

      const result = await applyProjectTrack(detect, {
        controller: controllerFn,
        stigmer,
        org: "acme",
        info: () => {},
        warn: () => {},
        synthesizeDeps: { spawn: fakeSpawn, prepare: () => {} },
      });

      expect(result.status).toBe("success");

      expect(appliedProject).toBeDefined();
      const members = appliedProject?.spec?.members ?? [];
      expect(members).toHaveLength(2);

      const skill = members.find((m) => m.kind === ApiResourceKind.skill);
      const agent = members.find((m) => m.kind === ApiResourceKind.agent);
      expect(skill).toMatchObject({ org: "acme", slug: "my-skill" });
      expect(agent).toMatchObject({ org: "acme", slug: "reviewer" });

      expect(appliedProject?.metadata?.org).toBe("acme");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("dry-run previews the configuration without synthesizing or applying", () => {
    const dir = mkdtempSync(join(tmpdir(), "synth-dry-"));
    try {
      makeProject(dir);
      const detect = detectTrack(dir);

      const result = previewProjectTrack(detect);

      expect(result.status).toBe("success");
      expect(appliedProject).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("dry-run warns when the entry point file is missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "synth-dry-missing-"));
    try {
      makeProject(dir);
      rmSync(join(dir, "index.ts"));
      const detect = detectTrack(dir);

      const result = previewProjectTrack(detect);
      const text = JSON.stringify(result);
      expect(text).toContain("Entry point file not found");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
