// Conformance suite for a Stigmer-engine turn of an agent without a
// computer (Class B; agent/v1/spec.proto `computer: COMPUTER_NONE`).
//
// The contract under test: such a turn touches no disk. It gets no
// workspace and no copy of anything on the runner's disk; its file tools
// see its notes at `/` (kept with the conversation), the conversation's
// Files at `.stigmer/uploads/` (read from the store when opened), its
// outputs at `.stigmer/outputs/` (returned as the conversation's Files when
// the turn ends, and listed again in the next turn), and what it set aside
// at `/large_tool_results/`. Each arm reads what the agent's tools answered
// from the session's log and what the server holds; nothing reads the
// runner's memory.
//
//  - A command: no shell is offered, and a call the model makes anyway is a
//    failed tool call; nothing runs.
//  - The runner's disk: a file planted in the conversation's own platform
//    folder on the runner, where a turn with a computer reads it, is not
//    found by a turn without one; nor is a path elsewhere on the machine.
//    The arm with a computer reads the planted file, so the plant is real.
//  - Another conversation: B finds none of A's upload, output or note.
//  - The layer end to end, across three turns of one conversation: an
//    upload read on open, a note kept and read back, an output returned as
//    a File and then edited into a new one, a result set aside and read
//    back, and a plan-mode turn's plan returned as a File.
//  - Two organizations on one runner: each turn reads its own File of the
//    same name.
//  - What reaches the runner's disk: the conversation's session folder
//    holds the saved state alone.
//
// And the turn's program is locked and can't reach its machine:
//
//  - It runs in the runner's locked agent host, which the runner's log says
//    started, and its memory tool reaches the server's `/v1/mcp/` lane over
//    the network: a fact it proposes is the organization's to list.
//  - A `web_fetch` of the server's own port (loopback) is refused; with a
//    computer, on this local runner, the same fetch goes through.
//  - Saving it with an MCP server at a loopback address is refused, naming
//    the address.
//  - A plugin it lists that gains a local program, or a hook, after it was
//    saved is refused at the next message, naming the plugin.
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { InteractionMode, RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import type { Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { Computer } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
import type { Agent } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import { readAnthropicRequest } from "@stigmer/test-support/llm-wire";
import { anthropicText, anthropicToolUse, anthropicToolUses, type MockLlmProxy } from "@stigmer/test-support/mock-llm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { mcpToolName } from "../harness/mcp-server";
import { claudePlugin, oneServerPlugin, pushPlugin } from "../support/plugins";
import { agentRefOf, makeAgent } from "../support/agents";
import { uniqueName } from "../support/naming";
import { awaitTerminal, makeAgentExecution, requireLlmProxy, sessionIdOf } from "../support/runs";
import { toolUseByCallId, turnOfRun } from "../support/turn";
import { createTarget, type TargetProfile } from "../targets";

let target: TargetProfile;
let clients: ConformanceClients;
let mock: MockLlmProxy;
const fixtures = new FixtureTracker();

beforeAll(async () => {
  target = createTarget();
  await target.setup();
  clients = target.clients();
  mock = requireLlmProxy(target);
});

afterEach(async () => {
  await fixtures.cleanup();
  mock.reset();
});

afterAll(async () => {
  await target?.teardown();
});

function runnerHome(): string {
  if (target.runnerHomeDir === undefined) throw new Error(`target ${target.name} spawns no runner; this suite reads its disk`);
  return target.runnerHomeDir();
}

async function agentOn(org: string, computer: Computer): Promise<Agent> {
  const agent = await clients.agentCommand.create(makeAgent({ org, name: uniqueName("agent-nocomputer"), computer }));
  fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));
  return agent;
}

async function upload(org: string, filename: string, text: string): Promise<string> {
  const file = await clients.fileCommand.upload({ org, filename, source: { case: "data", value: new TextEncoder().encode(text) } });
  const id = file.metadata!.id;
  fixtures.defer(() => clients.fileCommand.delete({ value: id }).catch(() => undefined));
  return id;
}

