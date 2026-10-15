// Eval fixtures for the conformance suite: an eval is an evals/ folder in
// Claude Code's plugin-eval format pushed whole, its cases at the archive's
// root. The working agent's own suite (fixtures/working-agent/evals) is the
// representative folder; a one-case folder is the cheap row the role cells
// and the rename table push. One deterministic zipper (skills.ts) turns a
// file map into the archive, so the same map is the same digest.
// Domain: conformance support (agentic / eval).
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { zipFiles } from "./skills";
import { WORKING_AGENT_FIXTURE_DIR } from "./working-agent";

/** The working agent's evals/ folder as a file map, its paths relative to the folder. */
export function workingAgentEvalFiles(): Record<string, Uint8Array> {
  const root = join(WORKING_AGENT_FIXTURE_DIR, "evals");
  const files: Record<string, Uint8Array> = {};
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) walk(join(dir, entry.name), path);
      else if (entry.isFile()) files[path] = new Uint8Array(readFileSync(join(dir, entry.name)));
    }
  };
  walk(root, "");
  return files;
}

/** The cases the working agent's folder holds, by name, in directory order. */
export const WORKING_AGENT_EVAL_CASES = [
  "code-review-no-edit",
  "config-fix",
  "data-summary",
  "fix-bug-with-test",
  "multi-part-change",
  "refine-over-turns",
  "repo-question",
  "support-policy",
  "tool-lookup",
] as const;

/** A file map as the archive `EvalCommandController.push` takes. */
export function evalArchive(files: Record<string, Uint8Array | string>): Uint8Array {
  return zipFiles(files);
}

const JUDGE = "---\ntype: llm\n---\n\nPASS if the reply answers the question.\n";

/** A folder holding one case that loads, its prompt `prompt`. */
export function oneCaseEvalArchive(prompt: string): Uint8Array {
  return evalArchive({ "answers/prompt.md": prompt, "answers/graders/judge.md": JUDGE });
}

/** Lowercase hex SHA-256 of an archive: the version digest the server records. */
export function digestOf(archive: Uint8Array): string {
  return createHash("sha256").update(archive).digest("hex");
}
