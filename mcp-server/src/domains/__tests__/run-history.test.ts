// In-process test for the tools that find and read runs that already
// happened (list_runs, get_run_outputs, get_run_scores) and for the files
// run_agent hands a run from the person's project.
//
// Same harness as runs.test.ts: a real Connect backend serving stubbed
// controllers, MCP servers driven through in-memory clients. Three servers:
// one that shares the person's disk with a client that lists a project
// folder as its root, one that shares the disk with a client that declares
// no roots, and one that does not share the disk at all (the hosted and
// HTTP case). A temporary project on disk holds a sample file, a folder, a
// link to a file outside the project and the outside file itself.
//
// Pinned: list_runs resolves the agent and reads RunQueryController.listByAgent
// with the limit, each run in one line with its error's first line; the
// outputs are the newest per place, text inline with the cut said, other
// content named and never inlined, no link anywhere; scores carry their
// source and state and an empty list says nothing graded the run; files are
// uploaded into the agent's organization as the caller's own for a new
// conversation (the originals deleted once the run exists) and into the
// conversation for a follow-up; every refusal (no shared disk, no roots,
// outside every root, a link out, a folder, more than 20) starts nothing and
// uploads nothing; a run the backend refuses deletes what was uploaded; the
// HTTP handler drops the shared-disk flag whatever it is given. Every
// backend refusal names what it was reading, and the text rules (a type
// read from the extension when none is recorded, a cut that splits a
// character, bytes that are not UTF-8) are pinned on their own.