/** Run one message to its end, COMPLETED, and answer the run. */
async function completed(opts: Parameters<typeof makeAgentExecution>[0]): Promise<Run> {
  const created = await clients.agentExecutionCommand.create(makeAgentExecution(opts));
  const runId = created.metadata!.id;
  fixtures.defer(() => clients.agentExecutionCommand.delete({ value: runId }).catch(() => undefined));
  const final = await awaitTerminal(clients, runId);
  expect(RunPhase[final.status?.phase ?? 0], `run ${runId} completes (error: ${final.status?.error ?? ""})`).toBe(RunPhase[RunPhase.RUN_COMPLETED]);
  return final;
}

/** What one of a run's tool calls answered: its state and its text. */
async function answered(run: Run, callId: string): Promise<{ readonly state: string; readonly text: string }> {
  const call = toolUseByCallId(await turnOfRun(clients, run), callId);
  expect(call, `the run made call ${callId}`).toBeDefined();
  return { state: call!.state, text: call!.result?.text ?? "" };
}

/** The text of the conversation's newest File at an output path. */
async function outputText(org: string, runId: string, outputPath: string): Promise<string | undefined> {
  const listed = await clients.fileQuery.list({ org, runId });
  const file = listed.entries.find((entry) => entry.status?.outputPath === outputPath);
  if (file === undefined) return undefined;
  return new TextDecoder().decode((await clients.fileQuery.getContent({ id: file.metadata!.id })).data);
}

const NOT_FOUND = /not found|no such file|ENOENT|does not exist/i;

