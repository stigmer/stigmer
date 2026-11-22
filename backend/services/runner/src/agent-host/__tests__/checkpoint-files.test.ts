/**
 * The open agent host's side of a locked host's saved state
 * (`checkpoint-files.ts`): each session's ops land in that session's own
 * `checkpoints.db`, the file the engine has always used; a file is opened at
 * a turn's first op and closed when the runner says the turn settled; and a
 * file that could not be opened is not kept, so the next op tries again.
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CheckpointRowsOp, WireCheckpointRow, WireStoredCheckpoint } from "../../shared/checkpointer/relayed-rows.js";
import { getCheckpointDbPath } from "../../shared/workspace/platform-dir.js";
import { CheckpointFiles } from "../checkpoint-files.js";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "checkpoint-files-"));
  vi.stubEnv("HOME", home);
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(home, { recursive: true, force: true });
});

function row(threadId: string, checkpointId: string): WireCheckpointRow {
  return {
    threadId,
    checkpointNs: "",
    checkpointId,
    parentCheckpointId: null,
    type: "json",
    checkpoint: Buffer.from("{}").toString("base64"),
    metadata: Buffer.from("{}").toString("base64"),
  };
}

const get = (threadId: string): CheckpointRowsOp => ({ op: "get", threadId, checkpointNs: "", checkpointId: null });

describe("a locked host's checkpoint files, on the open host", () => {
  it("stores each session's rows in that session's own file", async () => {
    const files = new CheckpointFiles();
    try {
      await files.serve("ses_a", { op: "put", row: row("thread-ses_a", "cp-1") });
      await files.serve("ses_b", { op: "put", row: row("thread-ses_b", "cp-9") });
      expect(existsSync(getCheckpointDbPath("ses_a"))).toBe(true);
      expect(existsSync(getCheckpointDbPath("ses_b"))).toBe(true);
      const a = (await files.serve("ses_a", get("thread-ses_a"))) as WireStoredCheckpoint;
      expect(a.row.checkpointId).toBe("cp-1");
      expect(await files.serve("ses_b", get("thread-ses_a")), "another session's file holds none of it").toBeNull();
    } finally {
      files.closeAll();
    }
  });

  it("closes a session's file when told, and reopens it at the next turn's first op", async () => {
    const files = new CheckpointFiles();
    await files.serve("ses_a", { op: "put", row: row("thread-ses_a", "cp-1") });
    files.close("ses_a");
    files.close("ses_never_opened");
    const again = (await files.serve("ses_a", get("thread-ses_a"))) as WireStoredCheckpoint;
    expect(again.row.checkpointId, "the next turn reads what the last one saved").toBe("cp-1");
    files.closeAll();
  });

  it("keeps no file it could not open: the next op tries again", async () => {
    const files = new CheckpointFiles();
    // A file where the sessions folder belongs: the folder can't be made.
    mkdirSync(join(home, ".stigmer"), { recursive: true });
    writeFileSync(join(home, ".stigmer", "sessions"), "");
    await expect(files.serve("ses_a", get("thread-ses_a"))).rejects.toThrow();
    // A turn that settles while its file is still failing to open closes nothing, quietly.
    const opening = files.serve("ses_b", get("thread-ses_b"));
    files.close("ses_b");
    await expect(opening).rejects.toThrow();
    rmSync(join(home, ".stigmer", "sessions"));
    expect(await files.serve("ses_a", get("thread-ses_a"))).toBeNull();
    files.closeAll();
  });
});
