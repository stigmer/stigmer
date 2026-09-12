/**
 * A hermetic git work tree and the session workspace entry that mounts it —
 * the substrate every file-review (capture-mode) scenario stands on, whatever
 * harness runs the turn.
 *
 * Harness-agnostic: the runtime's capture reads a git tree the same way for
 * every engine, so the fixture lives beside `hermetic-activity.ts` and is
 * imported by each harness's driver (`execute-cursor/__test-utils__/
 * hermetic-cursor.ts`, `execute-deep-agent/__test-utils__/hermetic-deep-
 * agent.ts`). Author, committer and both dates are pinned so the commit AND
 * tree object ids are byte-stable — a file-review golden may carry them.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { create } from "@bufbuild/protobuf";
import {
  LocalPathSourceSchema,
  WorkspaceEntrySchema,
  WorkspaceSourceSchema,
  type WorkspaceEntry,
} from "@stigmer/protos/ai/stigmer/agentic/session/v1/workspace_pb";

/** A git work tree with the given files committed once, on `main`. */
export function initGitWorkspace(root: string, files: Record<string, string>): void {
  mkdirSync(root, { recursive: true });
  const gitEnv = {
    ...process.env,
    GIT_AUTHOR_NAME: "hermetic",
    GIT_AUTHOR_EMAIL: "hermetic@stigmer.test",
    GIT_COMMITTER_NAME: "hermetic",
    GIT_COMMITTER_EMAIL: "hermetic@stigmer.test",
    GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z",
    GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z",
  };
  const git = (args: string[]): void => {
    execFileSync("git", args, { cwd: root, env: gitEnv, stdio: "ignore" });
  };
  git(["init", "-q", "-b", "main"]);
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content, "utf-8");
  }
  git(["add", "-A"]);
  git(["commit", "-q", "-m", "initial"]);
}

/** A session workspace entry mounting an absolute local path (local mode only). */
export function localPathEntry(name: string, path: string): WorkspaceEntry {
  return create(WorkspaceEntrySchema, {
    name,
    source: create(WorkspaceSourceSchema, {
      source: { case: "localPath", value: create(LocalPathSourceSchema, { path }) },
    }),
  });
}
