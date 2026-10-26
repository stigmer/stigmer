/**
 * The eval case's own setup for its try, run once the workspace is
 * the turn's (after the workspace lock) and before the engine starts: the
 * scaffold, the reference folders, the recorded conversation and the
 * case's variables.
 *
 * (The scaffold's `PATH` is the agent shell's own, `shell-env.ts`.)
 *
 * The scaffold. The case's Bash script builds the starting folder, as in
 * Claude Code: it starts in the empty workspace, sees `PATH`, a temporary
 * `HOME` and `TMPDIR` and `TERM=dumb` and nothing else (no run value, no
 * `EVAL_*`), and has 120 seconds. It runs as the agent, through the agent's
 * file service (`agent-fs.ts`), so it has the agent's rights inside the
 * try's sandbox and none of the runner's. The whole suite directory is
 * extracted beside it for its lifetime and removed before the engine
 * starts, so `$(dirname "$0")/../_fixture` reaches a shared fixture as it
 * does in Claude Code, and the agent never sees the suite. A non-zero exit,
 * the limit, or output past SCAFFOLD_MAX_OUTPUT_BYTES on a stream ends the
 * try before the engine starts, scored 0 with "scaffold failed" by the
 * eval.
 *
 * Retries. A marker in the session's platform directory records a
 * finished scaffold, so a retried turn does not run it again on the tree it
 * built. A turn retried before the marker exists empties the try's own
 * workspace first (the `.stigmer` link aside), so the script never runs on
 * a half-made tree. The workspace is the try's own, fresh per try, so there
 * is nothing else in it to keep.
 *
 * Reference folders (`add_dirs`) are written under the session's platform
 * `inputs/`, where both prompt builders list them in `<input_files>` and
 * native file tools refuse writes; the shell can still write there, a
 * departure the guide states. They are rewritten every turn.
 *
 * The recorded conversation is parsed here and handed to the native
 * engine, which resumes it (`execute-deep-agent/turn-setup.ts`); the server
 * never plans such a case on Cursor or Claude. The variables overlay the
 * run's agent values, so the native and Claude shells and the plugin's
 * hooks receive them through the one path every run value takes
 * (`shell-env.ts`).
 */

import { join, posix } from "node:path";
import type { EvalCaseContext } from "@stigmer/apis/ai/stigmer/agentic/run/v1/eval_case_pb";
import { parseTranscript, type TranscriptMessage } from "@stigmer/eval-runtime";
import { AgentExecError, agentFs, agentPathExists } from "../agent-fs.js";
import type { ListedFile } from "../file-mount.js";
import { buildShellEnv } from "../shell-env.js";
import { getPlatformDir } from "../workspace/platform-dir.js";
import { ensureStigmerSymlink, STIGMER_LOCAL_STATE_DIR } from "../workspace/stigmer-link.js";
import { type CaseArchive, CaseArchiveError } from "./case-archive.js";

/** The scaffold's wall-clock limit, the format's. */
export const SCAFFOLD_TIMEOUT_MS = 120_000;

/** The most a scaffold may print on each of its streams; a verbose install or clone stays well under it. */
export const SCAFFOLD_MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

/** Node's code for a process stopped for printing more than its buffer holds. */
const MAX_BUFFER_CODE = "ERR_CHILD_PROCESS_STDIO_MAXBUFFER";

/** Under the session's platform directory: the case's own scratch space. */
const EVAL_CASE_SUBDIR = "eval-case";
/** The marker a finished scaffold leaves. */
const SCAFFOLDED_MARKER = "scaffolded";
const INPUTS_SUBDIR = "inputs";

/** The most bytes of a failed scaffold's output its error quotes. */
const FAILURE_OUTPUT_BYTES = 600;

/** What the try runs with beyond its message. */
export interface PreparedEvalCase {
  /** The reference folders' files, listed to the agent after the conversation's Files. */
  readonly referenceInputs: readonly ListedFile[];
  /** The recorded conversation the native engine resumes; absent when the case has none. */
  readonly history: readonly TranscriptMessage[] | undefined;
  /** The case's `EVAL_*` variables. */
  readonly env: Readonly<Record<string, string>>;
}

/** The setup's answer: ready, or the scaffold's failure in one line. */
export type PrepareOutcome =
  | { readonly kind: "ready"; readonly prepared: PreparedEvalCase }
  | { readonly kind: "scaffold-failed"; readonly detail: string };

/** Prepare the case for its try (the module header). Throws {@link CaseArchiveError} when the archive lacks what the server planned. */
export async function prepareEvalCase(args: {
  readonly context: EvalCaseContext;
  readonly archive: CaseArchive;
  readonly sessionId: string;
  readonly primaryDir: string;
}): Promise<PrepareOutcome> {
  const { context, archive, sessionId, primaryDir } = args;
  const platformDir = getPlatformDir(sessionId);
  const caseDir = join(platformDir, EVAL_CASE_SUBDIR);
  await agentFs().mkdir(caseDir, { recursive: true });

  if (context.scaffoldScript !== "") {
    const failed = await scaffoldOnce(context, archive, caseDir, primaryDir);
    if (failed !== undefined) return { kind: "scaffold-failed", detail: failed };
  }
  const referenceInputs = await writeReferenceDirs(context, archive, platformDir, primaryDir);
  return {
    kind: "ready",
    prepared: { referenceInputs, history: historyOf(context, archive), env: { ...context.env } },
  };
}

