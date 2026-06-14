// SDK synthesis execution.
//
// Runs a project's `entry_point` as a subprocess with `STIGMER_OUT_DIR` (and
// `STIGMER_ORG_ID`) set; the program writes `.pb` files into that dir, which the
// reader then decodes. Uniform subprocess model for every runtime (DD-009 §5):
//   go      → `go run <entry>`
//   python  → `python3 <entry>`
//   node    → `npx tsx <entry>` for TS, `node <entry>` for JS
//
// `tsx` (not Go's `ts-node`) executes TypeScript entries — it is the runner the
// cli-ts ecosystem already standardizes on (DD-009 alternatives). The spawn is
// injected so the orchestration is unit-testable without a real subprocess
// (mirrors `connect/oauth.ts`). Port of `internal/cli/apply/synthesize.go`.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { UsageError } from "../../../errors/index.js";
import type { Runtime } from "./runtime.js";

/** Result of running a subprocess to completion. */
export interface SpawnResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** A function that runs a command to completion (injectable for tests). */
export type SpawnFn = (
  command: string,
  args: readonly string[],
  options: { readonly cwd: string; readonly env: NodeJS.ProcessEnv },
) => Promise<SpawnResult>;

/** Inputs for one synthesis run. */
export interface SynthesizeOptions {
  /** Directory containing the SDK code and stigmer.yaml. */
  readonly projectDir: string;
  /** Entry point file, relative to `projectDir`. */
  readonly entryPoint: string;
  /** Runtime inferred from the entry point extension. */
  readonly runtime: Runtime;
  /** Resolved org, injected as STIGMER_ORG_ID (empty = omit). */
  readonly orgId: string;
}

/** Injectable collaborators (defaults run real subprocesses / fs checks). */
export interface SynthesizeDeps {
  readonly spawn?: SpawnFn;
  readonly prepare?: (runtime: Runtime, projectDir: string) => void;
}

/** Outcome of synthesis: where the `.pb` files were written, plus SDK stdout. */
export interface SynthesizeResult {
  readonly outputDir: string;
  readonly stdout: string;
}

/**
 * Execute the SDK entry point and leave the synthesized `.pb` files in
 * `<projectDir>/.stigmer`. Validates inputs, runs runtime prep, spawns the
 * program with the synthesis env, and maps a non-zero exit (or spawn failure)
 * to an actionable error. The caller reads the output dir with the reader.
 */
export async function synthesize(opts: SynthesizeOptions, deps: SynthesizeDeps = {}): Promise<SynthesizeResult> {
  if (opts.projectDir === "") throw new UsageError("project directory is required");
  if (opts.entryPoint === "") throw new UsageError("entry point is required");

  const projectDir = resolve(opts.projectDir);
  if (!existsSync(projectDir)) throw new UsageError(`project directory not found: ${opts.projectDir}`);
  const entryAbs = join(projectDir, opts.entryPoint);
  if (!existsSync(entryAbs)) throw new UsageError(`entry point not found: ${opts.entryPoint}`);

  const outputDir = join(projectDir, ".stigmer");
  mkdirSync(outputDir, { recursive: true });

  (deps.prepare ?? defaultPrepare)(opts.runtime, projectDir);

  // Pass the ABSOLUTE entry path: `npx` resolves a relative entry against the
  // npm project root (its "local prefix"), not the spawn cwd, so a relative path
  // breaks for the node runtime. An absolute path is correct for every runtime;
  // cwd stays the project dir so the program's own relative imports resolve.
  const [command, ...args] = runtimeCommand(opts.runtime, entryAbs);
  const env: NodeJS.ProcessEnv = { ...process.env, STIGMER_OUT_DIR: outputDir };
  if (opts.orgId !== "") env.STIGMER_ORG_ID = opts.orgId;

  let result: SpawnResult;
  try {
    result = await (deps.spawn ?? defaultSpawn)(command, args, { cwd: projectDir, env });
  } catch (err) {
    throw new UsageError(formatExecutionError(opts.runtime, "", (err as Error).message));
  }
  if (result.exitCode !== 0) {
    throw new UsageError(formatExecutionError(opts.runtime, result.stderr, `exited with code ${result.exitCode}`));
  }

  return { outputDir, stdout: result.stdout };
}

/** Command + args to execute an entry point for the given runtime. */
export function runtimeCommand(runtime: Runtime, entryPoint: string): string[] {
  switch (runtime) {
    case "go":
      return ["go", "run", entryPoint];
    case "python":
      return ["python3", entryPoint];
    case "node": {
      const ext = extname(entryPoint).toLowerCase();
      // TypeScript entries run through tsx; plain JS runs on node directly.
      return ext === ".ts" || ext === ".tsx" || ext === ".mts" ? ["npx", "tsx", entryPoint] : ["node", entryPoint];
    }
  }
}

// Lightweight, runtime-specific readiness checks (no subprocess). Unlike Go we
// do NOT auto-run `go mod tidy`; the entry-point run surfaces missing deps and
// the user resolves them — keeping the single subprocess the synthesis itself.
function defaultPrepare(runtime: Runtime, projectDir: string): void {
  if (runtime === "node") {
    if (!existsSync(join(projectDir, "package.json"))) {
      throw new UsageError("package.json not found: run 'npm init' to initialize a Node.js project");
    }
    if (!existsSync(join(projectDir, "node_modules"))) {
      throw new UsageError("node_modules not found: run 'npm install' to install dependencies");
    }
  } else if (runtime === "go" && !existsSync(join(projectDir, "go.mod"))) {
    throw new UsageError("go.mod not found: run 'go mod init' to initialize a Go module");
  }
}

// Real subprocess: collects stdout/stderr, resolves with the exit code.
const defaultSpawn: SpawnFn = (command, args, options) =>
  new Promise<SpawnResult>((resolvePromise, rejectPromise) => {
    const child = spawn(command, [...args], { cwd: options.cwd, env: options.env });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (err) => rejectPromise(err));
    child.on("close", (code) => resolvePromise({ exitCode: code ?? 0, stdout, stderr }));
  });

// Actionable failure message: truncated stderr + runtime-specific guidance.
// Port of Go's formatExecutionError.
function formatExecutionError(runtime: Runtime, stderr: string, fallback: string): string {
  let detail = stderr.length > 800 ? `${stderr.slice(0, 800)}\n... (truncated)` : stderr;
  if (detail === "") detail = fallback;

  const guidance =
    runtime === "go"
      ? "Check for compile errors above. Run 'go build' to see full error output."
      : runtime === "python"
        ? "If you see import errors, install your dependencies (e.g. pip install -r requirements.txt)."
        : "If you see module errors, run 'npm install' to install dependencies.";

  return `SDK synthesis failed:\n${detail}\n\n${guidance}`;
}
