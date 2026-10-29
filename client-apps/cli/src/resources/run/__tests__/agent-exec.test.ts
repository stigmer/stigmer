// Orchestration tests for executeResolvedAgent: the one-call bootstrap
// contract (stigmer/stigmer#249). A workspace-bearing run must issue exactly
// one create RPC — the Run carrying session_spec — instead of the
// old session.create + run.create pair, and the flow must read the
// canonical session id back from the returned run's target. A run on
// an agent names it by reference (org and slug, no instance and no id); the
// built-in assistant rides the same flow with no agent at all. Most runs
// use detach mode so no streaming machinery is exercised; the attached runs
// stream through a double that returns the final run, and pin that the
// run's outputs (the Files it returned, which the download lists) are
// downloaded only when a download directory was given. Attached files are uploaded as the person's
// own before the create, named on it (the message's by id, a folder's as the
// new conversation's resources), and the originals are deleted once the
// create has answered, whether or not it succeeded.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, createRouterTransport } from "@connectrpc/connect";
import { FileSchema } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import { FileCommandController } from "@stigmer/apis/ai/stigmer/agentic/file/v1/command_pb";
import { Stigmer } from "@stigmer/client";
import type { Agent } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import type { Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { Harness } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import {
  LocalPathResourceSchema,
  SessionResourceSchema,
} from "@stigmer/apis/ai/stigmer/agentic/session/v1/resource_pb";
import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import type { BackendClient } from "../../../client/index.js";
import { executeResolvedAgent } from "../agent-exec.js";
import { NO_FILES, planFiles } from "../files.js";
import type { PreparedRun } from "../prepare.js";

const stream = vi.hoisted(() => ({ streamAgentRun: vi.fn() }));
const download = vi.hoisted(() => ({ downloadRunOutputs: vi.fn() }));
vi.mock("../stream.js", () => stream);
vi.mock("../../download.js", () => download);

const WORKSPACE_ENTRY = create(SessionResourceSchema, {
  name: "repo",
  resource: { case: "localPath", value: create(LocalPathResourceSchema, { path: "/home/user/repo" }) },
});

function makeAgent(): Agent {
  return create(AgentSchema, {
    metadata: { id: "agt_1", name: "Helper", org: "acme", slug: "helper" },
  });
}

function makePrepared(overrides: Partial<PreparedRun> = {}): PreparedRun {
  return {
    approveDefault: "",
    resources: [],
    vaults: [],
    includeMyVault: true,
    plugins: [],
    files: NO_FILES,
    message: "hi",
    detach: true,
    verbose: false,
    model: "",
    autoApproveAll: false,
    mode: "",
    serviceTier: "",
    thinking: "",
    harness: "",
    ...overrides,
  };
}

// A BackendClient double whose controller records every create call and
// emulates the server stamping the bootstrapped session id onto the returned
// run spec. `stigmer` is the client attached files upload through.
function fakeBackend(
  options: { stigmer?: Stigmer; refuseCreate?: boolean } = {},
): { client: BackendClient; creates: () => Run[] } {
  const captured: Run[] = [];
  const controller = () => ({
    create: async (msg: Run) => {
      captured.push(msg);
      if (options.refuseCreate === true) throw new ConnectError("no such agent", Code.NotFound);
      // Echo with the server-owned session id filled in, like the real backend.
      return {
        ...msg,
        spec:
          msg.spec === undefined
            ? undefined
            : { ...msg.spec, target: { case: "sessionId", value: "ses_srv" } },
      };
    },
  });
  const client = { controller, stigmer: options.stigmer ?? { name: "stub-client" } } as unknown as BackendClient;
  return { client, creates: () => captured };
}

// Captured stderr lines (the header + re-attach hint in detach mode).
let stderrLines: string[];

beforeEach(() => {
  stderrLines = [];
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderrLines.push(String(chunk));
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("executeResolvedAgent", () => {
  it("issues exactly one create carrying session_spec for a workspace run", async () => {
    const { client, creates } = fakeBackend();

    await executeResolvedAgent({
      agent: makeAgent(),
      prepared: makePrepared({ resources: [WORKSPACE_ENTRY] }),
      org: "acme",
      downloadDir: "",
      outputMode: "inline",
      client,
    });

    const sent = creates();
    expect(sent, "a workspace run is a single Run create").toHaveLength(1);
    const target = sent[0]?.spec?.target;
    expect(target?.case, "no client-created session id").toBe("sessionSpec");
    const sessionSpec = target?.case === "sessionSpec" ? target.value : undefined;
    expect(sessionSpec?.agentRef).toMatchObject({ kind: ApiResourceKind.agent, org: "acme", slug: "helper" });
    expect(sessionSpec?.resources).toEqual([WORKSPACE_ENTRY]);

    // The canonical session id comes back on the run spec and drives the
    // re-attach hint.
    expect(stderrLines.join("")).toContain("stigmer resume ses_srv");
  });

  it("names the agent by reference with no version when there is no workspace", async () => {
    const { client, creates } = fakeBackend();

    await executeResolvedAgent({
      agent: makeAgent(),
      prepared: makePrepared(),
      org: "acme",
      downloadDir: "",
      outputMode: "inline",
      client,
    });

    const sent = creates();
    expect(sent).toHaveLength(1);
    const target = sent[0]?.spec?.target;
    const sessionSpec = target?.case === "sessionSpec" ? target.value : undefined;
    // The CLI takes no version, so the session pins the agent's current one.
    expect(sessionSpec?.agentRef).toMatchObject({
      kind: ApiResourceKind.agent,
      org: "acme",
      slug: "helper",
      version: "",
    });
    expect(sessionSpec?.resources).toEqual([]);
  });

  it("runs the built-in assistant with no agent: a session_spec naming no agent and the assistant's name in the header", async () => {
    const { client, creates } = fakeBackend();

    await executeResolvedAgent({
      agent: undefined,
      prepared: makePrepared({ detach: true }),
      org: "acme",
      downloadDir: "",
      outputMode: "inline",
      client,
    });

    const sent = creates();
    expect(sent).toHaveLength(1);
    // A spec naming no agent: the backend creates a session that names none
    // and the runner answers as the assistant. The spec still carries the
    // vault choice, which a conversation created from no spec would lose.
    const target = sent[0]?.spec?.target;
    expect(target?.case).toBe("sessionSpec");
    expect(target?.case === "sessionSpec" ? target.value.agentRef : "unexpected").toBeUndefined();
    expect(target?.case === "sessionSpec" ? target.value.includeMyVault : undefined).toBe(true);
    expect(stderrLines.join("")).toContain("Assistant");
    expect(stderrLines.join("")).toContain("stigmer resume ses_srv");
  });

  it("threads the resolved harness onto the wire and surfaces it in the header (oss#293)", async () => {
    // The revert-detection seam: if the prepared→create threading is ever
    // dropped, this wire assertion fails — not just a flag-parsing test.
    const { client, creates } = fakeBackend();

    await executeResolvedAgent({
      agent: makeAgent(),
      prepared: makePrepared({ harness: "claude" }),
      org: "acme",
      downloadDir: "",
      outputMode: "inline",
      client,
    });

    const sent = creates();
    expect(sent).toHaveLength(1);
    const target = sent[0]?.spec?.target;
    expect(target?.case === "sessionSpec" ? target.value.harness : undefined).toBe(Harness.CLAUDE);
    // Harness visibility: a Claude session must announce itself before streaming —
    // whether the flag or the account preference selected it.
    expect(stderrLines.join("")).toContain("Harness:");
    expect(stderrLines.join("")).toContain("Claude Agent");
  });
});

describe("executeResolvedAgent, attached", () => {
  /** The final run the stream returns. */
  function finalRun(): Run {
    return create(RunSchema, { metadata: { id: "run_final" } });
  }

  it("streams the created run with the session the server returned", async () => {
    stream.streamAgentRun.mockResolvedValue(finalRun());
    const { client } = fakeBackend();

    await executeResolvedAgent({
      agent: makeAgent(),
      prepared: makePrepared({ detach: false, mode: "plan" }),
      org: "acme",
      downloadDir: "",
      outputMode: "json",
      client,
    });

    expect(stream.streamAgentRun).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "ses_srv", org: "acme", mode: "plan", outputMode: "json" }),
    );
    expect(download.downloadRunOutputs).not.toHaveBeenCalled();
  });

  it("downloads the final run's outputs into the download directory", async () => {
    stream.streamAgentRun.mockResolvedValue(finalRun());
    const { client } = fakeBackend();

    await executeResolvedAgent({
      agent: makeAgent(),
      prepared: makePrepared({ detach: false }),
      org: "acme",
      downloadDir: "/tmp/out",
      outputMode: "inline",
      client,
    });

    expect(download.downloadRunOutputs).toHaveBeenCalledWith(
      client.stigmer,
      "run_final",
      { outputPath: "", outputDir: "/tmp/out" },
      expect.any(Function),
    );
  });
});