/** Run the scaffold unless an earlier attempt of this turn finished it; the failure's detail, or `undefined`. */
async function scaffoldOnce(
  context: EvalCaseContext,
  archive: CaseArchive,
  caseDir: string,
  primaryDir: string,
): Promise<string | undefined> {
  const marker = join(caseDir, SCAFFOLDED_MARKER);
  if (await agentPathExists(marker)) return undefined;
  await emptyWorkspace(primaryDir);

  const suiteRoot = join(caseDir, "suite");
  const home = join(caseDir, "home");
  const tmp = join(caseDir, "tmp");
  try {
    const suite = archive.under(context.suiteDir);
    if (suite.length === 0) {
      throw new CaseArchiveError(context.suiteDir === "" ? "the archive holds no files" : `the archive holds no suite at '${context.suiteDir}'`);
    }
    for (const [relative, bytes] of suite) {
      const path = join(suiteRoot, context.suiteDir, relative);
      await agentFs().mkdir(posix.dirname(path), { recursive: true });
      await agentFs().writeFile(path, bytes);
    }
    const script = join(suiteRoot, context.caseDir, context.scaffoldScript);
    if (archive.read(`${context.caseDir}/${context.scaffoldScript}`) === undefined) {
      throw new CaseArchiveError(`the archive holds no scaffold at '${context.caseDir}/${context.scaffoldScript}'`);
    }
    await agentFs().mkdir(home, { recursive: true });
    await agentFs().mkdir(tmp, { recursive: true });
    const started = Date.now();
    try {
      await agentFs().execFile("bash", [script], {
        cwd: primaryDir,
        env: { PATH: buildShellEnv({})["PATH"] ?? "/usr/local/bin:/usr/bin:/bin", HOME: home, TMPDIR: tmp, TERM: "dumb" },
        replaceEnv: true,
        timeoutMs: SCAFFOLD_TIMEOUT_MS,
        maxBuffer: SCAFFOLD_MAX_OUTPUT_BYTES,
      });
    } catch (err) {
      return failureDetail(err, Date.now() - started);
    }
  } finally {
    for (const dir of [suiteRoot, home, tmp]) await agentFs().rm(dir, { recursive: true, force: true });
  }
  await agentFs().writeFile(marker, "");
  return undefined;
}

/** Remove everything in the try's workspace but the `.stigmer` link. */
async function emptyWorkspace(primaryDir: string): Promise<void> {
  const entries = await agentFs().readdir(primaryDir).catch(() => []);
  for (const entry of entries) {
    if (entry.name === STIGMER_LOCAL_STATE_DIR) continue;
    await agentFs().rm(join(primaryDir, entry.name), { recursive: true, force: true });
  }
}

/**
 * A failed scaffold as one line: how it ended, then the tail of what it
 * printed. The error's code decides first (its output overran, it could not
 * start, it exited); a SIGKILL is the time limit only once `elapsedMs` has
 * reached it, and any other kill is named by its signal.
 */
export function failureDetail(err: unknown, elapsedMs = 0): string {
  if (!(err instanceof AgentExecError)) return err instanceof Error ? err.message : String(err);
  const how =
    err.code === MAX_BUFFER_CODE
      ? `printed more than ${SCAFFOLD_MAX_OUTPUT_BYTES / (1024 * 1024)} MiB`
      : typeof err.code === "string"
        ? `could not start (${err.code})`
        : typeof err.code === "number"
          ? `exit ${err.code}`
          : err.signal === "SIGKILL" && elapsedMs >= SCAFFOLD_TIMEOUT_MS
            ? `timed out after ${SCAFFOLD_TIMEOUT_MS / 1000}s`
            : err.signal !== null
              ? `killed by ${err.signal}`
              : `could not start (${String(err.code)})`;
  const output = Buffer.concat([err.stderr, err.stdout]).toString("utf8").trim();
  if (output === "") return how;
  const tail = output.length > FAILURE_OUTPUT_BYTES ? `…${output.slice(-FAILURE_OUTPUT_BYTES)}` : output;
  return `${how}: ${tail.replace(/\s*\n\s*/g, " ")}`;
}

/** Write the reference folders under `inputs/` and list them as the turn's inputs. */
async function writeReferenceDirs(
  context: EvalCaseContext,
  archive: CaseArchive,
  platformDir: string,
  primaryDir: string,
): Promise<readonly ListedFile[]> {
  if (context.addDirs.length === 0) return [];
  await ensureStigmerSymlink(primaryDir, platformDir);
  const inputs: ListedFile[] = [];
  for (const dir of context.addDirs) {
    const target = join(platformDir, INPUTS_SUBDIR, dir);
    await agentFs().rm(target, { recursive: true, force: true });
    for (const [relative, bytes] of archive.under(`${context.caseDir}/${dir}`)) {
      const path = join(target, relative);
      await agentFs().mkdir(posix.dirname(path), { recursive: true });
      await agentFs().writeFile(path, bytes);
      inputs.push({
        filename: posix.basename(relative),
        relativePath: posix.join(STIGMER_LOCAL_STATE_DIR, INPUTS_SUBDIR, dir, relative),
        sizeBytes: bytes.length,
      });
    }
  }
  return inputs;
}

/** The recorded conversation, parsed as the server checked it. */
function historyOf(context: EvalCaseContext, archive: CaseArchive): readonly TranscriptMessage[] | undefined {
  if (context.historyFile === "") return undefined;
  const path = `${context.caseDir}/${context.historyFile}`;
  const text = archive.text(path);
  if (text === undefined) throw new CaseArchiveError(`the archive holds no history at '${path}'`);
  const parsed = parseTranscript(text, { requirePairing: true });
  if (!parsed.ok) throw new CaseArchiveError(`the history '${path}' cannot be resumed: ${parsed.error}`);
  return parsed.messages;
}