describe("A turn without a computer — no command, no runner disk, no other conversation", () => {
  it("offers no shell, and a command the model calls anyway fails without running", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await agentOn(org, Computer.NONE);
    mock.enqueue(anthropicToolUse("call_cmd", "execute", { command: "touch /tmp/stigmer-computerless-proof && echo ran" }));
    mock.enqueue(anthropicText("Done."));
    const run = await completed({ org, name: uniqueName("run-cmd"), agentRef: agentRefOf(agent), message: "Run a command." });

    const offered = (readAnthropicRequest(mock.scriptedRequests()[0]!.body).tools ?? []).map((tool) => tool.name);
    expect(offered, "no shell is offered").not.toContain("execute");
    const call = await answered(run, "call_cmd");
    expect(call.state, "the call fails").toBe("failed");
    expect(call.text).not.toContain("ran");
    expect(existsSync("/tmp/stigmer-computerless-proof"), "nothing ran").toBe(false);
  });

  it.each([
    { label: "without a computer", computer: Computer.NONE, reads: false },
    { label: "with a computer (the control: the plant is real)", computer: Computer.REQUIRED, reads: true },
  ])("a file on the runner's disk in the conversation's own folder, $label, reads: $reads", async ({ computer, reads }) => {
    const { org } = await target.provisionTenancy();
    const agent = await agentOn(org, computer);
    mock.enqueue(anthropicText("Hello."));
    const first = await completed({ org, name: uniqueName("run-plant"), agentRef: agentRefOf(agent) });
    const sessionId = sessionIdOf(first);

    // Planted where a disk-backed turn's platform route reads, and nothing
    // of the mount's prunes: the eval reference folder.
    const planted = join(runnerHome(), ".stigmer", "sessions", sessionId, "platform", "inputs", "planted.txt");
    await mkdir(join(planted, ".."), { recursive: true });
    await writeFile(planted, "PLANTED ON THE RUNNER'S DISK");

    mock.enqueue(
      anthropicToolUses([
        { toolCallId: "call_planted", toolName: "read_file", toolInput: { file_path: "/.stigmer/inputs/planted.txt" } },
        { toolCallId: "call_hosts", toolName: "read_file", toolInput: { file_path: "/etc/hosts" } },
        { toolCallId: "call_home", toolName: "read_file", toolInput: { file_path: join(runnerHome(), ".stigmer", "sessions", sessionId, "platform", "inputs", "planted.txt") } },
      ]),
    );
    mock.enqueue(anthropicText("Read."));
    const second = await completed({ org, name: uniqueName("run-plant-read"), sessionId, message: "Read the files." });

    const plantedRead = await answered(second, "call_planted");
    if (reads) expect(plantedRead.text).toContain("PLANTED");
    else expect(plantedRead.text).toMatch(NOT_FOUND);
    expect((await answered(second, "call_hosts")).text).not.toMatch(/localhost/);
    expect((await answered(second, "call_home")).text).not.toContain("PLANTED");
  });

  it("finds none of another conversation's upload, output or note", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await agentOn(org, Computer.NONE);
    const fileId = await upload(org, "a-upload.txt", "CONVERSATION A'S UPLOAD");
    mock.enqueue(
      anthropicToolUses([
        { toolCallId: "call_a_note", toolName: "write_file", toolInput: { file_path: "/a-note.md", content: "CONVERSATION A'S NOTE" } },
        { toolCallId: "call_a_out", toolName: "write_file", toolInput: { file_path: "/.stigmer/outputs/a-out.md", content: "CONVERSATION A'S OUTPUT" } },
      ]),
    );
    mock.enqueue(anthropicText("Saved."));
    const a = await completed({ org, name: uniqueName("run-a"), agentRef: agentRefOf(agent), message: "Save.", fileIds: [fileId] });
    expect(await outputText(org, a.metadata!.id, "a-out.md")).toBe("CONVERSATION A'S OUTPUT");

    mock.enqueue(
      anthropicToolUses([
        { toolCallId: "call_b_upload", toolName: "read_file", toolInput: { file_path: "/.stigmer/uploads/a-upload.txt" } },
        { toolCallId: "call_b_out", toolName: "read_file", toolInput: { file_path: "/.stigmer/outputs/a-out.md" } },
        { toolCallId: "call_b_note", toolName: "read_file", toolInput: { file_path: "/a-note.md" } },
      ]),
    );
    mock.enqueue(anthropicText("Looked."));
    const b = await completed({ org, name: uniqueName("run-b"), agentRef: agentRefOf(agent), message: "Look." });
    expect(sessionIdOf(b)).not.toBe(sessionIdOf(a));
    for (const callId of ["call_b_upload", "call_b_out", "call_b_note"]) {
      const read = await answered(b, callId);
      expect(read.text, callId).not.toContain("CONVERSATION A'S");
      expect(read.text, callId).toMatch(NOT_FOUND);
    }
  });
});