describe("executeResolvedAgent, with files", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "agent-exec-files-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  // A Stigmer client whose File service records uploads and deletes; each
  // upload answers a File named after the uploaded filename.
  function fileServer(refuseDelete = false): { stigmer: Stigmer; sessionIds: string[]; deletes: string[] } {
    const sessionIds: string[] = [];
    const deletes: string[] = [];
    const transport = createRouterTransport(({ service }) => {
      service(FileCommandController, {
        upload: (input) => {
          sessionIds.push(input.sessionId);
          return create(FileSchema, { metadata: { id: `file_${input.filename}` } });
        },
        delete: (id) => {
          if (refuseDelete) throw new ConnectError("unavailable", Code.Unavailable);
          deletes.push(id.value);
          return create(FileSchema, { metadata: { id: id.value } });
        },
      });
    });
    const stigmer = new Stigmer({ baseUrl: "/", getAccessToken: () => "t", customTransport: transport });
    return { stigmer, sessionIds, deletes };
  }

  function attach(): ReturnType<typeof planFiles> {
    writeFileSync(join(dir, "report.pdf"), "pdf");
    mkdirSync(join(dir, "data"));
    writeFileSync(join(dir, "data", "a.csv"), "1,2");
    return planFiles([join(dir, "report.pdf"), join(dir, "data")], []);
  }

  it("names the uploaded Files on the one create, then deletes the person's originals", async () => {
    const files = fileServer();
    const { client, creates } = fakeBackend({ stigmer: files.stigmer });

    await executeResolvedAgent({
      agent: makeAgent(),
      prepared: makePrepared({ resources: [WORKSPACE_ENTRY], files: attach() }),
      org: "acme",
      downloadDir: "",
      outputMode: "inline",
      client,
    });

    expect(files.sessionIds, "uploaded as the person's own, before the conversation exists").toEqual(["", ""]);
    const spec = creates()[0]?.spec;
    expect(spec?.fileIds).toEqual(["file_report.pdf"]);
    const sessionSpec = spec?.target.case === "sessionSpec" ? spec.target.value : undefined;
    expect(sessionSpec?.resources.map((r) => r.resource.case)).toEqual(["localPath", "file"]);
    const folderFile = sessionSpec?.resources[1]?.resource;
    expect(folderFile?.case === "file" ? folderFile.value : undefined).toMatchObject({
      fileId: "file_a.csv",
      mountPath: "data/a.csv",
    });
    expect(files.deletes.sort()).toEqual(["file_a.csv", "file_report.pdf"]);
  });

  it("deletes the originals when the create is refused, and the refusal surfaces", async () => {
    const files = fileServer();
    const { client } = fakeBackend({ stigmer: files.stigmer, refuseCreate: true });

    await expect(
      executeResolvedAgent({
        agent: makeAgent(),
        prepared: makePrepared({ files: attach() }),
        org: "acme",
        downloadDir: "",
        outputMode: "inline",
        client,
      }),
    ).rejects.toThrow(/no such agent/);
    expect(files.deletes.sort()).toEqual(["file_a.csv", "file_report.pdf"]);
  });

  it("says on stderr which original it could not delete, and the run goes on", async () => {
    const files = fileServer(true);
    const { client, creates } = fakeBackend({ stigmer: files.stigmer });

    await executeResolvedAgent({
      agent: makeAgent(),
      prepared: makePrepared({ files: attach() }),
      org: "acme",
      downloadDir: "",
      outputMode: "inline",
      client,
    });

    expect(creates()).toHaveLength(1);
    expect(stderrLines.join("")).toContain("Could not delete the uploaded File file_report.pdf");
  });
});
