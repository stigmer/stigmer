// In-process test for `push skill`, `download run`, `download session` and
// `download file`.
//
// Stands up a Connect backend (skill push, run get, and the run's Files with
// their download links) plus a plain HTTP server standing in for object
// storage, then drives the resource layer end to end: pushSkill zips a temp
// dir and uploads it (asserting the server receives a valid ZIP), and
// downloadRunOutputs lists the Files the run returned and streams each
// link to disk at its place in the outputs folder (asserting partial-failure
// tolerance, a nested folder path, and refused paths that would climb out
// of the directory or name an absolute place), warns that a run still in
// progress may not have every output yet, and refuses a named output the run
// does not hold with a pointer to `get run`. downloadSessionOutputs lists the conversation's
// Files in its own organization and writes only what its turns saved, one
// File per place with the newest turn's winning, never a File given to the
// conversation; downloadFile writes one File under its filename, and reports
// a File whose bytes cannot be fetched as not downloaded. The download
// handlers for a session and a File refuse a reference that is not an id
// (and a File refuses --path) before any call, and write through the
// same functions.

import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import { createServer as createHttp2Server, type Http2Server, type ServerHttp2Session } from "node:http2";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, type ConnectRouter } from "@connectrpc/connect";
import { connectNodeAdapter } from "@connectrpc/connect-node";
import { type File, FileSchema } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import { FileDownloadUrlSchema, FileListSchema } from "@stigmer/apis/ai/stigmer/agentic/file/v1/io_pb";
import { FileQueryController } from "@stigmer/apis/ai/stigmer/agentic/file/v1/query_pb";
import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { RunQueryController } from "@stigmer/apis/ai/stigmer/agentic/run/v1/query_pb";
import { SessionSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import { SessionQueryController } from "@stigmer/apis/ai/stigmer/agentic/session/v1/query_pb";
import { SkillSchema } from "@stigmer/apis/ai/stigmer/agentic/skill/v1/api_pb";
import { SkillCommandController } from "@stigmer/apis/ai/stigmer/agentic/skill/v1/command_pb";
import { createNodeClient, normalizeEndpoint } from "@stigmer/client/node";
import type { Stigmer } from "@stigmer/client";
import { unzipSync } from "fflate";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CliExitError, ExitCode } from "../../errors/index.js";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { UsageError } from "../../errors/index.js";
import { DOWNLOAD_HANDLERS, downloadFile, downloadRunOutputs, downloadSessionOutputs } from "../download.js";
import { pushSkill } from "../skill.js";

const SKILL_MD = ["---", "name: my-skill", "---", "# My Skill"].join("\n");
const OUTPUT_BODY = "hello output contents";
const REPORT_BODY = "# Q3\n";

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

/** A File the run saved at `outputPath` in its outputs folder; `id` names its stored bytes. */
function output(id: string, runId: string, outputPath: string, sizeBytes: bigint): File {
  return create(FileSchema, {
    metadata: { id, org: "acme" },
    spec: { filename: outputPath.split("/").pop() ?? outputPath },
    status: { runId, outputPath, sizeBytes },
  });
}

// Newest first, as the server lists them.
const runFiles: readonly File[] = [
  output("file_report", "aex_done", "report.txt", 23n),
  output("file_missing", "aex_done", "broken.txt", 5n),
  output("file_q3", "aex_nested", "reports/q3.md", 5n),
  output("file_escape", "aex_escape", "../evil.txt", 5n),
  output("file_absolute", "aex_absolute", "/evil.txt", 5n),
];