describe("A turn without a computer — its files, end to end", () => {
  it("reads an upload on open, keeps a note, returns and edits an output, reads back a set-aside result, and returns a plan, with nothing on disk but the saved state", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await agentOn(org, Computer.NONE);
    const fileId = await upload(org, "brief.txt", "The customer wants the refund by Friday.\n");
    const kept = "x".repeat(40_000);

    mock.enqueue(
      anthropicToolUses([
        { toolCallId: "call_brief", toolName: "read_file", toolInput: { file_path: "/.stigmer/uploads/brief.txt" } },
        { toolCallId: "call_note", toolName: "write_file", toolInput: { file_path: "/notes.md", content: "Deadline: Friday.\n" } },
        { toolCallId: "call_reply", toolName: "write_file", toolInput: { file_path: "/.stigmer/outputs/reply.md", content: "Dear customer, v1\n" } },
        { toolCallId: "call_keep", toolName: "write_file", toolInput: { file_path: "/large_tool_results/kept.txt", content: kept } },
      ]),
    );
    mock.enqueue(anthropicText("Drafted."));
    const first = await completed({ org, name: uniqueName("run-files-1"), agentRef: agentRefOf(agent), message: "Draft a reply.", fileIds: [fileId] });
    const sessionId = sessionIdOf(first);
    expect((await answered(first, "call_brief")).text).toContain("refund by Friday");
    expect(await outputText(org, first.metadata!.id, "reply.md"), "the output came back as a File").toBe("Dear customer, v1\n");

    mock.enqueue(
      anthropicToolUses([
        { toolCallId: "call_note_back", toolName: "read_file", toolInput: { file_path: "/notes.md" } },
        { toolCallId: "call_edit", toolName: "edit_file", toolInput: { file_path: "/.stigmer/outputs/reply.md", old_string: "v1", new_string: "v2" } },
        { toolCallId: "call_kept_back", toolName: "read_file", toolInput: { file_path: "/large_tool_results/kept.txt", limit: 1 } },
      ]),
    );
    mock.enqueue(anthropicText("Revised."));
    const second = await completed({ org, name: uniqueName("run-files-2"), sessionId, message: "Revise it." });
    expect((await answered(second, "call_note_back")).text, "the note from the first turn").toContain("Deadline: Friday.");
    expect((await answered(second, "call_edit")).state, "the earlier output is edited").toBe("completed");
    expect(await outputText(org, second.metadata!.id, "reply.md"), "the edit returns as a new File").toBe("Dear customer, v2\n");
    expect((await answered(second, "call_kept_back")).text, "the set-aside result reads back").toContain("xxxxxxxx");

    mock.enqueue(anthropicText("# Plan: answer the refund\n\n1. Confirm the order.\n2. Reply by Friday.\n"));
    const plan = await completed({ org, name: uniqueName("run-files-plan"), sessionId, message: "Plan it.", interactionMode: InteractionMode.PLAN });
    const planned = (await clients.fileQuery.list({ org, runId: plan.metadata!.id })).entries.map((file) => file.status?.outputPath ?? "");
    expect(planned.some((path) => path.endsWith(".plan.md")), `the plan is a File (${planned.join(", ")})`).toBe(true);

    const sessionDir = join(runnerHome(), ".stigmer", "sessions", sessionId);
    const onDisk = existsSync(sessionDir) ? await readdir(sessionDir) : [];
    expect(
      onDisk.filter((name) => !name.startsWith("checkpoints.db")),
      "the conversation's folder on the runner holds its saved state alone",
    ).toEqual([]);
  }, 180_000);
});

describe("A turn without a computer — two organizations on one runner", () => {
  it("each reads its own File of the same name", async () => {
    const reads: string[] = [];
    for (const label of ["ORG ONE", "ORG TWO"]) {
      const { org } = await target.provisionTenancy();
      const agent = await agentOn(org, Computer.NONE);
      const fileId = await upload(org, "same.txt", `${label}'S FILE`);
      mock.enqueue(anthropicToolUse("call_same", "read_file", { file_path: "/.stigmer/uploads/same.txt" }));
      mock.enqueue(anthropicText("Read."));
      const run = await completed({ org, name: uniqueName("run-org"), agentRef: agentRefOf(agent), message: "Read it.", fileIds: [fileId] });
      reads.push((await answered(run, "call_same")).text);
    }
    expect(reads[0]).toContain("ORG ONE'S FILE");
    expect(reads[0]).not.toContain("ORG TWO");
    expect(reads[1]).toContain("ORG TWO'S FILE");
    expect(reads[1]).not.toContain("ORG ONE");
  });
});

