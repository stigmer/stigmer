/**
 * @regression file-hitl-phase0 — pins file-edit HITL fixes #7, #8, #9 (see _projects/2026-06/20260630.01.file-change-hitl-redesign/tasks/T01_3_regression-manifest.md)
 *
 * Tests the harness-agnostic capture orchestration directly with the deep-agent
 * harness id (the Cursor adapter is covered by execute-cursor/capture-flow.test).
 * Confirms producer parity: the deep-agent authors IDENTICAL ledger entries to
 * Cursor through this seam — only `harness_id` differs — and that with no
 * excludePaths every changed file is captured. Runs against a REAL temp git repo.
 */

import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clone, create } from "@bufbuild/protobuf";
import { AgentExecutionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { AgentExecutionStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import {
  CapturedFileChangeSchema,
  FileChangeSetSchema,
  FileDecisionSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/filereview_pb";
import type { CapturedFileChange } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/filereview_pb";
import {
  FileChangeSetStatus,
  FileDecisionAction,
  FileDecisionScope,
  FileReviewEventType,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import {
  applyCaptureDecisions,
  captureBaselineToLedger,
  captureCandidateToLedger,
} from "../capture.js";

const execFileAsync = promisify(execFile);
const EXEC_ID = "exec-da-1";
const CHANGE_SET_ID = `${EXEC_ID}:0`;
const HARNESS = "deep-agent";

let repo: string;

async function git(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd: repo });
  return stdout;
}
async function read(rel: string): Promise<string> {
  return readFile(join(repo, rel), "utf-8");
}
async function write(rel: string, content: string): Promise<void> {
  await mkdir(join(repo, rel, ".."), { recursive: true });
  await writeFile(join(repo, rel), content, "utf-8");
}

function newStatus(): AgentExecutionStatus {
  return create(AgentExecutionStatusSchema, {});
}
function eventsOfType(status: AgentExecutionStatus, type: FileReviewEventType) {
  return (status.fileReviewEventStream?.events ?? []).filter((e) => e.eventType === type);
}
function candidateChanges(status: AgentExecutionStatus): CapturedFileChange[] {
  const ev = eventsOfType(status, FileReviewEventType.CANDIDATE_CAPTURED)[0];
  return ev?.payload.case === "candidateCaptured" ? ev.payload.value.changes : [];
}
function decidedChangeSet(
  status: AgentExecutionStatus,
  decisionByPath: Record<string, FileDecisionAction>,
) {
  const changes = candidateChanges(status).map((c) => clone(CapturedFileChangeSchema, c));
  const decisions = changes
    .filter((c) => decisionByPath[c.pathAfter || c.pathBefore] !== undefined)
    .map((c) =>
      create(FileDecisionSchema, {
        id: `${c.id}:d`,
        changeSetId: CHANGE_SET_ID,
        scope: FileDecisionScope.FILE,
        fileChangeId: c.id,
        action: decisionByPath[c.pathAfter || c.pathBefore],
        expectedDigest: c.fileDigest,
      }),
    );
  return create(FileChangeSetSchema, {
    id: CHANGE_SET_ID,
    changes,
    decisions,
    status: FileChangeSetStatus.DECIDED,
  });
}

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), "stigmer-da-capture-"));
  await git(["init", "-q"]);
  await git(["config", "user.email", "t@t.local"]);
  await git(["config", "user.name", "t"]);
  await write("notes.md", "platon notes\n");
  await write("src/main.ts", "export const x = 1;\n");
  await git(["add", "-A"]);
  await git(["commit", "-q", "-m", "initial"]);
});

afterEach(async () => {
  await rm(repo, { recursive: true, force: true });
});

describe("capture orchestration — deep-agent harness", () => {
  it("stamps harness_id=deep-agent on BASELINE and authors CANDIDATE with the captured changes", async () => {
    const status = newStatus();
    const baseline = await captureBaselineToLedger({
      status,
      gitRoot: repo,
      executionId: EXEC_ID,
      changeSetId: CHANGE_SET_ID,
      harnessId: HARNESS,
    });

    const baselineEvents = eventsOfType(status, FileReviewEventType.BASELINE_CAPTURED);
    expect(baselineEvents).toHaveLength(1);
    expect(baselineEvents[0].actor).toBe("runner");
    const basePayload = baselineEvents[0].payload;
    expect(basePayload.case).toBe("baselineCaptured");
    if (basePayload.case === "baselineCaptured") {
      // The projection reads turn_id / harness_id ONLY from this payload.
      expect(basePayload.value.changeSetId).toBe(CHANGE_SET_ID);
      expect(basePayload.value.turnId).toBe(CHANGE_SET_ID);
      expect(basePayload.value.harnessId).toBe(HARNESS);
    }

    await write("notes.md", "planton notes\n");
    await write("src/new.ts", "export const y = 2;\n");

    const changes = await captureCandidateToLedger({
      status,
      gitRoot: repo,
      executionId: EXEC_ID,
      changeSetId: CHANGE_SET_ID,
      baselineTree: baseline,
      harnessId: HARNESS,
    });

    expect(changes).toHaveLength(2);
    const cand = candidateChanges(status);
    expect(cand.map((c) => c.pathAfter).sort()).toEqual(["notes.md", "src/new.ts"]);
    expect(cand.find((c) => c.pathAfter === "notes.md")!.id).toBe(`${CHANGE_SET_ID}:notes.md`);
  });

  it("reconciles approve/reject on resume and authors RECONCILED with harness parity", async () => {
    const status = newStatus();
    const baseline = await captureBaselineToLedger({
      status, gitRoot: repo, executionId: EXEC_ID, changeSetId: CHANGE_SET_ID, harnessId: HARNESS,
    });
    await write("notes.md", "planton notes\n");
    await write("src/main.ts", "export const x = 99;\n");
    await captureCandidateToLedger({
      status, gitRoot: repo, executionId: EXEC_ID, changeSetId: CHANGE_SET_ID,
      baselineTree: baseline, harnessId: HARNESS,
    });

    const changeSet = decidedChangeSet(status, {
      "notes.md": FileDecisionAction.APPROVE,
      "src/main.ts": FileDecisionAction.REJECT,
    });

    const result = await applyCaptureDecisions({
      status, gitRoot: repo, executionId: EXEC_ID, changeSet, harnessId: HARNESS,
    });

    expect(result.isCaptureTurn).toBe(true);
    expect(result.failed).toBe(false);
    expect(result.approvedPaths).toEqual(["notes.md"]);
    expect(result.rejectedPaths).toEqual(["src/main.ts"]);

    // Approved kept; rejected snapped back to baseline; nothing committed.
    expect(await read("notes.md")).toBe("planton notes\n");
    expect(await read("src/main.ts")).toBe("export const x = 1;\n");
    expect((await git(["log", "--oneline"])).trim().split("\n")).toHaveLength(1);

    const reconciled = eventsOfType(status, FileReviewEventType.RECONCILED);
    expect(reconciled).toHaveLength(1);
    expect(reconciled[0].actor).toBe("runner");
    expect((await git(["for-each-ref", "refs/stigmer/"])).trim()).toBe("");
  });
});
