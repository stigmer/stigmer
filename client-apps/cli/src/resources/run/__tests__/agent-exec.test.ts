// Orchestration tests for executeResolvedAgent: the one-call bootstrap
// contract (stigmer/stigmer#249). A workspace-bearing run must issue exactly
// one create RPC — the AgentRun carrying session_spec — instead of the
// old session.create + agentRun.create pair, and the flow must read the
// canonical session id back from the returned run's target. A run on
// an agent names it by reference (org and slug, no instance and no id); the
// built-in assistant rides the same flow with no agent at all. Most runs
// use detach mode so no streaming machinery is exercised; the attached runs
// stream through a double that returns the final run, and pin that the
// run's artifacts are downloaded only when a download directory was given
// and the final run holds some.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { create } from "@bufbuild/protobuf";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { AgentRun } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/api_pb";
import { ApprovalAction } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/enum_pb";
import { Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import {
  LocalPathSourceSchema,
  WorkspaceEntrySchema,
  WorkspaceSourceSchema,
} from "@stigmer/protos/ai/stigmer/agentic/session/v1/workspace_pb";
import { AgentRunSchema } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/api_pb";
import type { BackendClient } from "../../../client/index.js";
import { executeResolvedAgent } from "../agent-exec.js";
import type { PreparedRun } from "../prepare.js";

const stream = vi.hoisted(() => ({ streamAgentRun: vi.fn() }));
const download = vi.hoisted(() => ({ downloadRunArtifacts: vi.fn() }));
vi.mock("../stream.js", () => stream);
vi.mock("../../download.js", () => download);

const WORKSPACE_ENTRY = create(WorkspaceEntrySchema, {
  name: "repo",
  source: create(WorkspaceSourceSchema, {
    source: { case: "localPath", value: create(LocalPathSourceSchema, { path: "/home/user/repo" }) },
  }),
});

function makeAgent(): Agent {
  return create(AgentSchema, {
    metadata: { id: "agt_1", name: "Helper", org: "acme", slug: "helper" },
  });
}

function makePrepared(overrides: Partial<PreparedRun> = {}): PreparedRun {
  return {
    defaultAction: ApprovalAction.UNSPECIFIED,
    workspaceEntries: [],
    runtimeEnv: {},
    attachments: [],
    workspaceFileRefs: [],
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
// run spec.
function fakeBackend(): { client: BackendClient; creates: () => AgentRun[] } {
  const captured: AgentRun[] = [];
  const controller = () => ({
    create: async (msg: AgentRun) => {
      captured.push(msg);
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
  const client = { controller, stigmer: { name: "stub-client" } } as unknown as BackendClient;
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
      prepared: makePrepared({ workspaceEntries: [WORKSPACE_ENTRY] }),
      org: "acme",
      downloadDir: "",
      outputMode: "inline",
      client,
    });

    const sent = creates();
    expect(sent, "a workspace run is a single AgentRun create").toHaveLength(1);
    const target = sent[0]?.spec?.target;
    expect(target?.case, "no client-created session id").toBe("sessionSpec");
    const sessionSpec = target?.case === "sessionSpec" ? target.value : undefined;
    expect(sessionSpec?.agentRef).toMatchObject({ kind: ApiResourceKind.agent, org: "acme", slug: "helper" });
    expect(sessionSpec?.workspaceEntries).toEqual([WORKSPACE_ENTRY]);

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
    expect(sessionSpec?.workspaceEntries).toEqual([]);
  });

  it("runs the built-in assistant with no agent: an all-empty target and the assistant's name in the header", async () => {
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
    // An unset target: the backend creates a session that names no agent
    // and the runner answers as the assistant.
    expect(sent[0]?.spec?.target?.case).toBeUndefined();
    expect(stderrLines.join("")).toContain("Assistant");
    expect(stderrLines.join("")).toContain("stigmer resume ses_srv");
  });

  it("threads the resolved harness onto the wire and surfaces it in the header (oss#293)", async () => {
    // The revert-detection seam: if the prepared→create threading is ever
    // dropped, this wire assertion fails — not just a flag-parsing test.
    const { client, creates } = fakeBackend();

    await executeResolvedAgent({
      agent: makeAgent(),
      prepared: makePrepared({ harness: "cursor" }),
      org: "acme",
      downloadDir: "",
      outputMode: "inline",
      client,
    });

    const sent = creates();
    expect(sent).toHaveLength(1);
    const target = sent[0]?.spec?.target;
    expect(target?.case === "sessionSpec" ? target.value.harness : undefined).toBe(Harness.CURSOR);
    // Harness visibility: a cursor session must announce itself before streaming —
    // whether the flag or the account preference selected it.
    expect(stderrLines.join("")).toContain("Harness:");
    expect(stderrLines.join("")).toContain("Cursor");
  });
});

describe("executeResolvedAgent, attached", () => {
  /** The final run the stream returns: `artifacts` named files under run aex_final. */
  function finalRun(artifacts: string[]): AgentRun {
    return create(AgentRunSchema, {
      metadata: { id: "aex_final" },
      status: { artifacts: artifacts.map((name) => ({ name, storageKey: `store/${name}` })) },
    });
  }

  it("streams the created run with the session the server returned", async () => {
    stream.streamAgentRun.mockResolvedValue(finalRun([]));
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
    expect(download.downloadRunArtifacts).not.toHaveBeenCalled();
  });

  it("downloads the final run's artifacts into the download directory", async () => {
    stream.streamAgentRun.mockResolvedValue(finalRun(["report.txt"]));
    const { client } = fakeBackend();

    await executeResolvedAgent({
      agent: makeAgent(),
      prepared: makePrepared({ detach: false }),
      org: "acme",
      downloadDir: "/tmp/out",
      outputMode: "inline",
      client,
    });

    expect(download.downloadRunArtifacts).toHaveBeenCalledWith(
      client.stigmer,
      "aex_final",
      { artifactName: "", outputDir: "/tmp/out" },
      expect.any(Function),
    );
  });

  it("downloads nothing when the final run produced no artifacts", async () => {
    stream.streamAgentRun.mockResolvedValue(finalRun([]));
    const { client } = fakeBackend();

    await executeResolvedAgent({
      agent: makeAgent(),
      prepared: makePrepared({ detach: false }),
      org: "acme",
      downloadDir: "/tmp/out",
      outputMode: "inline",
      client,
    });

    expect(download.downloadRunArtifacts).not.toHaveBeenCalled();
  });
});
