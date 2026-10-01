// Conformance suite for the workspace `.stigmer` link (Class B).
// Domain: agentic / agentexecution — what a skill turn does to the user's
// workspace while it runs, and what it leaves behind.
//
// The contract under test (stigmer/stigmer#1427, the runner's
// shared/workspace/stigmer-link.ts OWNERSHIP rule): a turn that brings a skill
// links the workspace's `.stigmer` to the session's platform dir, and a real
// `.stigmer` the user already kept there is moved out of the workspace to the
// session's `displaced/<stamp>/`, never deleted. While the turn runs the
// workspace holds the link in its place; when the turn ends the link is gone
// and the displaced bytes are still there.
//
// The workspace is a real git work tree (harness/git-workspace.ts), the case
// the rule exists for: a write-back commits everything the tree holds, so the
// stray entry must leave the tree, not sit beside the link. The fixture
// excludes `.stigmer` from git, so the stray file is written with fs, not
// seeded through git. The runner is spawned by this harness on this host on
// every execution target, so its home is readable here on each of them.
//
// Deliberately out of scope, pinned beside the code in stigmer-link.test.ts:
// the empty directory that is simply removed, the refusal to displace a
// `.stigmer` that holds the platform dir, and the cross-filesystem copy.
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import { lstat, mkdir, readdir, readFile, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { GitWorkspace, requireGit } from "../harness/git-workspace";
import type { MockLlmProxy } from "@stigmer/test-support/mock-llm";
import { anthropicText } from "@stigmer/test-support/mock-llm";
import { makeAgent } from "../support/agents";
import { awaitTerminal, makeAgentExecution, requireLlmProxy } from "../support/agentexecutions";
import { pollUntil } from "../support/execution-poll";
import { uniqueName } from "../support/naming";
import { makeSession } from "../support/sessions";
import { makeSkillArtifact } from "../support/skills";
import { createTarget, type TargetProfile } from "../targets";

// The workspace-visible name the platform owns (stigmer-link.ts
// STIGMER_LOCAL_STATE_DIR).
const LINK_NAME = ".stigmer";

// The stray file a user (or a shell command on a turn with no link) left there.
const STRAY_FILE = "notes.md";
const STRAY_BYTES = "# Kept by hand\n\nThe platform must never lose this.\n";

// The displacement stamp's shape (stigmer-link.ts displacementStamp): a
// compact UTC ISO time with milliseconds.
const STAMP_PATTERN = /^\d{8}T\d{9}Z$/;

// How long the turn's only model response is held open, so the link can be
// read while the turn runs; released as soon as it has been.
const HOLD_MS = 60_000;

let target: TargetProfile;
let clients: ConformanceClients;
let mock: MockLlmProxy;
const fixtures = new FixtureTracker();

beforeAll(async () => {
  await requireGit();
  target = createTarget();
  await target.setup();
  clients = target.clients();
  mock = requireLlmProxy(target);
});

afterEach(async () => {
  mock.releaseHolds();
  await fixtures.cleanup();
  mock.reset();
});

afterAll(async () => {
  await target?.teardown();
});

// The session's tree under the runner's home (platform-dir.ts), never under
// this process's own home.
function sessionDir(sessionId: string): string {
  if (target.runnerHomeDir === undefined) {
    throw new Error(`target ${target.name} spawns no runner; the workspace-link arm needs its home directory`);
  }
  return join(target.runnerHomeDir(), ".stigmer", "sessions", sessionId);
}

// What sits at the workspace's `.stigmer` now: nothing, the link (resolved to
// its real target), or a real entry.
async function linkState(workspaceDir: string): Promise<{ kind: "absent" } | { kind: "link"; target: string } | { kind: "real" }> {
  const path = join(workspaceDir, LINK_NAME);
  try {
    const entry = await lstat(path);
    return entry.isSymbolicLink() ? { kind: "link", target: await realpath(path) } : { kind: "real" };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { kind: "absent" };
    throw error;
  }
}

// The stamp directories under the session's displaced/ dir, or none yet.
async function displacedStamps(sessionId: string): Promise<string[]> {
  try {
    return await readdir(join(sessionDir(sessionId), "displaced"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

describe("the workspace .stigmer link on a skill turn", () => {
  it("moves a real .stigmer the user kept out of the workspace, links in its place while the turn runs, and leaves the moved bytes when it ends", async () => {
    const { org } = await target.provisionTenancy();

    const workspace = await GitWorkspace.create();
    fixtures.defer(() => workspace.cleanup());
    await mkdir(join(workspace.dir, LINK_NAME));
    await writeFile(join(workspace.dir, LINK_NAME, STRAY_FILE), STRAY_BYTES);

    // A skill is what makes the turn link the workspace (skill-resolver.ts).
    const pushed = await clients.skillCommand.push({
      org,
      artifact: makeSkillArtifact({ name: uniqueName("skill-link") }),
    });
    fixtures.defer(() => clients.skillCommand.delete({ value: pushed.metadata!.id }));
    const agent = await clients.agentCommand.create(
      makeAgent({ org, name: uniqueName("agent-link"), skillRefs: [pushed.metadata!.slug] }),
    );
    fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));
    const instanceId = agent.status?.defaultInstanceId;
    if (instanceId === undefined || instanceId === "") {
      throw new Error("agent create did not provision a default instance");
    }

    const session = await clients.sessionCommand.create(
      makeSession({
        org,
        name: uniqueName("ses-link"),
        agentInstanceId: instanceId,
        harness: Harness.NATIVE,
        localWorkspaces: [{ name: "repo", path: workspace.dir }],
      }),
    );
    const sessionId = session.metadata!.id;
    fixtures.defer(() => clients.sessionCommand.delete({ value: sessionId }));

    mock.enqueue(anthropicText("Done."), { delayMs: HOLD_MS });
    const execution = await clients.agentExecutionCommand.create(
      makeAgentExecution({ org, name: uniqueName("aex-link"), sessionId, message: "Say hello." }),
    );
    const executionId = execution.metadata!.id;
    fixtures.defer(() => clients.agentExecutionCommand.delete({ value: executionId }));

    // While the turn is held, the link stands where the real entry was.
    const during = await pollUntil(
      () => linkState(workspace.dir),
      (state) => state.kind === "link",
      (last, timeoutMs) =>
        `execution ${executionId}: the workspace's ${LINK_NAME} never became the link within ${timeoutMs}ms; last ${JSON.stringify(last)}`,
    );
    const platformDir = await realpath(join(sessionDir(sessionId), "platform"));
    expect(during, `execution ${executionId}: the link points at the session's platform dir`).toEqual({
      kind: "link",
      target: platformDir,
    });

    // The real entry went to displaced/<stamp>/, whole: the file and its bytes.
    const stamps = await displacedStamps(sessionId);
    expect(stamps, `execution ${executionId}: exactly one displacement`).toHaveLength(1);
    expect(stamps[0], `execution ${executionId}: the displacement is named by its stamp`).toMatch(STAMP_PATTERN);
    const displaced = join(sessionDir(sessionId), "displaced", stamps[0]!);
    expect(await readdir(displaced), `execution ${executionId}: the moved entry holds what the user kept`).toEqual([
      STRAY_FILE,
    ]);
    expect(
      await readFile(join(displaced, STRAY_FILE), "utf8"),
      `execution ${executionId}: the user's bytes are unchanged`,
    ).toBe(STRAY_BYTES);

    mock.releaseHolds();
    const final = await awaitTerminal(clients, executionId);
    expect(
      final.status?.phase,
      `execution ${executionId} should complete; reached ${ExecutionPhase[final.status?.phase ?? 0]} (error: ${final.status?.error ?? ""})`,
    ).toBe(ExecutionPhase.EXECUTION_COMPLETED);

    // The turn's end takes the link away (the activity's cleanup, which may
    // trail the terminal status write) and leaves the user's bytes moved.
    await pollUntil(
      () => linkState(workspace.dir),
      (state) => state.kind === "absent",
      (last, timeoutMs) =>
        `execution ${executionId}: the workspace's ${LINK_NAME} was still ${JSON.stringify(last)} ${timeoutMs}ms after the turn ended`,
    );
    expect(
      await readFile(join(displaced, STRAY_FILE), "utf8"),
      `execution ${executionId}: the displaced bytes outlive the turn`,
    ).toBe(STRAY_BYTES);
  });
});
