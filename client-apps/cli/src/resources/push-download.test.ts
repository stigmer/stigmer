// In-process integration test for `push skill` and `download execution`.
//
// Stands up a Connect backend (skill push + execution query/artifact-URL) plus a
// plain HTTP server standing in for object storage, then drives the resource
// layer end to end: pushSkill zips a temp dir and uploads it (asserting the
// server receives a valid ZIP), and downloadExecutionArtifacts streams a
// presigned URL to disk (asserting partial-failure tolerance).

import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import { createServer as createHttp2Server, type Http2Server, type ServerHttp2Session } from "node:http2";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, type ConnectRouter } from "@connectrpc/connect";
import { connectNodeAdapter } from "@connectrpc/connect-node";
import { AgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { GetArtifactDownloadUrlResponseSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/io_pb";
import { AgentExecutionQueryController } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/query_pb";
import { SkillSchema } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/api_pb";
import { SkillCommandController } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/command_pb";
import { createNodeClient, normalizeEndpoint } from "@stigmer/sdk/node";
import type { Stigmer } from "@stigmer/sdk";
import { unzipSync } from "fflate";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { downloadExecutionArtifacts } from "./download.js";
import { pushSkill } from "./skill.js";

const SKILL_MD = ["---", "name: my-skill", "---", "# My Skill"].join("\n");
const ARTIFACT_BODY = "hello artifact contents";

let backend: Http2Server;
let storage: HttpServer;
let storageUrl: string;
let client: Stigmer;
const openSessions = new Set<ServerHttp2Session>();

let pushedArtifacts: Uint8Array[] = [];
let pushedTags: string[] = [];

beforeEach(() => {
  pushedArtifacts = [];
  pushedTags = [];
});

const execution = create(AgentExecutionSchema, {
  metadata: { id: "aex_done" },
  status: {
    phase: ExecutionPhase.EXECUTION_COMPLETED,
    artifacts: [
      { name: "report.txt", storageKey: "store/report.txt", sizeBytes: 23n },
      { name: "broken.txt", storageKey: "store/missing.txt", sizeBytes: 5n },
    ],
  },
});

beforeAll(async () => {
  // Object-storage stand-in: serves the good key, 404s anything else.
  storage = createHttpServer((req, res) => {
    if (req.url === "/store/report.txt") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end(ARTIFACT_BODY);
      return;
    }
    res.writeHead(404);
    res.end("not found");
  });
  await new Promise<void>((resolve) => storage.listen(0, "127.0.0.1", resolve));
  storageUrl = `http://127.0.0.1:${(storage.address() as AddressInfo).port}`;

  const routes = (router: ConnectRouter) => {
    router.service(SkillCommandController, {
      push: (req) => {
        pushedArtifacts.push(req.artifact);
        pushedTags.push(req.tag);
        return create(SkillSchema, {
          metadata: { id: "skl_1", slug: "my-skill", version: { id: "v2", previousVersionId: "v1" } },
          spec: { tag: req.tag },
          status: { versionHash: "abcdef1234567890" },
        });
      },
    });
    router.service(AgentExecutionQueryController, {
      get: (req) => {
        if (req.value !== "aex_done") throw new ConnectError("not found", Code.NotFound);
        return execution;
      },
      getArtifactDownloadUrl: (req) =>
        create(GetArtifactDownloadUrlResponseSchema, { downloadUrl: `${storageUrl}/${req.storageKey}` }),
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
  await new Promise<void>((resolve) => storage.close(() => resolve()));
});

describe("pushSkill", () => {
  it("zips a directory and uploads a valid artifact", async () => {
    const dir = mkdtempSync(join(tmpdir(), "push-it-"));
    try {
      writeFileSync(join(dir, "SKILL.md"), SKILL_MD);
      writeFileSync(join(dir, "tool.py"), "print('x')\n");
      writeFileSync(join(dir, ".env"), "SECRET=1\n"); // must be excluded

      const result = await pushSkill(client, dir, "acme", "v1.2.3", "first push", {
        respectGitignore: true,
        extraIgnore: [],
        extraInclude: [],
      });

      expect(result.skillName).toBe("my-skill");
      expect(result.slug).toBe("my-skill");
      expect(result.tag).toBe("v1.2.3");
      expect(result.versionChanged).toBe(true);
      expect(result.isNewResource).toBe(false);
      expect(pushedTags).toEqual(["v1.2.3"]);

      const entries = Object.keys(unzipSync(pushedArtifacts[0])).sort();
      expect(entries).toEqual(["SKILL.md", "tool.py"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("defaults an empty tag to 'latest'", async () => {
    const dir = mkdtempSync(join(tmpdir(), "push-it-"));
    try {
      writeFileSync(join(dir, "SKILL.md"), SKILL_MD);
      await pushSkill(client, dir, "acme", "", "", { respectGitignore: true, extraIgnore: [], extraInclude: [] });
      expect(pushedTags).toEqual(["latest"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("downloadExecutionArtifacts", () => {
  it("downloads available artifacts and tolerates partial failures", async () => {
    const out = mkdtempSync(join(tmpdir(), "dl-it-"));
    try {
      const outcome = await downloadExecutionArtifacts(client, "aex_done", { artifactName: "", outputDir: out });
      expect(outcome.total).toBe(2);
      expect(outcome.downloaded).toBe(1); // broken.txt 404s, report.txt succeeds
      expect(outcome.noArtifacts).toBe(false);
      expect(readFileSync(join(out, "report.txt"), "utf8")).toBe(ARTIFACT_BODY);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  it("filters to a named artifact", async () => {
    const out = mkdtempSync(join(tmpdir(), "dl-it-"));
    try {
      const outcome = await downloadExecutionArtifacts(client, "aex_done", { artifactName: "report.txt", outputDir: out });
      expect(outcome.total).toBe(1);
      expect(outcome.downloaded).toBe(1);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
});