import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, type ConnectRouter } from "@connectrpc/connect";
import { connectNodeAdapter } from "@connectrpc/connect-node";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer as createHttp2Server, type Http2Server, type ServerHttp2Session } from "node:http2";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ListRootsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { AgentSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentQueryController } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/query_pb";
import { FileSchema, type File } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import { FileCommandController } from "@stigmer/apis/ai/stigmer/agentic/file/v1/command_pb";
import type { ListFilesRequest, UploadFileInput } from "@stigmer/apis/ai/stigmer/agentic/file/v1/io_pb";
import { FileQueryController } from "@stigmer/apis/ai/stigmer/agentic/file/v1/query_pb";
import { RunSchema, type Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunCommandController } from "@stigmer/apis/ai/stigmer/agentic/run/v1/command_pb";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import type { ListRunsByAgentRequest } from "@stigmer/apis/ai/stigmer/agentic/run/v1/io_pb";
import { RunQueryController } from "@stigmer/apis/ai/stigmer/agentic/run/v1/query_pb";
import { ScoreSchema, type Score } from "@stigmer/apis/ai/stigmer/agentic/score/v1/api_pb";
import { CriterionResult, ScoreSource, ScoreState } from "@stigmer/apis/ai/stigmer/agentic/score/v1/enum_pb";
import { ScoreQueryController } from "@stigmer/apis/ai/stigmer/agentic/score/v1/query_pb";
import { SessionSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import { SessionQueryController } from "@stigmer/apis/ai/stigmer/agentic/session/v1/query_pb";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { withoutLocalFiles } from "../../http-handler";
import { configureLogger } from "../../logger";
import { createServer } from "../../server";
import { READ } from "../toolmarks";
import { isTextType } from "../runs/history";
import { resolveLocalFiles, rootPath } from "../runs/local-files";
import { NO_LOCAL_FILES } from "../runs/run";

configureLogger({ level: "error", format: "text" });

const agent = create(AgentSchema, {
  metadata: { name: "Invoice Checker", slug: "invoice-checker", org: "org_acme", id: "agt_inv" },
});

function run(id: string, phase: RunPhase, error = "", sessionId = "ses_a"): Run {
  return create(RunSchema, {
    metadata: { id, org: "org_acme" },
    spec: { target: { case: "sessionId", value: sessionId } },
    status: { phase, error, startedAt: "2026-11-18T22:00:00Z", completedAt: "2026-11-18T22:01:00Z" },
  });
}

function output(id: string, path: string, mimeType: string, size: number): File {
  return create(FileSchema, {
    metadata: { id, org: "org_acme" },
    spec: { filename: path.split("/").pop() ?? path, mimeType },
    status: { runId: "run_new", outputPath: path, sizeBytes: BigInt(size) },
  });
}

const encoder = new TextEncoder();

/** The bytes getContent answers per File id, and whether each is cut. */
const contents = new Map<string, { data: Uint8Array; truncated: boolean }>([
  ["fil_report_new", { data: encoder.encode("# March\n\nThree invoices over budget."), truncated: false }],
  ["fil_long", { data: encoder.encode("row,amount\n1,2\n"), truncated: true }],
  ["fil_notes", { data: encoder.encode("notes"), truncated: false }],
  ["fil_latin1", { data: new Uint8Array([0x63, 0x61, 0x66, 0xe9]), truncated: false }],
  // "a€" cut after the euro sign's second byte: the cut drops the partial character.
  ["fil_cut", { data: new Uint8Array([0x61, 0xe2, 0x82]), truncated: true }],
  // Nothing but a continuation byte: no whole character to keep, so not text.
  ["fil_tail", { data: new Uint8Array([0x82]), truncated: true }],
]);

let backend: Http2Server;
const openSessions = new Set<ServerHttp2Session>();
let withRoots: Client;
let withoutRoots: Client;
let noDisk: Client;

let project: string;
let outside: string;

let listByAgentRequests: ListRunsByAgentRequest[];
let agentRuns: Run[];
let fileListRequests: ListFilesRequest[];
let runFiles: File[];
let scores: Score[];
let uploads: UploadFileInput[];
let deletes: string[];
let createdRun: Run | undefined;
let refuseCreate: boolean;

interface ToolResult {
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
}

async function call(client: Client, name: string, args: Record<string, unknown>): Promise<ToolResult> {
  return (await client.callTool({ name, arguments: args })) as ToolResult;
}

function body(result: ToolResult): Record<string, unknown> {
  expect(result.isError, result.content[0]?.text).toBeFalsy();
  return JSON.parse(result.content[0]?.text ?? "{}") as Record<string, unknown>;
}

async function connect(
  target: { localFiles?: true },
  roots: readonly string[] | undefined,
  port: number,
): Promise<Client> {
  const mcp = createServer({ serverAddress: `127.0.0.1:${port}`, apiKey: "", ...target });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client(
    { name: "run-history", version: "test" },
    roots === undefined ? {} : { capabilities: { roots: { listChanged: true } } },
  );
  if (roots !== undefined) {
    client.setRequestHandler(ListRootsRequestSchema, () => ({
      roots: roots.map((root) => ({ uri: pathToFileURL(root).href, name: "project" })),
    }));
  }
  await Promise.all([mcp.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

beforeAll(async () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "run-history-")));
  project = join(base, "project");
  outside = join(base, "outside");
  mkdirSync(join(project, "samples"), { recursive: true });
  mkdirSync(join(project, "data"), { recursive: true });
  mkdirSync(outside, { recursive: true });
  writeFileSync(join(project, "samples", "march.csv"), "invoice,amount\n1,100\n");
  writeFileSync(join(project, "data", "april.csv"), "invoice,amount\n2,200\n");
  writeFileSync(join(outside, "id_rsa"), "secret");
  symlinkSync(join(outside, "id_rsa"), join(project, "samples", "key-link"));

  const routes = (router: ConnectRouter) => {
    router.service(AgentQueryController, {
      getByReference: (req) => {
        if (req.slug === "flaky-agent") return create(AgentSchema, { metadata: { id: "agt_flaky", slug: "flaky-agent" } });
        if (req.slug !== "invoice-checker") throw new ConnectError(`agent ${req.slug} not found`, Code.NotFound);
        return agent;
      },
    });
    router.service(RunQueryController, {
      get: (req) => {
        if (req.value === "run_missing") throw new ConnectError("run not found", Code.NotFound);
        return run(req.value, RunPhase.RUN_COMPLETED);
      },
      listByAgent: (req) => {
        if (req.agentId === "agt_flaky") throw new ConnectError("runs hidden", Code.PermissionDenied);
        listByAgentRequests.push(req);
        return { entries: agentRuns, nextPageToken: "" };
      },
    });
    router.service(SessionQueryController, {
      get: () =>
        create(SessionSchema, {
          metadata: { id: "ses_a", org: "org_acme" },
          spec: { agentRef: { org: "org_acme", slug: "invoice-checker" } },
        }),
    });
    router.service(FileQueryController, {
      list: (req) => {
        if (req.runId === "run_nolist") throw new ConnectError("files hidden", Code.PermissionDenied);
        fileListRequests.push(req);
        return { entries: runFiles, nextPageToken: "" };
      },
      getContent: (req) => {
        const found = contents.get(req.id);
        if (found === undefined) throw new ConnectError("no content", Code.NotFound);
        return found;
      },
    });
    router.service(FileCommandController, {
      upload: (req) => {
        if (req.filename === "april.csv" && uploads.length > 0) throw new ConnectError("quota", Code.ResourceExhausted);
        uploads.push(req);
        return create(FileSchema, { metadata: { id: `fil_up_${uploads.length}`, org: req.org } });
      },
      delete: (req) => {
        deletes.push(req.value);
        return create(FileSchema, { metadata: { id: req.value } });
      },
    });
    router.service(ScoreQueryController, {
      listByRun: (req) => {
        if (req.runId === "run_noscores") throw new ConnectError("scores hidden", Code.PermissionDenied);
        return { entries: scores, nextPageToken: "" };
      },
    });
    router.service(RunCommandController, {
      create: (req) => {
        if (refuseCreate) throw new ConnectError("no engine", Code.Unavailable);
        createdRun = req;
        return run("run_new", RunPhase.RUN_PENDING);
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

  withRoots = await connect({ localFiles: true }, [project], port);
  withoutRoots = await connect({ localFiles: true }, undefined, port);
  noDisk = await connect({}, [project], port);
});

beforeEach(() => {
  listByAgentRequests = [];
  agentRuns = [];
  fileListRequests = [];
  runFiles = [];
  scores = [];
  uploads = [];
  deletes = [];
  createdRun = undefined;
  refuseCreate = false;
});

afterAll(async () => {
  for (const client of [withRoots, withoutRoots, noDisk]) await client?.close();
  for (const session of openSessions) session.destroy();
  await new Promise<void>((resolve) => backend.close(() => resolve()));
  rmSync(join(project, ".."), { recursive: true, force: true });
});

describe("list_runs", () => {
  it("is advertised with the read marks beside the outputs and scores reads", async () => {
    const { tools } = await withRoots.listTools();
    for (const name of ["list_runs", "get_run_outputs", "get_run_scores"]) {
      expect(tools.find((t) => t.name === name)?.annotations, name).toEqual(READ);
    }
  });

  it("resolves the agent and lists its runs newest first, each in one line with its error's first line", async () => {
    agentRuns = [
      run("run_3", RunPhase.RUN_FAILED, "Your credit balance is too low to access the Anthropic API.\nrequest id req_1", "ses_b"),
      run("run_2", RunPhase.RUN_COMPLETED),
    ];
    const listed = body(await call(withRoots, "list_runs", { org: "acme", agent: "invoice-checker", limit: 2 }));
    expect(listByAgentRequests.map((r) => [r.agentId, r.pageSize])).toEqual([["agt_inv", 2]]);
    expect(listed.runs).toEqual([
      {
        run_id: "run_3",
        session_id: "ses_b",
        phase: "failed",
        started_at: "2026-11-18T22:00:00Z",
        completed_at: "2026-11-18T22:01:00Z",
        error: "Your credit balance is too low to access the Anthropic API.",
      },
      {
        run_id: "run_2",
        session_id: "ses_a",
        phase: "completed",
        started_at: "2026-11-18T22:00:00Z",
        completed_at: "2026-11-18T22:01:00Z",
      },
    ]);
  });

  it("asks for ten runs by default and says when the agent has none", async () => {
    const listed = body(await call(withRoots, "list_runs", { agent: "invoice-checker" }));
    expect(listByAgentRequests[0]?.pageSize).toBe(10);
    expect(listed.runs).toEqual([]);
    expect(String(listed.note)).toContain("no runs");
  });

  it("reports an unknown agent as not found and lists nothing", async () => {
    const result = await call(withRoots, "list_runs", { org: "acme", agent: "nobody" });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("nobody");
    expect(listByAgentRequests).toEqual([]);
  });
});

describe("get_run_outputs", () => {
  it("reads the newest file per place, text inline with any cut said, other content named, and no link", async () => {
    runFiles = [
      output("fil_report_new", "reports/invoice-check.md", "text/markdown", 37),
      output("fil_report_old", "reports/invoice-check.md", "text/markdown", 12),
      output("fil_long", "data.csv", "text/csv", 900_000),
      output("fil_chart", "chart.png", "image/png", 2048),
    ];
    const result = await call(withRoots, "get_run_outputs", { run_id: "run_new" });
    const read = body(result);
    expect(fileListRequests.map((r) => [r.org, r.runId])).toEqual([["org_acme", "run_new"]]);
    expect(read.outputs).toEqual([
      {
        path: "reports/invoice-check.md",
        file_id: "fil_report_new",
        size_bytes: 37,
        mime_type: "text/markdown",
        content: "# March\n\nThree invoices over budget.",
      },
      expect.objectContaining({ path: "data.csv", content: "row,amount\n1,2\n", truncated: true }),
      expect.objectContaining({ path: "chart.png", mime_type: "image/png" }),
    ]);
    const chart = (read.outputs as Array<Record<string, unknown>>)[2];
    expect(chart?.content).toBeUndefined();
    expect(String(chart?.note)).toContain("stigmer download run run_new");
    expect(result.content[0]?.text).not.toMatch(/https?:\/\//);
  });

  it("reads one output by its path or filename, and names the outputs when the path matches none", async () => {
    runFiles = [output("fil_report_new", "reports/invoice-check.md", "text/markdown", 37)];
    const one = body(await call(withRoots, "get_run_outputs", { run_id: "run_new", path: "invoice-check.md" }));
    expect((one.outputs as unknown[]).length).toBe(1);

    const missing = await call(withRoots, "get_run_outputs", { run_id: "run_new", path: "summary.md" });
    expect(missing.isError).toBe(true);
    expect(missing.content[0]?.text).toContain("reports/invoice-check.md");
  });

  it("says a run that saved nothing saved nothing, and reports a run it cannot find", async () => {
    const none = body(await call(withRoots, "get_run_outputs", { run_id: "run_new" }));
    expect(none.outputs).toEqual([]);
    expect(String(none.note)).toContain("saved no files");

    const gone = await call(withRoots, "get_run_outputs", { run_id: "run_missing" });
    expect(gone.isError).toBe(true);
    expect(gone.content[0]?.text).toContain("run_missing");
  });
});

describe("the reads' refusals and text rules", () => {
  it("names what it was reading when the backend refuses", async () => {
    const runs = await call(withRoots, "list_runs", { agent: "flaky-agent" });
    expect(runs.isError).toBe(true);
    expect(runs.content[0]?.text).toContain("runs of agent");

    const files = await call(withRoots, "get_run_outputs", { run_id: "run_nolist" });
    expect(files.isError).toBe(true);
    expect(files.content[0]?.text).toContain("outputs of run");

    runFiles = [output("fil_gone", "gone.txt", "text/plain", 3)];
    const content = await call(withRoots, "get_run_outputs", { run_id: "run_new" });
    expect(content.isError).toBe(true);
    expect(content.content[0]?.text).toContain('output "gone.txt"');

    const graded = await call(withRoots, "get_run_scores", { run_id: "run_noscores" });
    expect(graded.isError).toBe(true);
    expect(graded.content[0]?.text).toContain("scores of run");
  });

  it.each(["get_run_outputs", "get_run_scores"])("%s refuses an empty run id without calling the backend", async (tool) => {
    const result = await call(withRoots, tool, { run_id: "" });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe("run_id is required");
  });

  it("reads text by its extension when no type is recorded, drops a cut character, and names bytes that are not UTF-8", async () => {
    runFiles = [
      output("fil_notes", "notes.md", "", 5),
      output("fil_blob", "blob.bin", "", 9),
      output("fil_latin1", "cafe.txt", "text/plain", 4),
      output("fil_cut", "euro.txt", "text/plain", 9),
      output("fil_tail", "tail.txt", "text/plain", 9),
    ];
    const read = body(await call(withRoots, "get_run_outputs", { run_id: "run_new" }));
    const byPath = new Map((read.outputs as Array<Record<string, unknown>>).map((o) => [o.path, o]));
    expect(byPath.get("notes.md")?.content).toBe("notes");
    expect(byPath.get("blob.bin")?.content).toBeUndefined();
    expect(String(byPath.get("cafe.txt")?.note)).toContain("Not valid UTF-8");
    expect(byPath.get("euro.txt")?.content).toBe("a");
    expect(String(byPath.get("tail.txt")?.note)).toContain("Not valid UTF-8");
  });

  it("knows text media types", () => {
    expect(isTextType("application/json; charset=utf-8", "x")).toBe(true);
    expect(isTextType("application/vnd.api+json", "x")).toBe(true);
    expect(isTextType("image/svg+xml", "x")).toBe(true);
    expect(isTextType("application/pdf", "report.md")).toBe(false);
  });
});

describe("get_run_scores", () => {
  it("reads each score with its source, state, verdict and criteria, and says no judge graded it", async () => {
    scores = [
      create(ScoreSchema, {
        spec: {
          runId: "run_new",
          metric: "run_health",
          source: ScoreSource.check,
          value: { case: "passed", value: true },
          criteria: [{ name: "finished", result: CriterionResult.passed }],
        },
        status: { state: ScoreState.graded },
      }),
    ];
    const read = body(await call(withRoots, "get_run_scores", { run_id: "run_new" }));
    expect(read.scores).toEqual([
      expect.objectContaining({
        metric: "run_health",
        source: "check (the platform's run-health check)",
        state: "graded",
        passed: true,
        criteria: [{ name: "finished", result: "passed" }],
      }),
    ]);
    expect(read.judge).toBe("No AI judge graded this run.");
  });

  it("names every state and criterion result, and keeps a judge's model and comment", async () => {
    const at = { seconds: 1_763_510_400n, nanos: 0 };
    scores = [
      create(ScoreSchema, {
        spec: {
          metric: "quality",
          source: ScoreSource.judge,
          judgeModel: "claude-opus-5-5",
          comment: "missed one invoice",
          criteria: [
            { name: "complete", result: CriterionResult.failed, reason: "INV-2318 not named" },
            { name: "tone", result: CriterionResult.not_applicable },
            { name: "other", result: CriterionResult.unspecified },
          ],
        },
        status: { state: ScoreState.not_graded, notGradedReason: "over the monthly limit", audit: { specAudit: { createdAt: at } } },
      }),
      create(ScoreSchema, { spec: { metric: "feedback", source: ScoreSource.human }, status: { state: ScoreState.pending } }),
      create(ScoreSchema, { spec: { metric: "x" }, status: { state: ScoreState.unspecified } }),
    ];
    const read = body(await call(withRoots, "get_run_scores", { run_id: "run_new" }));
    expect(read.scores).toEqual([
      {
        metric: "quality",
        source: "judge (an AI judge)",
        state: "not graded",
        not_graded_reason: "over the monthly limit",
        judge_model: "claude-opus-5-5",
        comment: "missed one invoice",
        criteria: [
          { name: "complete", result: "failed", reason: "INV-2318 not named" },
          { name: "tone", result: "not applicable" },
          { name: "other", result: "unspecified" },
        ],
        created_at: "2025-11-19T00:00:00.000Z",
      },
      expect.objectContaining({ source: "person", state: "pending" }),
      expect.objectContaining({ source: "unspecified", state: "unspecified" }),
    ]);
    expect(read.judge).toBeUndefined();
  });

  it("says plainly that a run nobody graded was not graded", async () => {
    const read = body(await call(withRoots, "get_run_scores", { run_id: "run_new" }));
    expect(read.scores).toEqual([]);
    expect(String(read.note)).toContain("not graded");
  });
});

describe("run_agent files", () => {
  it("uploads a project file as the caller's own into the agent's organization, names it on the run, and deletes the original once the run exists", async () => {
    const result = await call(withRoots, "run_agent", {
      org: "acme",
      agent: "invoice-checker",
      message: "check these",
      files: ["samples/march.csv"],
    });
    expect(result.isError, result.content[0]?.text).toBeFalsy();
    expect(uploads.map((u) => [u.org, u.sessionId, u.filename])).toEqual([["org_acme", "", "march.csv"]]);
    expect(uploads[0]?.source.case === "data" ? new TextDecoder().decode(uploads[0].source.value) : "").toBe(
      "invoice,amount\n1,100\n",
    );
    expect(createdRun?.spec?.fileIds).toEqual(["fil_up_1"]);
    expect(deletes).toEqual(["fil_up_1"]);
  });

  it("uploads into the conversation on a follow-up and keeps it there", async () => {
    const result = await call(withRoots, "run_agent", {
      org: "acme",
      agent: "invoice-checker",
      message: "and april",
      session_id: "ses_a",
      files: [join(project, "data", "april.csv")],
    });
    expect(result.isError, result.content[0]?.text).toBeFalsy();
    expect(uploads.map((u) => [u.org, u.sessionId, u.filename])).toEqual([["org_acme", "ses_a", "april.csv"]]);
    expect(createdRun?.spec?.fileIds).toEqual(["fil_up_1"]);
    expect(deletes).toEqual([]);
  });

  it("deletes what it uploaded when the backend refuses the run", async () => {
    refuseCreate = true;
    const result = await call(withRoots, "run_agent", {
      agent: "invoice-checker",
      message: "check",
      files: ["samples/march.csv"],
    });
    expect(result.isError).toBe(true);
    expect(deletes).toEqual(["fil_up_1"]);
  });

  it.each([
    ["a server that does not share the disk", "noDisk", ["samples/march.csv"], "does not share your disk"],
    ["a client that names no workspace folders", "withoutRoots", ["samples/march.csv"], "names no workspace folders"],
    ["a path outside every open folder", "withRoots", ["../outside/id_rsa"], "outside every folder"],
    ["an absolute path outside every open folder", "withRoots", ["OUTSIDE"], "outside every folder"],
    ["a link out of the project", "withRoots", ["samples/key-link"], "outside every folder"],
    ["a folder", "withRoots", ["samples"], "is a folder"],
    ["a path that is not there", "withRoots", ["samples/june.csv"], "was not found"],
  ])("refuses %s, uploading nothing and starting nothing", async (_case, which, files, message) => {
    const client = which === "noDisk" ? noDisk : which === "withoutRoots" ? withoutRoots : withRoots;
    const named = files.map((f) => (f === "OUTSIDE" ? join(outside, "id_rsa") : f));
    const result = await call(client, "run_agent", { agent: "invoice-checker", message: "check", files: named });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain(message);
    expect(uploads).toEqual([]);
    expect(createdRun).toBeUndefined();
  });

  it("refuses more than 20 files before anything starts", async () => {
    const files = Array.from({ length: 21 }, () => "samples/march.csv");
    const result = await call(withRoots, "run_agent", { agent: "invoice-checker", message: "check", files });
    expect(result.isError).toBe(true);
    expect(uploads).toEqual([]);
    expect(createdRun).toBeUndefined();
  });

  it("deletes the files already uploaded when a later upload fails, and starts nothing", async () => {
    const result = await call(withRoots, "run_agent", {
      agent: "invoice-checker",
      message: "check",
      files: ["samples/march.csv", "data/april.csv"],
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('failed to upload "');
    expect(deletes).toEqual(["fil_up_1"]);
    expect(createdRun).toBeUndefined();
  });

  it("resolveLocalFiles refuses an empty entry, more than 20 files and what is not a regular file", async () => {
    const access = { localFiles: true, listRoots: () => Promise.resolve([project, join(project, "gone")]) };
    await expect(resolveLocalFiles([" "], access)).rejects.toThrow("an entry is empty");
    await expect(resolveLocalFiles(Array.from({ length: 21 }, () => "samples/march.csv"), access)).rejects.toThrow(
      "at most 20 files; 21 were named",
    );
    execFileSync("mkfifo", [join(project, "samples", "pipe")]);
    await expect(resolveLocalFiles(["samples/pipe"], access)).rejects.toThrow("is not a regular file");
    expect(await resolveLocalFiles([], access)).toEqual([]);
  });

  it("reads only file:// roots, and shares no disk by default", async () => {
    expect(rootPath("https://example.com/project")).toBeUndefined();
    expect(rootPath("file://elsewhere/project")).toBeUndefined();
    expect(rootPath(pathToFileURL(project).href)).toBe(project);
    expect(NO_LOCAL_FILES.localFiles).toBe(false);
    expect(await NO_LOCAL_FILES.listRoots()).toBeUndefined();
  });

  it("the HTTP handler drops the shared-disk flag whatever it is given", () => {
    const target = { serverAddress: "x", apiKey: "", localFiles: true as const };
    expect(withoutLocalFiles(target)).toEqual({ serverAddress: "x", apiKey: "" });
  });
});
