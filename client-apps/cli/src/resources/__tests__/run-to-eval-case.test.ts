// Pins `runs to-eval-case`: the run's request becomes prompt.md under
// <dir>/<name>, named after the request unless --name says otherwise; the
// rubric's FAIL line comes from the judge's failing reason, else a plugin
// eval's failing check, else a person's thumbs-down comment; --skill adds the
// skill check; a run that continued a conversation is noted; an existing
// case directory, a bad --name and a bad --skill are refused before anything
// is written.

import { create } from "@bufbuild/protobuf";
import { timestampFromMs } from "@bufbuild/protobuf/wkt";
import { RunSchema, type Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { ScoreSchema, type Score } from "@stigmer/protos/ai/stigmer/agentic/score/v1/api_pb";
import { CriterionResult, ScoreSource } from "@stigmer/protos/ai/stigmer/agentic/score/v1/enum_pb";
import type { Stigmer } from "@stigmer/sdk";
import { describe, expect, it } from "vitest";
import { UsageError } from "../../errors/index.js";
import { writeEvalCaseFromRun, type CaseFolderIo } from "../run-to-eval-case.js";

function runAt(id: string, ms: number, message = "Look over my diff and find the bug."): Run {
  return create(RunSchema, {
    metadata: { id },
    spec: { message, target: { case: "sessionId", value: "ses_1" } },
    status: { audit: { specAudit: { createdAt: timestampFromMs(ms) } } },
  });
}

function fakeClient(run: Run, scores: Score[], sessionRuns: Run[] = [run]): Stigmer {
  return {
    run: {
      get: async () => run,
      listBySession: async () => ({ entries: sessionRuns }),
    },
    score: { listByRun: async () => ({ items: scores }) },
  } as unknown as Stigmer;
}

function fakeFolder(existing: string[] = []) {
  const files = new Map<string, string>();
  let stderr = "";
  const io: CaseFolderIo = {
    exists: async (path) => existing.includes(path),
    writeFile: async (path, content) => void files.set(path, content),
    stderr: { write: (text) => void (stderr += text) },
  };
  return { io, files, err: () => stderr };
}

const judgeFailed = create(ScoreSchema, {
  spec: {
    source: ScoreSource.judge,
    metric: "judge",
    criteria: [{ name: "did-the-task", result: CriterionResult.failed, reason: "missed the off-by-one" }],
  },
});

const thumbsDown = create(ScoreSchema, {
  spec: { source: ScoreSource.human, metric: "feedback", value: { case: "passed", value: false }, comment: "wrong file" },
});

describe("writeEvalCaseFromRun", () => {
  it("writes the case under evals/<name from the request>, the FAIL line from the judge", async () => {
    const folder = fakeFolder();
    const dir = await writeEvalCaseFromRun(fakeClient(runAt("run_1", 10), [thumbsDown, judgeFailed]), "run_1", {}, folder.io);
    expect(dir).toBe("evals/look-over-my-diff-and-find-the-bug");
    expect([...folder.files.keys()]).toEqual([
      "evals/look-over-my-diff-and-find-the-bug/prompt.md",
      "evals/look-over-my-diff-and-find-the-bug/graders/criteria.md",
    ]);
    expect(folder.files.get(`${dir}/prompt.md`)).toContain("Look over my diff and find the bug.\n");
    expect(folder.files.get(`${dir}/graders/criteria.md`)).toContain("made from: missed the off-by-one.");
    expect(folder.err()).toContain("Fill in the PASS line");
    expect(folder.err()).not.toContain("Note:");
  });

  it("takes a plugin eval's failing check, else the thumbs-down comment", async () => {
    const evalFailed = create(ScoreSchema, {
      spec: {
        source: ScoreSource.eval,
        criteria: [{ name: "mentions-callers", result: CriterionResult.failed, reason: "named no call site" }],
      },
    });
    const first = fakeFolder();
    await writeEvalCaseFromRun(fakeClient(runAt("run_1", 10), [thumbsDown, evalFailed]), "run_1", { name: "a" }, first.io);
    expect(first.files.get("evals/a/graders/criteria.md")).toContain("made from: named no call site.");
    const second = fakeFolder();
    await writeEvalCaseFromRun(fakeClient(runAt("run_1", 10), [thumbsDown]), "run_1", { name: "a" }, second.io);
    expect(second.files.get("evals/a/graders/criteria.md")).toContain("made from: wrong file.");
  });

  it("honours --dir, --name and --skill", async () => {
    const folder = fakeFolder();
    await writeEvalCaseFromRun(
      fakeClient(runAt("run_1", 10), []),
      "run_1",
      { dir: "suite/", name: "finds-bug", skill: "thermos:review" },
      folder.io,
    );
    expect([...folder.files.keys()]).toContain("suite/finds-bug/graders/skill-fired.md");
  });

  it("notes a run that continued a conversation", async () => {
    const folder = fakeFolder();
    const run = runAt("run_2", 20);
    await writeEvalCaseFromRun(fakeClient(run, [], [runAt("run_1", 10), run]), "run_2", { name: "a" }, folder.io);
    expect(folder.err()).toContain("Note: built from the last request; resumed conversations are not run yet.");
  });

  it("refuses an existing case directory, a bad name and a bad skill, writing nothing", async () => {
    const client = fakeClient(runAt("run_1", 10), []);
    const taken = fakeFolder(["evals/a"]);
    await expect(writeEvalCaseFromRun(client, "run_1", { name: "a" }, taken.io)).rejects.toThrow("evals/a already exists");
    await expect(writeEvalCaseFromRun(client, "run_1", { name: "Bad Name" }, taken.io)).rejects.toBeInstanceOf(UsageError);
    await expect(writeEvalCaseFromRun(client, "run_1", { skill: "review" }, taken.io)).rejects.toThrow("<plugin>:<skill>");
    expect(taken.files.size).toBe(0);
  });
});
