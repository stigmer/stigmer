/**
 * Pins a eval-run try's own setup (`prepare-case.ts`) on real processes
 * and a temporary home: the scaffold runs in the workspace with the
 * format's environment alone and reaches a fixture beside its case; its
 * suite copy, home and temp are gone before the engine; a finished
 * scaffold is not run again, while a retry before the marker starts from an
 * empty workspace; a failure and the time limit come back as one line;
 * reference folders land under `inputs/` as the turn's listed inputs; the
 * recorded conversation and the variables are handed on.
 */

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { create } from "@bufbuild/protobuf";
import { EvalCaseContextSchema, type EvalCaseContext } from "@stigmer/protos/ai/stigmer/agentic/run/v1/eval_case_pb";

import { AgentExecError } from "../../agent-fs.js";
import { getPlatformDir } from "../../workspace/platform-dir.js";
import { caseArchiveOf } from "../case-archive.js";
import { failureDetail, prepareEvalCase, SCAFFOLD_MAX_OUTPUT_BYTES, SCAFFOLD_TIMEOUT_MS } from "../prepare-case.js";

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

const HISTORY = [
  JSON.stringify({ type: "user", message: { role: "user", content: "Draft a release note." } }),
  JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Here it is." }] } }),
].join("\n");

/** The case's own fields of the context. */
interface CaseFields {
  readonly scaffoldScript?: string;
  readonly addDirs?: string[];
  readonly historyFile?: string;
  readonly env?: Record<string, string>;
}

function contextOf(fields: CaseFields): EvalCaseContext {
  return create(EvalCaseContextSchema, {
    pluginId: "plg_1",
    pluginDigest: "a".repeat(64),
    suiteDir: "evals",
    caseDir: "evals/fix",
    ...fields,
  });
}

let home: string;
let workspace: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "eval-case-home-"));
  workspace = mkdtempSync(join(tmpdir(), "eval-case-ws-"));
  vi.stubEnv("HOME", home);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the scaffold", () => {
  const archive = caseArchiveOf([
    {
      path: "evals/fix/setup.sh",
      content: encode(
        [
          'cp "$(dirname "$0")/../_fixture/app.txt" app.txt',
          'printf "%s|%s|%s|%s" "$TERM" "${EVAL_X:-none}" "${SECRET_FROM_RUNNER:-none}" "$HOME" > env.txt',
          "git init -q .",
        ].join("\n"),
      ),
    },
    { path: "evals/_fixture/app.txt", content: encode("fixture") },
    { path: "evals/fix/prompt.md", content: encode("Fix it.") },
  ]);

  it("builds the workspace with the format's environment alone, reaching a fixture beside its case", async () => {
    vi.stubEnv("SECRET_FROM_RUNNER", "leaked");
    const outcome = await prepareEvalCase({
      context: contextOf({ scaffoldScript: "setup.sh", env: { EVAL_X: "1" } }),
      archive,
      sessionId: "s1",
      primaryDir: workspace,
    });
    expect(outcome.kind).toBe("ready");
    expect(readFileSync(join(workspace, "app.txt"), "utf8")).toBe("fixture");
    const [term, evalX, secret, scaffoldHome] = readFileSync(join(workspace, "env.txt"), "utf8").split("|");
    expect([term, evalX, secret]).toEqual(["dumb", "none", "none"]);
    expect(scaffoldHome).not.toBe(home);
    expect(existsSync(join(workspace, ".git"))).toBe(true);
    expect(readdirSync(join(getPlatformDir("s1"), "eval-case"))).toEqual(["scaffolded"]);
  });

  it("is not run again once finished, and a retry before that starts from an empty workspace", async () => {
    const context = contextOf({ scaffoldScript: "setup.sh" });
    await prepareEvalCase({ context, archive, sessionId: "s2", primaryDir: workspace });
    writeFileSync(join(workspace, "agent-wrote.txt"), "kept");
    await prepareEvalCase({ context, archive, sessionId: "s2", primaryDir: workspace });
    expect(existsSync(join(workspace, "agent-wrote.txt"))).toBe(true);

    const fresh = mkdtempSync(join(tmpdir(), "eval-case-ws-"));
    writeFileSync(join(fresh, "half-made.txt"), "from an earlier attempt");
    mkdirSync(join(fresh, ".stigmer"));
    await prepareEvalCase({ context, archive, sessionId: "s3", primaryDir: fresh });
    expect(readdirSync(fresh).sort()).toEqual([".git", ".stigmer", "app.txt", "env.txt"]);
  });

  it("fails with its exit and output in one line, leaving no copy of the suite", async () => {
    const failing = caseArchiveOf([{ path: "evals/fix/setup.sh", content: encode("echo 'no such repo' >&2\nexit 3") }]);
    const outcome = await prepareEvalCase({
      context: contextOf({ scaffoldScript: "setup.sh" }),
      archive: failing,
      sessionId: "s4",
      primaryDir: workspace,
    });
    expect(outcome).toEqual({ kind: "scaffold-failed", detail: "exit 3: no such repo" });
    expect(readdirSync(join(getPlatformDir("s4"), "eval-case"))).toEqual([]);
  });

  it("names the time limit only for a script killed at it, and every other ending by its code or signal", () => {
    const failed = (code: number | string | null, signal: string | null) =>
      new AgentExecError("x", code, signal, Buffer.from(""), Buffer.from(""));
    expect(failureDetail(failed(null, "SIGKILL"), SCAFFOLD_TIMEOUT_MS)).toBe(`timed out after ${SCAFFOLD_TIMEOUT_MS / 1000}s`);
    expect(failureDetail(failed(null, "SIGKILL"), 5_000)).toBe("killed by SIGKILL");
    expect(failureDetail(failed("ERR_CHILD_PROCESS_STDIO_MAXBUFFER", "SIGTERM"))).toBe(
      `printed more than ${SCAFFOLD_MAX_OUTPUT_BYTES / (1024 * 1024)} MiB`,
    );
    expect(failureDetail(failed("ENOENT", null))).toBe("could not start (ENOENT)");
  });

  it("lets a scaffold print more than a process's default buffer", async () => {
    const chatty = caseArchiveOf([
      { path: "evals/fix/setup.sh", content: encode("head -c 3000000 /dev/zero | tr '\\0' a\necho done > app.txt") },
    ]);
    const outcome = await prepareEvalCase({ context: contextOf({ scaffoldScript: "setup.sh" }), archive: chatty, sessionId: "s7", primaryDir: workspace });
    expect(outcome.kind).toBe("ready");
    expect(readFileSync(join(workspace, "app.txt"), "utf8")).toBe("done\n");
  });

  it("reads a failure that is not the script's own as its message", () => {
    expect(failureDetail(new Error("disk full"))).toBe("disk full");
    expect(failureDetail("gone")).toBe("gone");
  });

  it("refuses an archive without the suite or without the script, over a workspace not yet made", async () => {
    const absent = join(workspace, "not-yet");
    await expect(
      prepareEvalCase({ context: contextOf({ scaffoldScript: "setup.sh" }), archive: caseArchiveOf([]), sessionId: "s7", primaryDir: absent }),
    ).rejects.toThrow("the archive holds no suite at 'evals'");
    await expect(
      prepareEvalCase({
        context: contextOf({ scaffoldScript: "setup.sh" }),
        archive: caseArchiveOf([{ path: "evals/fix/prompt.md", content: encode("Fix it.") }]),
        sessionId: "s8",
        primaryDir: absent,
      }),
    ).rejects.toThrow("the archive holds no scaffold at 'evals/fix/setup.sh'");
  });
});

