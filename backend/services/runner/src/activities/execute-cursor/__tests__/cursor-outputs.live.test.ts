/**
 * Live: the real Cursor SDK saves a file in the outputs folder through the
 * workspace's `.stigmer` link, past the runner's own gate (`workspace-setup.ts`,
 * `hook-script.ts`), and the runtime's collector finds it there.
 *
 * One turn, one real model, in a git workspace in capture mode, the gate
 * holding the turn's outputs folder (`outputsRoot`) as a turn's setup does
 * (`turn-setup.ts` `platformOutputsRoot`). The model is asked to save a
 * report under a subfolder of `.stigmer/outputs/` with its file tool.
 * Pinned: the bytes land in the platform folder's `outputs/`, never in the
 * workspace's own tree; the gate let the write through and recorded no
 * denial; nothing was staged for file review; and the collector returns it
 * at its output path through a stand-in door.
 *
 * Live class (`*.live.test.ts`): runs only through `npm run test:live`;
 * skips without `CURSOR_API_KEY` outside the live lane
 * (`src/__test-utils__/live-gate.ts`). One short turn, real credits.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { create } from "@bufbuild/protobuf";
import { FileSchema } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import { OutputUploadSchema } from "@stigmer/apis/ai/stigmer/agentic/file/v1/run_files_pb";
import { describe, expect, it, vi } from "vitest";
import { liveSecret } from "../../../__test-utils__/live-gate.js";
import { mockStigmerClient } from "../../../__test-utils__/mock-client.js";
import { collectOutputs } from "../../../shared/outputs.js";
import { getPlatformDir } from "../../../shared/workspace/platform-dir.js";
import { buildApprovalState } from "../approval-state.js";
import { CAS_OBSERVATIONS_DIRNAME } from "../cas-observations.js";
import { installHitlGate, removeHitlGate } from "../workspace-setup.js";
import { workspaceFolders } from "../workspace-hook-files.js";

const CURSOR_API_KEY = liveSecret("CURSOR_API_KEY") ?? "";
const REPORT = "Live outputs probe: the quarter closed level.";

describe.skipIf(!liveSecret("CURSOR_API_KEY"))("Cursor engine: the outputs folder through the runner's gate (live)", () => {
  it("saves a report in .stigmer/outputs/ through the link, uncaptured, and the collector returns it", async () => {
    const { Agent } = await import("@cursor/sdk");
    const { SqliteLocalAgentStore } = await import("@cursor/sdk/sqlite");

    const home = mkdtempSync(join(tmpdir(), "stigmer-outputs-live-home-"));
    const previousHome = process.env.HOME;
    process.env.HOME = home;
    const sessionId = "ses_outputs_live";
    const workspaceRoot = mkdtempSync(join(tmpdir(), "stigmer-outputs-live-"));
    const stateRoot = mkdtempSync(join(tmpdir(), "stigmer-outputs-live-state-"));
    const hitlDir = mkdtempSync(join(tmpdir(), "stigmer-outputs-live-hitl-"));
    execFileSync("git", ["init", "-q"], { cwd: workspaceRoot });
    execFileSync("git", ["commit", "-q", "--allow-empty", "-m", "init"], {
      cwd: workspaceRoot,
      env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" },
    });
    const platformDir = getPlatformDir(sessionId);
    mkdirSync(join(platformDir, "outputs"), { recursive: true });
    symlinkSync(platformDir, join(workspaceRoot, ".stigmer"), "dir");

    const gate = await installHitlGate({
      workspaceRoot,
      hitlDir,
      approvalState: buildApprovalState(
        { destructive: new Set(), unlisted: new Set<string>(), leasedServers: new Set() },
        false,
        new Set(),
        undefined,
        true,
        true,
        true,
        false,
        undefined,
        true,
        realpathSync(join(platformDir, "outputs")),
      ),
      runnerPid: process.pid,
      folders: workspaceFolders([workspaceRoot], []),
    });

    let status = "";
    try {
      const agent = await Agent.create({
        apiKey: CURSOR_API_KEY,
        model: { id: "claude-sonnet-4-6" },
        local: {
          cwd: workspaceRoot,
          settingSources: ["project"],
          store: await SqliteLocalAgentStore.open({ workspaceRef: `outputs-live-${Date.now()}`, stateRoot }),
          enableAgentRetries: false,
        },
      });
      const run = await agent.send(
        "Using your file-writing tool, not the shell, create the file `.stigmer/outputs/reports/q3.md` containing exactly " +
          `this one line: ${REPORT} Do nothing else, then reply with done.`,
      );
      for await (const _event of run.stream()) {
        /* drain */
      }
      status = (await run.wait()).status;
      agent.close();
    } finally {
      await removeHitlGate(gate);
    }

    try {
      expect(status).toBe("finished");
      const saved = join(platformDir, "outputs", "reports", "q3.md");
      expect(existsSync(saved), "the write landed in the platform folder's outputs").toBe(true);
      expect(readFileSync(saved, "utf8")).toContain(REPORT);
      expect(existsSync(join(workspaceRoot, "reports")), "nothing in the workspace's own tree").toBe(false);
      const ledger = join(hitlDir, "denials.jsonl");
      expect(existsSync(ledger) ? readFileSync(ledger, "utf8").trim() : "", "the gate refused nothing").toBe("");
      const observations = join(hitlDir, CAS_OBSERVATIONS_DIRNAME);
      expect(existsSync(observations) ? readdirSync(observations) : [], "nothing staged for review").toEqual([]);

      const registered: string[] = [];
      const client = mockStigmerClient({
        acquireScopedRunnerToken: vi.fn().mockResolvedValue(undefined),
        createOutputUploads: vi.fn(async (_run: string, entries: ReadonlyArray<{ outputPath: string }>) =>
          entries.map((e) => create(OutputUploadSchema, { outputPath: e.outputPath, uploadRef: "fup_live", url: "data:,", ttlSeconds: 60 })),
        ),
        registerOutputs: vi.fn(async (_run: string, entries: ReadonlyArray<{ outputPath: string }>) => {
          registered.push(...entries.map((e) => e.outputPath));
          return entries.map((e) => create(FileSchema, { metadata: { id: "file_live" }, status: { outputPath: e.outputPath } }));
        }),
      });
      const realFetch = globalThis.fetch;
      vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) =>
        String(input) === "data:," ? new Response(null, { status: 200 }) : realFetch(input, init),
      ));
      try {
        await collectOutputs({ client, executionId: "run_outputs_live", sessionId });
      } finally {
        vi.unstubAllGlobals();
      }
      expect(registered).toEqual(["reports/q3.md"]);
    } finally {
      process.env.HOME = previousHome;
    }
  }, 600_000);
});