describe("A turn without a computer — locked, and off its machine", () => {
  function serverBaseUrl(): string {
    if (target.httpBaseUrl === undefined) throw new Error(`target ${target.name} exposes no unified port`);
    return target.httpBaseUrl();
  }

  it("runs in the locked agent host, and its memory tool reaches the server's lane: the fact it proposes is listed", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await agentOn(org, Computer.NONE);
    const fact = `Prefers answers that name the source (${uniqueName("fact")}).`;
    mock.enqueue(anthropicToolUse("call_remember", mcpToolName("stigmer-memory", "remember"), { fact }));
    mock.enqueue(anthropicText("Noted."));
    const run = await completed({ org, name: uniqueName("run-remember"), agentRef: agentRefOf(agent), message: "Remember how I like answers." });

    const call = await answered(run, "call_remember");
    expect(call.state, `the remember call completes (${call.text})`).toBe("completed");
    const listed = await clients.memoryQuery.list({ org, pageSize: 50 });
    const mine = listed.entries.filter((memory) => memory.spec?.content === fact);
    expect(mine, "the server holds the fact the turn proposed").toHaveLength(1);
    fixtures.defer(() => clients.memoryCommand.delete({ value: mine[0]!.metadata!.id }).catch(() => undefined));

    if (target.runnerLogFile === undefined) throw new Error(`target ${target.name} keeps no runner log`);
    const log = await readFile(target.runnerLogFile(), "utf8");
    expect(log, "the runner started its locked host for the turn").toMatch(/\[agent-host\] the locked agent host started \(--(?:experimental-)?permission --allow-fs-read=/);
  });

  it.each([
    { label: "without a computer", computer: Computer.NONE, refused: true },
    { label: "with a computer (the control: this local runner fetches loopback)", computer: Computer.REQUIRED, refused: false },
  ])("a web_fetch of the server's own port, $label, is refused: $refused", async ({ computer, refused }) => {
    const { org } = await target.provisionTenancy();
    const agent = await agentOn(org, computer);
    const url = `${serverBaseUrl()}/`;
    mock.enqueue(anthropicToolUse("call_fetch", "web_fetch", { url }));
    mock.enqueue(anthropicText("Done."));
    const run = await completed({ org, name: uniqueName("run-fetch"), agentRef: agentRefOf(agent), message: "Fetch the admin page." });

    const call = await answered(run, "call_fetch");
    if (refused) expect(call.text, `the fetch of ${url} is refused`).toMatch(/Refusing to fetch/);
    else expect(call.text, `the fetch of ${url} goes through`).not.toMatch(/Refusing to fetch/);
  });

  it("refuses saving it with an MCP server at a loopback address, naming the address", async () => {
    const { org } = await target.provisionTenancy();
    const url = `${serverBaseUrl()}/mcp`;
    await expect(
      clients.agentCommand.create(
        makeAgent({ org, name: uniqueName("agent-nocomputer-local-mcp"), computer: Computer.NONE, mcpServers: [{ name: "local", url }] }),
      ),
    ).rejects.toThrow(/this machine/);
  });

  it.each([
    {
      label: "a local program",
      why: /as a local program/,
      grown: (name: string) => oneServerPlugin({ name, version: "0.2.0", server: { command: "node", args: ["-e", "0"] } }),
    },
    {
      label: "a hook",
      why: /runs hooks/,
      grown: (name: string) =>
        claudePlugin({
          name,
          version: "0.2.0",
          description: "conformance plugin that gained a hook",
          hooks: { PreToolUse: [{ matcher: "*", hooks: [{ type: "command", command: "true" }] }] },
        }),
    },
  ])("refuses the next message once a plugin it lists has gained $label", async ({ why, grown }) => {
    const { org } = await target.provisionTenancy();
    const name = uniqueName("plugin-grows");
    const plugin = await pushPlugin(
      clients,
      fixtures,
      org,
      claudePlugin({ name, version: "0.1.0", description: "conformance plugin with a skill", skills: [{ name: "notes", description: "How to write notes", body: "# Notes\nKeep them short." }] }),
    );
    const agent = await clients.agentCommand.create(
      makeAgent({ org, name: uniqueName("agent-nocomputer-plugin"), computer: Computer.NONE, plugins: [plugin.metadata!.slug] }),
    );
    fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));
    await pushPlugin(clients, fixtures, org, grown(name));

    await expect(
      clients.agentExecutionCommand.create(makeAgentExecution({ org, name: uniqueName("run-plugin-grew"), agentRef: agentRefOf(agent), message: "Hello." })),
    ).rejects.toThrow(why);
  });
});