describe("reference folders, history and variables", () => {
  it("writes each folder under inputs/ and lists its files as the turn's inputs", async () => {
    const archive = caseArchiveOf([
      { path: "evals/fix/resources/style.md", content: encode("Use the imperative.") },
      { path: "evals/fix/resources/deep/a.txt", content: encode("A") },
      { path: "evals/fix/h.jsonl", content: encode(HISTORY) },
    ]);
    const outcome = await prepareEvalCase({
      context: contextOf({ addDirs: ["resources"], historyFile: "h.jsonl", env: { EVAL_LEVEL: "2" } }),
      archive,
      sessionId: "s5",
      primaryDir: workspace,
    });
    if (outcome.kind !== "ready") throw new Error("expected the case to be ready");
    expect(outcome.prepared.referenceInputs).toEqual([
      { filename: "a.txt", relativePath: ".stigmer/inputs/resources/deep/a.txt", sizeBytes: 1 },
      { filename: "style.md", relativePath: ".stigmer/inputs/resources/style.md", sizeBytes: 19 },
    ]);
    expect(readFileSync(join(workspace, ".stigmer/inputs/resources/style.md"), "utf8")).toBe("Use the imperative.");
    expect(outcome.prepared.history?.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(outcome.prepared.env).toEqual({ EVAL_LEVEL: "2" });
  });

  it("refuses a history the archive does not hold", async () => {
    await expect(
      prepareEvalCase({ context: contextOf({ historyFile: "missing.jsonl" }), archive: caseArchiveOf([]), sessionId: "s6", primaryDir: workspace }),
    ).rejects.toThrow("the archive holds no history at 'evals/fix/missing.jsonl'");
  });

  it("refuses a history whose tool call is never answered", async () => {
    const unpaired = [
      JSON.stringify({ type: "user", message: { role: "user", content: "Look it up." } }),
      JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "Read", input: {} }] } }),
      JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Done." }] } }),
    ].join("\n");
    await expect(
      prepareEvalCase({
        context: contextOf({ historyFile: "h.jsonl" }),
        archive: caseArchiveOf([{ path: "evals/fix/h.jsonl", content: encode(unpaired) }]),
        sessionId: "s9",
        primaryDir: workspace,
      }),
    ).rejects.toThrow("the history 'evals/fix/h.jsonl' cannot be resumed: ");
  });
});
