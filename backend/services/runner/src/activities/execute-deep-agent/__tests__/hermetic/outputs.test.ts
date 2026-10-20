/**
 * Hermetic: what the agent saves in its outputs folder comes back as Files,
 * through the whole `ExecuteDeepAgent` activity with the real deepagents
 * graph, its routed backend and its approval gate.
 *
 * One turn with file review on (capture mode) in a git workspace: the model
 * saves two reports of one name in two folders of `.stigmer/outputs/` and
 * edits a file of the repository. Pinned:
 *   - both reports are registered, each at its output path, with the bytes
 *     the agent wrote and their hash, before the turn's final write;
 *   - the edit to the repository is reviewed as always, and the outputs are
 *     not: nothing asked, no output in the turn's change set;
 *   - a file written in the repository is not an output.
 * A second turn changes one report and leaves the other: only the changed
 * one comes back. A turn that edits two files of the repository and saves
 * one output returns exactly that one File, and the turn uploads none of
 * the files it wrote to the run's own storage prefix: what it returns is
 * what it saved, never what it edited.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../../../../shared/model-client.js", async () =>
  (await import("../../__test-utils__/scripted-model-module.js")).scriptedModelClientModule(),
);
vi.mock("../../../../client/stigmer-client.js", async () =>
  (await import("../../../../__test-utils__/hermetic-activity.js")).hermeticStigmerClientModule(),
);

import { ScriptedClock, createHermeticEnvironment, type HermeticEnvironment } from "../../../../__test-utils__/hermetic-activity.js";
import { initGitWorkspace, localPathEntry } from "../../../../__test-utils__/git-workspace-fixture.js";
import { hermeticUploads, stubRegistryFetch } from "../../../../__test-utils__/model-registry-fixture.js";
import { FIXTURE, beginDeepAgentScenario, deepAgentExecutionRecord, runDeepAgentTurn } from "../../__test-utils__/hermetic-deep-agent.js";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";

const NORTH = "# North\n\nRevenue up.\n";
const SOUTH = "# South\n\nRevenue flat.\n";

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

describe("ExecuteDeepAgent hermetic — the outputs folder", () => {
  let env: HermeticEnvironment;
  let registry: ReturnType<typeof stubRegistryFetch>;
  const clock = new ScriptedClock();

  beforeAll(() => {
    env = createHermeticEnvironment();
    registry = stubRegistryFetch();
    clock.install();
  });

  afterAll(() => {
    clock.uninstall();
    registry.restore();
    env.dispose();
  });

  it("returns what the agent saved there as Files before the final write, and reviews only the repository's edit", async () => {
    const repo = join(env.workspaceRootDir, "repos", "ledger");
    initGitWorkspace(repo, { "notes.md": "first\n" });
    const record = deepAgentExecutionRecord({
      message: "Write the regional summaries.",
      resources: [localPathEntry("ledger", repo)],
      fileReview: true,
    });
    const scenario = beginDeepAgentScenario({
      env,
      clock,
      record,
      script: () => ({
        turns: [
          {
            text: "Saving the summaries.",
            toolCalls: [
              { id: "call-out-north", name: "write_file", args: { file_path: "/.stigmer/outputs/reports/north/summary.md", content: NORTH } },
              { id: "call-out-south", name: "write_file", args: { file_path: "/.stigmer/outputs/reports/south/summary.md", content: SOUTH } },
              { id: "call-repo-edit", name: "edit_file", args: { file_path: "/notes.md", old_string: "first\n", new_string: "first\nsecond\n" } },
            ],
            usage: { inputTokens: 1_300, outputTokens: 60 },
          },
          { text: "Saved both summaries.", usage: { inputTokens: 1_500, outputTokens: 10 } },
        ],
      }),
    });

    const invocation = await runDeepAgentTurn(scenario);

    expect((invocation.outcome as { value: Record<string, unknown> }).value.phase).toBe("RUN_COMPLETED");
    expect(record.waitingToolCalls(), "nothing asked").toHaveLength(0);
    expect(record.registeredOutputs.map((o) => [o.outputPath, o.contentSha256])).toEqual([
      ["reports/north/summary.md", sha256(NORTH)],
      ["reports/south/summary.md", sha256(SOUTH)],
    ]);
    for (const output of record.registeredOutputs) {
      const sent = new TextDecoder().decode(hermeticUploads.get(`/${output.uploadRef}`));
      expect(sent, output.outputPath).toBe(output.outputPath.includes("north") ? NORTH : SOUTH);
      expect(output.persistedBefore, "registered before the final write").toBeLessThan(record.persisted.length);
    }
    const last = record.persisted[record.persisted.length - 1];
    expect(last?.phase).toBe(RunPhase.RUN_COMPLETED);

    const reviewed = (record.rowsOf(record.lastFullStatus!).fileReviewEventStream?.events ?? []).map((e) => JSON.stringify(e));
    expect(reviewed.join("\n"), "the repository's edit is reviewed").toContain("notes.md");
    expect(reviewed.join("\n"), "no output is reviewed").not.toContain("summary.md");
    expect(readFileSync(join(repo, "notes.md"), "utf8")).toBe("first\nsecond\n");
  });

  it("returns exactly the one File a turn saved, never the two files it edited", async () => {
    const repo = join(env.workspaceRootDir, "repos", "ledger-edits");
    initGitWorkspace(repo, { "src/a.ts": "export const a = 1;\n", "src/b.ts": "export const b = 1;\n" });
    const record = deepAgentExecutionRecord({ message: "Bump both and write the release note.", resources: [localPathEntry("ledger", repo)] });
    const scenario = beginDeepAgentScenario({
      env,
      clock,
      record,
      script: () => ({
        turns: [
          {
            text: "Editing and saving the note.",
            toolCalls: [
              { id: "call-edit-a", name: "edit_file", args: { file_path: "/src/a.ts", old_string: "a = 1", new_string: "a = 2" } },
              { id: "call-edit-b", name: "write_file", args: { file_path: "/src/b.ts", content: "export const b = 2;\n" } },
              { id: "call-note", name: "write_file", args: { file_path: "/.stigmer/outputs/release-note.md", content: "# Release\n" } },
            ],
            usage: { inputTokens: 1_200, outputTokens: 40 },
          },
          { text: "Done.", usage: { inputTokens: 1_300, outputTokens: 5 } },
        ],
      }),
    });

    const invocation = await runDeepAgentTurn(scenario);

    expect((invocation.outcome as { value: Record<string, unknown> }).value.phase).toBe("RUN_COMPLETED");
    expect(readFileSync(join(repo, "src", "b.ts"), "utf8")).toBe("export const b = 2;\n");
    expect(record.registeredOutputs.map((o) => o.outputPath)).toEqual(["release-note.md"]);
    const runPrefix = join(env.artifactPath, "artifacts", record.executionId);
    const uploadedFiles = existsSync(runPrefix) ? readdirSync(runPrefix, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name) : [];
    expect(uploadedFiles, "no file the turn wrote is uploaded beside its File").toEqual([]);
  });

  it("returns only what changed on the next turn", async () => {
    const repo = join(env.workspaceRootDir, "repos", "ledger-2");
    initGitWorkspace(repo, { "notes.md": "first\n" });
    const write = (id: string, path: string, content: string) => ({ id, name: "write_file", args: { file_path: path, content } });
    const turnOf = (calls: ReturnType<typeof write>[]) => {
      const record = deepAgentExecutionRecord({ message: "Update the summaries.", resources: [localPathEntry("ledger", repo)] });
      return {
        record,
        scenario: beginDeepAgentScenario({
          env,
          clock,
          record,
          script: () => ({
            turns: [
              { text: "Saving.", toolCalls: calls, usage: { inputTokens: 1_000, outputTokens: 20 } },
              { text: "Done.", usage: { inputTokens: 1_100, outputTokens: 5 } },
            ],
          }),
        }),
      };
    };

    const first = turnOf([
      write("c1", "/.stigmer/outputs/a.md", "a\n"),
      write("c2", "/.stigmer/outputs/b.md", "b\n"),
    ]);
    await runDeepAgentTurn(first.scenario);
    expect(first.record.registeredOutputs.map((o) => o.outputPath)).toEqual(["a.md", "b.md"]);

    const second = turnOf([write("c3", "/.stigmer/outputs/b.md", "b, revised\n")]);
    await runDeepAgentTurn(second.scenario);
    expect(second.record.registeredOutputs.map((o) => [o.outputPath, o.contentSha256])).toEqual([["b.md", sha256("b, revised\n")]]);
    expect(FIXTURE.sessionId, "one conversation, one outputs folder").toBeTruthy();
  });
});