// One conversation's Files in its own organization (not the context's),
// newest first: a later turn's report.txt, an upload, an earlier turn's
// report.txt and its notes.
const SESSION_ORG = "org_conversation";
function sessionFile(id: string, runId: string, outputPath: string, filename = outputPath): File {
  return create(FileSchema, {
    metadata: { id, org: SESSION_ORG },
    spec: { filename },
    status: { sessionId: "ses_conv", runId, outputPath, sizeBytes: 5n },
  });
}
const sessionFiles: readonly File[] = [
  sessionFile("file_report_v2", "run_2", "report.txt"),
  sessionFile("file_upload", "", "", "upload.csv"),
  sessionFile("file_report_v1", "run_1", "report.txt"),
  sessionFile("file_notes", "run_1", "notes/today.md"),
];
const STORE_BODIES: Readonly<Record<string, string>> = {
  file_report_v2: "second",
  file_report_v1: "first",
  file_notes: "notes",
  file_upload: "a,b",
};

function completedRun(id: string) {
  return create(RunSchema, { metadata: { id, org: "acme" }, status: { phase: RunPhase.RUN_COMPLETED } });
}

// A run still pending: nothing produced yet.
const pendingExecution = create(RunSchema, {
  metadata: { id: "aex_pending", org: "acme" },
  status: { phase: RunPhase.RUN_PENDING },
});

