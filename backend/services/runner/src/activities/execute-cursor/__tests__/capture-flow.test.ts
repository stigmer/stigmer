/**
 * Tests for capture-mode turn orchestration: the turn-end transform (streamed
 * edits -> per-file cards, tree reverted) and the resume transform (approved
 * files applied, cards flipped). Runs against a REAL temp git repo with
 * in-memory transcript messages.
 */

import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { create } from "@bufbuild/protobuf";
import {
  AgentMessageSchema,
  ToolCallSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import type { AgentMessage } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import {
  ApprovalAction,
  ToolCallStatus,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import {
  applyCaptureDecisions,
  captureTurnForApproval,
  snapshotCaptureBaseline,
} from "../capture-flow.js";

const execFileAsync = promisify(execFile);
const EXEC_ID = "exec-capflow-1";

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
async function exists(rel: string): Promise<boolean> {
  try {
    await stat(join(repo, rel));
    return true;
  } catch {
    return false;
  }
}

/** A streamed (COMPLETED) file-edit tool call, as the SDK would have recorded. */
function streamedEdit(id: string, path: string, content: string): AgentMessage {
  return create(AgentMessageSchema, {
    type: 1, // MESSAGE_AI
    toolCalls: [
      create(ToolCallSchema, {
        id,
        name: "edit",
        status: ToolCallStatus.TOOL_CALL_COMPLETED,
        args: { path, content },
      }),
    ],
  });
}

function captureCards(messages: AgentMessage[]) {
  return messages.flatMap((m) => m.toolCalls).filter((tc) => tc.id.startsWith("capture:"));
}

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), "stigmer-capflow-"));
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

describe("captureTurnForApproval", () => {
  it("reverts the tree, hides streamed edits, and appends one card per changed file", async () => {
    const baseline = await snapshotCaptureBaseline(repo, EXEC_ID);

    // The agent's edits flowed to disk during the turn.
    await write("notes.md", "planton notes\n\n## TODO\n- ship\n");
    await write("src/new.ts", "export const y = 2;\n");
    const messages: AgentMessage[] = [
      streamedEdit("tc-1", "notes.md", "planton notes\n\n## TODO\n- ship\n"),
      streamedEdit("tc-2", "src/new.ts", "export const y = 2;\n"),
    ];

    const changes = await captureTurnForApproval({
      gitRoot: repo,
      executionId: EXEC_ID,
      baselineTree: baseline,
      messages,
      deniedTokens: new Set(),
    });

    expect(changes).toHaveLength(2);

    // Nothing landed: the tree is byte-identical to pre-turn.
    expect(await read("notes.md")).toBe("platon notes\n");
    expect(await exists("src/new.ts")).toBe(false);

    // The streamed edit rows are hidden (collapsed SKIPPED, no fileChanges).
    const streamed = messages
      .flatMap((m) => m.toolCalls)
      .filter((tc) => !tc.id.startsWith("capture:"));
    for (const tc of streamed) {
      expect(tc.status).toBe(ToolCallStatus.TOOL_CALL_SKIPPED);
      expect(tc.fileChanges).toHaveLength(0);
    }

    // One WAITING_APPROVAL card per changed file, carrying the git diff.
    const cards = captureCards(messages);
    expect(cards).toHaveLength(2);
    for (const card of cards) {
      expect(card.status).toBe(ToolCallStatus.TOOL_CALL_WAITING_APPROVAL);
      expect(card.requiresApproval).toBe(true);
      expect(card.fileChanges).toHaveLength(1);
    }
    const notesCard = cards.find((c) => c.id === "capture:notes.md")!;
    expect(notesCard.fileChanges[0].after?.body.value).toBe(
      "planton notes\n\n## TODO\n- ship\n",
    );
  });

  it("creates no card and reverts cleanly when the turn changed nothing", async () => {
    const baseline = await snapshotCaptureBaseline(repo, EXEC_ID);
    const messages: AgentMessage[] = [];
    const changes = await captureTurnForApproval({
      gitRoot: repo,
      executionId: EXEC_ID,
      baselineTree: baseline,
      messages,
      deniedTokens: new Set(),
    });
    expect(changes).toHaveLength(0);
    expect(captureCards(messages)).toHaveLength(0);
  });
});

describe("applyCaptureDecisions (resume)", () => {
  it("applies the approved file, discards the rejected one, flips cards, drops refs", async () => {
    const baseline = await snapshotCaptureBaseline(repo, EXEC_ID);
    await write("notes.md", "planton notes\n");
    await write("src/main.ts", "export const x = 99;\n");
    const messages: AgentMessage[] = [
      streamedEdit("tc-1", "notes.md", "planton notes\n"),
      streamedEdit("tc-2", "src/main.ts", "export const x = 99;\n"),
    ];
    await captureTurnForApproval({
      gitRoot: repo,
      executionId: EXEC_ID,
      baselineTree: baseline,
      messages,
      deniedTokens: new Set(),
    });

    // The backend records the user's decisions on the cards.
    const cards = captureCards(messages);
    cards.find((c) => c.id === "capture:notes.md")!.approvalAction = ApprovalAction.APPROVE;
    cards.find((c) => c.id === "capture:src/main.ts")!.approvalAction = ApprovalAction.REJECT;

    const result = await applyCaptureDecisions({
      gitRoot: repo,
      executionId: EXEC_ID,
      messages,
    });

    expect(result.isCaptureTurn).toBe(true);
    expect(result.approvedPaths).toEqual(["notes.md"]);
    expect(result.rejectedPaths).toEqual(["src/main.ts"]);
    expect(result.hadReject).toBe(true);

    // Approved file applied (uncommitted); rejected file at baseline.
    expect(await read("notes.md")).toBe("planton notes\n");
    expect(await read("src/main.ts")).toBe("export const x = 1;\n");

    // Approved file uncommitted (HEAD unchanged — the harness never commits).
    expect((await git(["log", "--oneline"])).trim().split("\n")).toHaveLength(1);

    // Cards flipped in place.
    expect(cards.find((c) => c.id === "capture:notes.md")!.status).toBe(
      ToolCallStatus.TOOL_CALL_COMPLETED,
    );
    expect(cards.find((c) => c.id === "capture:src/main.ts")!.status).toBe(
      ToolCallStatus.TOOL_CALL_SKIPPED,
    );

    // Refs released.
    expect((await git(["for-each-ref", "refs/stigmer/"])).trim()).toBe("");
  });

  it("returns isCaptureTurn=false when there is no capture ref (non-capture resume)", async () => {
    const result = await applyCaptureDecisions({
      gitRoot: repo,
      executionId: "never-captured",
      messages: [],
    });
    expect(result.isCaptureTurn).toBe(false);
  });
});
