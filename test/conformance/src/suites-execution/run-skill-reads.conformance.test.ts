// Conformance suite for how a turn reads its skills and plugins (Class B).
// Domain: agentic / run — the Stigmer engine's `.stigmer/skills/` and
// `.stigmer/plugins/`, read from the store one file at a time.
//
// A turn's file tools read a skill's files from the store, under the turn's
// own credential, only for the turn's own skills, each byte checked against
// the server's listing. A conversation without a computer keeps no copy on
// disk; one with a computer keeps the archive its commands run from.
//
// Asserted contract:
// - two organizations each push a skill named `notes` with different text;
//   on one runner, each one's turn reads its own `SKILL.md` and reference
//   file, never the other's;
// - a 50 MB plugin (one small skill, the rest incompressible filler) on an
//   agent without a computer: the turn that opens the skill's `SKILL.md`
//   receives that file's bytes and no more (the runner's per-turn read line),
//   and no tree or archive lands in the session's platform folder; the same
//   plugin on an agent with a computer still downloads the whole archive for
//   its commands, while its file tools read the same few bytes.
//
// The mock LLM scripts the reads: a turn of read_file tool uses, then text.
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { Computer } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import type { Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import type { MockLlmProxy } from "@stigmer/test-support/mock-llm";
import { anthropicText, anthropicToolUses } from "@stigmer/test-support/mock-llm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { agentRefOf, makeAgent } from "../support/agents";
import { uniqueName } from "../support/naming";
import { claudePlugin, pluginArchive } from "../support/plugins";
import { awaitTerminal, makeAgentExecution, requireLlmProxy, sessionIdOf } from "../support/runs";
import { zipFiles } from "../support/skills";
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

/** Runs one turn of `agentRef` whose model reads `paths` with read_file, then answers; returns the completed run. */
async function readingTurn(org: string, agentRef: ReturnType<typeof agentRefOf>, paths: readonly string[], label: string): Promise<Run> {
  mock.enqueue(anthropicToolUses(paths.map((path, i) => ({ toolCallId: `call_read_${i}`, toolName: "read_file", toolInput: { file_path: path } }))));
  mock.enqueue(anthropicText("Read."));
  const execution = await clients.agentExecutionCommand.create(makeAgentExecution({ org, name: uniqueName(label), agentRef, autoApproveAll: true }));
  const executionId = execution.metadata!.id;
  fixtures.defer(() => clients.agentExecutionCommand.delete({ value: executionId }));
  const final = await awaitTerminal(clients, executionId);
  expect(RunPhase[final.status?.phase ?? 0], `execution ${executionId} completes (error: ${final.status?.error ?? ""})`).toBe(RunPhase[RunPhase.RUN_COMPLETED]);
  return final;
}

/** What each read_file of the run answered, by call order. */
async function readResults(run: Run, count: number): Promise<string[]> {
  const turn = await turnOfRun(clients, run);
  return Array.from({ length: count }, (_, i) => toolUseByCallId(turn, `call_read_${i}`)?.result?.text ?? "");
}

/** The runner's one line of what a turn read from the store, read from its log once the turn has ended. */
async function readLineOf(executionId: string): Promise<{ filesRead: number; bytesReceived: number; cacheHits: number }> {
  const logFile = target.runnerLogFile!();
  const pattern = new RegExp(`\\[archive-reader\\] execution=${executionId} filesRead=(\\d+) bytesReceived=(\\d+) cacheHits=(\\d+)`);
  const deadline = Date.now() + 15_000;
  for (;;) {
    const match = pattern.exec(readFileSync(logFile, "utf8"));
    if (match !== null) return { filesRead: Number(match[1]), bytesReceived: Number(match[2]), cacheHits: Number(match[3]) };
    if (Date.now() > deadline) throw new Error(`no read line for ${executionId} in ${logFile}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

/** The session's platform folder on the target's runner. */
function platformDirOf(run: Run): string {
  return join(target.runnerHomeDir!(), ".stigmer", "sessions", sessionIdOf(run), "platform");
}

describe("Run — a turn reads its skills from the store", () => {
  it("two organizations' skills of one name, on one runner: each turn reads only its own", async () => {
    const turns: Array<{ org: string; run: Run; text: string; reference: string }> = [];
    for (const who of ["alpha", "beta"]) {
      const { org } = await target.provisionTenancy();
      const text = `# Notes of ${who}\n\nThe ${who} team's instructions.`;
      const reference = `reference only ${who} holds`;
      const skill = await clients.skillCommand.push({
        org,
        artifact: zipFiles({ "SKILL.md": `---\nname: notes\ndescription: ${who}'s notes\n---\n${text}`, "refs/ref.md": reference }),
      });
      fixtures.defer(() => clients.skillCommand.delete({ value: skill.metadata!.id }));
      const agent = await clients.agentCommand.create(makeAgent({ org, name: uniqueName(`agent-${who}`), skillRefs: [skill.metadata!.slug], computer: Computer.NONE }));
      fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));
      const run = await readingTurn(org, agentRefOf(agent), ["/.stigmer/skills/notes/SKILL.md", "/.stigmer/skills/notes/refs/ref.md"], `run-${who}`);
      turns.push({ org, run, text, reference });
    }

    expect(turns[0]!.org, "two organizations").not.toBe(turns[1]!.org);
    for (const [mine, theirs] of [[turns[0]!, turns[1]!], [turns[1]!, turns[0]!]] as const) {
      const [skillMd, ref] = await readResults(mine.run, 2);
      expect(skillMd, "its own SKILL.md").toContain(mine.text.split("\n")[2]!);
      expect(skillMd, "never the other organization's").not.toContain(theirs.text.split("\n")[2]!);
      expect(ref, "its own reference file").toContain(mine.reference);
      expect(ref).not.toContain(theirs.reference);
    }
  });

  it("a 50 MB plugin's turn receives only the file it opened; without a computer nothing lands on disk, with one the archive does", async (ctx) => {
    if (target.runnerLogFile === undefined || target.runnerHomeDir === undefined) return ctx.skip();
    const { org } = await target.provisionTenancy();
    const name = uniqueName("big-kit");
    const skillBody = "Open this file, and nothing else, to learn the kit.";
    const archive = pluginArchive(
      claudePlugin({ name, skills: [{ name: `${name}-guide`, body: skillBody }], files: { "data/filler.bin": randomBytes(50 * 1024 * 1024) } }),
    );
    // Above the inline cap: staged over the transfer lane.
    const minted = await clients.pluginCommand.createArtifactUploadUrl({ org, sizeBytes: BigInt(archive.length) });
    const put = await fetch(minted.url, { method: "PUT", body: Buffer.from(archive), headers: { "content-type": "application/zip" } });
    expect(put.ok, `staging PUT succeeds (HTTP ${put.status})`).toBe(true);
    const plugin = await clients.pluginCommand.push({ org, artifactUploadRef: minted.artifactUploadRef });
    fixtures.defer(() => clients.pluginCommand.delete({ value: plugin.metadata!.id }).then(() => undefined, () => undefined));
    const digest = plugin.status!.digest;
    const skillPath = plugin.status!.skills[0]!.path;
    const skillMdPath = `/.stigmer/plugins/${digest}/${skillPath}/SKILL.md`;

    const figures: Record<string, unknown> = { archiveBytes: archive.length };
    for (const computer of [Computer.NONE, Computer.REQUIRED]) {
      const agent = await clients.agentCommand.create(makeAgent({ org, name: uniqueName("agent-big"), plugins: [plugin.metadata!.slug], computer }));
      fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));
      const run = await readingTurn(org, agentRefOf(agent), [skillMdPath], "run-big");
      const [read] = await readResults(run, 1);
      expect(read, "the turn read the skill").toContain(skillBody);

      const line = await readLineOf(run.metadata!.id);
      const listed = await clients.pluginQuery.listFiles({ pluginId: plugin.metadata!.id, digest });
      const skillMdBytes = Number(listed.files.find((file) => file.path === `${skillPath}/SKILL.md`)!.sizeBytes);
      expect(line.bytesReceived + line.cacheHits * skillMdBytes, "the bytes of the one file it opened, from the store or the cache").toBe(skillMdBytes);
      expect(line.filesRead + line.cacheHits).toBe(1);

      const platform = platformDirOf(run);
      const cached = join(platform, "archives", `${digest}.zip`);
      if (computer === Computer.NONE) {
        expect(existsSync(join(platform, "plugins", digest)), "no tree without a computer").toBe(false);
        expect(existsSync(cached), "no archive without a computer").toBe(false);
      } else {
        expect(existsSync(join(platform, "plugins", digest, skillPath, "SKILL.md")), "the tree its commands run from").toBe(true);
        expect(statSync(cached).size, "the whole archive, for its commands").toBe(archive.length);
      }
      figures[Computer[computer]] = { storeBytes: line.bytesReceived, cacheHits: line.cacheHits, archiveOnDisk: existsSync(cached) ? statSync(cached).size : 0 };
    }
    console.log(`[run-skill-reads] transfer: ${JSON.stringify(figures)}`);
  });
});