beforeAll(async () => {
  // Object-storage stand-in: serves the good key, 404s anything else.
  storage = createHttpServer((req, res) => {
    if (req.url === "/store/file_report") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end(OUTPUT_BODY);
      return;
    }
    const stored = STORE_BODIES[(req.url ?? "").replace("/store/", "")];
    if (stored !== undefined) {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end(stored);
      return;
    }
    if (["/store/file_q3", "/store/file_escape", "/store/file_absolute"].includes(req.url ?? "")) {
      res.writeHead(200, { "content-type": "text/markdown" });
      res.end(REPORT_BODY);
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
    router.service(RunQueryController, {
      get: (req) => {
        if (req.value === "aex_pending") return pendingExecution;
        if (!["aex_done", "aex_nested", "aex_escape", "aex_absolute"].includes(req.value)) {
          throw new ConnectError("not found", Code.NotFound);
        }
        return completedRun(req.value);
      },
    });
    router.service(FileQueryController, {
      list: (req) =>
        create(FileListSchema, {
          entries:
            req.sessionId !== ""
              ? sessionFiles.filter((f) => req.org === SESSION_ORG && f.status?.sessionId === req.sessionId)
              : runFiles.filter((f) => req.org === "acme" && f.status?.runId === req.runId),
        }),
      get: (req) => {
        const file = [...sessionFiles, ...runFiles].find((f) => f.metadata?.id === req.value);
        if (file === undefined) throw new ConnectError("file not found", Code.NotFound);
        return file;
      },
      getDownloadUrl: (req) => create(FileDownloadUrlSchema, { url: `${storageUrl}/store/${req.value}` }),
    });
    router.service(SessionQueryController, {
      get: (req) => {
        if (req.value !== "ses_conv") throw new ConnectError("session not found", Code.NotFound);
        return create(SessionSchema, { metadata: { id: "ses_conv", org: SESSION_ORG }, status: { state: "running" } });
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
  await new Promise<void>((resolve) => storage.close(() => resolve()));
});

describe("pushSkill", () => {
  it("zips a directory and uploads a valid archive", async () => {
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

describe("downloadRunOutputs", () => {
  it("downloads available outputs and tolerates partial failures", async () => {
    const out = mkdtempSync(join(tmpdir(), "dl-it-"));
    try {
      const outcome = await downloadRunOutputs(client, "aex_done", { outputPath: "", outputDir: out });
      expect(outcome.total).toBe(2);
      expect(outcome.downloaded).toBe(1); // broken.txt 404s, report.txt succeeds
      expect(outcome.noOutputs).toBe(false);
      expect(readFileSync(join(out, "report.txt"), "utf8")).toBe(OUTPUT_BODY);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  it("warns that a pending run may be incomplete, and reports no outputs", async () => {
    const progress: string[] = [];
    const out = mkdtempSync(join(tmpdir(), "dl-it-"));
    try {
      const outcome = await downloadRunOutputs(
        client,
        "aex_pending",
        { outputPath: "", outputDir: out },
        (line) => progress.push(line),
      );
      expect(outcome).toEqual({ total: 0, downloaded: 0, noOutputs: true, incompletePhase: "pending" });
      expect(progress).toEqual([
        "Run is still pending. Its outputs may not be complete until the run finishes.",
      ]);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  it("refuses a named output the run does not hold, pointing at get run", async () => {
    const out = mkdtempSync(join(tmpdir(), "dl-it-"));
    try {
      const failure = downloadRunOutputs(client, "aex_done", { outputPath: "missing.txt", outputDir: out });
      await expect(failure).rejects.toBeInstanceOf(CliExitError);
      await expect(failure).rejects.toMatchObject({
        message: "output not found: missing.txt\n\nUse 'stigmer get run aex_done' to see available outputs",
        exitCode: ExitCode.General,
      });
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  it("filters to a named output by its bare filename", async () => {
    const out = mkdtempSync(join(tmpdir(), "dl-it-"));
    try {
      const outcome = await downloadRunOutputs(client, "aex_done", { outputPath: "report.txt", outputDir: out });
      expect(outcome.total).toBe(1);
      expect(outcome.downloaded).toBe(1);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  it("writes a File at its place in the outputs folder", async () => {
    const out = mkdtempSync(join(tmpdir(), "dl-it-"));
    try {
      const outcome = await downloadRunOutputs(client, "aex_nested", { outputPath: "", outputDir: out });
      expect(outcome).toEqual({ total: 1, downloaded: 1, noOutputs: false, incompletePhase: undefined });
      expect(readFileSync(join(out, "reports", "q3.md"), "utf8")).toBe(REPORT_BODY);
      expect(existsSync(join(out, "q3.md"))).toBe(false);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  it("filters to a named output by its path in the outputs folder", async () => {
    const out = mkdtempSync(join(tmpdir(), "dl-it-"));
    try {
      const outcome = await downloadRunOutputs(client, "aex_nested", {
        outputPath: "reports/q3.md",
        outputDir: out,
      });
      expect(outcome.downloaded).toBe(1);
      expect(readFileSync(join(out, "reports", "q3.md"), "utf8")).toBe(REPORT_BODY);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  it("refuses a path that would climb out of the output directory", async () => {
    const progress: string[] = [];
    const parent = mkdtempSync(join(tmpdir(), "dl-it-"));
    const out = join(parent, "out");
    try {
      const outcome = await downloadRunOutputs(
        client,
        "aex_escape",
        { outputPath: "", outputDir: out },
        (line) => progress.push(line),
      );
      expect(outcome).toMatchObject({ total: 1, downloaded: 0 });
      expect(existsSync(join(parent, "evil.txt"))).toBe(false);
      expect(progress).toEqual([
        "  Failed to download ../evil.txt: refusing a path outside the output directory: ../evil.txt",
      ]);
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });

  it("refuses an absolute path rather than writing it anywhere", async () => {
    const progress: string[] = [];
    const out = mkdtempSync(join(tmpdir(), "dl-it-"));
    try {
      const outcome = await downloadRunOutputs(
        client,
        "aex_absolute",
        { outputPath: "", outputDir: out },
        (line) => progress.push(line),
      );
      expect(outcome).toMatchObject({ total: 1, downloaded: 0 });
      expect(existsSync(join(out, "evil.txt"))).toBe(false);
      expect(progress).toEqual([
        "  Failed to download /evil.txt: refusing a path outside the output directory: /evil.txt",
      ]);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
});

describe("downloadSessionOutputs", () => {
  it("writes what the turns saved, newest per place, and never a File given to the conversation", async () => {
    const progress: string[] = [];
    const out = mkdtempSync(join(tmpdir(), "dl-it-"));
    try {
      const outcome = await downloadSessionOutputs(
        client,
        "ses_conv",
        { outputPath: "", outputDir: out },
        (line) => progress.push(line),
      );
      expect(outcome).toEqual({ total: 2, downloaded: 2, noOutputs: false });
      expect(readFileSync(join(out, "report.txt"), "utf8")).toBe("second");
      expect(readFileSync(join(out, "notes", "today.md"), "utf8")).toBe("notes");
      expect(existsSync(join(out, "upload.csv"))).toBe(false);
      expect(progress[0]).toBe("A turn is still running. Its outputs may not be complete until it finishes.");
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  it("filters to a named output, and points at the conversation's file list when none matches", async () => {
    const out = mkdtempSync(join(tmpdir(), "dl-it-"));
    try {
      const outcome = await downloadSessionOutputs(client, "ses_conv", { outputPath: "notes/today.md", outputDir: out });
      expect(outcome).toEqual({ total: 1, downloaded: 1, noOutputs: false });
      const failure = downloadSessionOutputs(client, "ses_conv", { outputPath: "upload.csv", outputDir: out });
      await expect(failure).rejects.toMatchObject({
        message: "output not found: upload.csv\n\nUse 'stigmer list files --session ses_conv' to see available outputs",
        exitCode: ExitCode.General,
      });
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
});

describe("downloadFile", () => {
  it("writes one File under its filename", async () => {
    const out = mkdtempSync(join(tmpdir(), "dl-it-"));
    try {
      const outcome = await downloadFile(client, "file_upload", out);
      expect(outcome).toEqual({ total: 1, downloaded: 1, noOutputs: false });
      expect(readFileSync(join(out, "upload.csv"), "utf8")).toBe("a,b");
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  it("reports a File whose bytes cannot be fetched as not downloaded, naming it", async () => {
    const progress: string[] = [];
    const out = mkdtempSync(join(tmpdir(), "dl-it-"));
    try {
      const outcome = await downloadFile(client, "file_missing", out, (line) => progress.push(line));
      expect(outcome).toEqual({ total: 1, downloaded: 0, noOutputs: false });
      expect(progress.some((line) => line.startsWith("  Failed to download broken.txt"))).toBe(true);
      expect(existsSync(join(out, "broken.txt"))).toBe(false);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
});

describe("the download handlers for a session and a File", () => {
  const session = DOWNLOAD_HANDLERS.get(ApiResourceKind.session)!;
  const file = DOWNLOAD_HANDLERS.get(ApiResourceKind.file)!;
  const noProgress = () => undefined;

  it("download a conversation's outputs, and refuse a reference that is not its id", async () => {
    const out = mkdtempSync(join(tmpdir(), "dl-it-"));
    try {
      const outcome = await session.download(
        client,
        { ref: "ses_conv", org: "acme", outputPath: "notes/today.md", outputDir: out },
        noProgress,
      );
      expect(outcome).toEqual({ total: 1, downloaded: 1, noOutputs: false });
      expect(readFileSync(join(out, "notes", "today.md"), "utf8")).toBe("notes");
      await expect(
        session.download(client, { ref: "my-chat", org: "acme", outputPath: "", outputDir: out }, noProgress),
      ).rejects.toThrow(new UsageError("invalid session ID: my-chat\n\nA conversation is named by its ID (e.g., ses_01abc123)"));
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  it("download a File by its id, and refuse --path and a reference that is not an id", async () => {
    const out = mkdtempSync(join(tmpdir(), "dl-it-"));
    try {
      const outcome = await file.download(
        client,
        { ref: "file_upload", org: "acme", outputPath: "", outputDir: out },
        noProgress,
      );
      expect(outcome).toEqual({ total: 1, downloaded: 1, noOutputs: false });
      expect(readFileSync(join(out, "upload.csv"), "utf8")).toBe("a,b");
      await expect(
        file.download(client, { ref: "file_upload", org: "acme", outputPath: "x.csv", outputDir: out }, noProgress),
      ).rejects.toThrow(/--path picks among a run's or a session's outputs/);
      await expect(
        file.download(client, { ref: "ledger", org: "acme", outputPath: "", outputDir: out }, noProgress),
      ).rejects.toThrow("a File is named by its ID (e.g., file_01abc123), not 'ledger'");
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
});
