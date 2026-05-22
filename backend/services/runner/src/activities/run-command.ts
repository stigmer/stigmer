/**
 * Run command activities — executes scripts and shell commands.
 *
 * Two activity functions:
 * - RunScript: writes inline code to a temp file, executes via node/python
 * - RunShell: executes a shell command directly
 *
 * Both resolve runtime placeholders (JIT secrets) before execution
 * and capture stdout as the activity result.
 */

import { execFile, exec } from "node:child_process";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { ApplicationFailure } from "@temporalio/activity";
import type { RunCommandConfig } from "../workflow-engine/types.js";
import { startHeartbeat } from "../shared/heartbeat.js";

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

export function createRunCommandActivities() {
  return {
    async RunScript(config: RunCommandConfig): Promise<unknown> {
      const hb = startHeartbeat(10_000, () => ({ phase: "running_script" }));
      try {
        return await runScriptImpl(config);
      } finally {
        hb.stop();
      }
    },
    async RunShell(config: RunCommandConfig): Promise<unknown> {
      const hb = startHeartbeat(10_000, () => ({ phase: "running_shell" }));
      try {
        return await runShellImpl(config);
      } finally {
        hb.stop();
      }
    },
  };
}

async function runScriptImpl(config: RunCommandConfig): Promise<unknown> {
  if (config.mode !== "script") {
    throw ApplicationFailure.nonRetryable("RunScript called with non-script config");
  }

  const language = config.language!;
  const code = config.code!;
  const env = buildEnv(config.environment);

  const ext = language === "js" ? ".js" : ".py";
  const interpreter = language === "js" ? "node" : "python3";

  let tempDir: string | undefined;
  try {
    tempDir = await mkdtemp(join(tmpdir(), "stigmer-run-"));
    const scriptPath = join(tempDir, `script${ext}`);
    await writeFile(scriptPath, code, { mode: 0o600 });

    const args = buildArgsList(config.arguments);
    const { stdout } = await execFileAsync(interpreter, [scriptPath, ...args], {
      env,
      timeout: 300_000,
      maxBuffer: 10 * 1024 * 1024,
    });

    return stdout.trim();
  } catch (err: unknown) {
    if (isExecError(err)) {
      throw ApplicationFailure.nonRetryable(
        `Script execution failed (exit code ${err.code})`,
        "SCRIPT_EXECUTION_FAILED",
        { stderr: err.stderr, stdout: err.stdout, code: err.code },
      );
    }
    throw err;
  } finally {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

async function runShellImpl(config: RunCommandConfig): Promise<unknown> {
  if (config.mode !== "shell") {
    throw ApplicationFailure.nonRetryable("RunShell called with non-shell config");
  }

  const command = config.command!;
  const args = buildArgsList(config.arguments);
  const fullCommand = args.length > 0
    ? `${command} ${args.join(" ")}`
    : command;
  const env = buildEnv(config.environment);

  try {
    const { stdout } = await execAsync(fullCommand, {
      env,
      timeout: 300_000,
      maxBuffer: 10 * 1024 * 1024,
    });

    return stdout.trim();
  } catch (err: unknown) {
    if (isExecError(err)) {
      throw ApplicationFailure.nonRetryable(
        `Shell command failed (exit code ${err.code})`,
        "SHELL_EXECUTION_FAILED",
        { stderr: err.stderr, stdout: err.stdout, code: err.code },
      );
    }
    throw err;
  }
}

function buildEnv(
  taskEnv?: Record<string, string>,
): Record<string, string | undefined> {
  const base = { ...process.env };
  if (taskEnv) {
    for (const [k, v] of Object.entries(taskEnv)) {
      base[k] = v;
    }
  }
  return base;
}

function buildArgsList(args: unknown): string[] {
  if (!args) return [];
  if (Array.isArray(args)) return args.map(String);
  if (typeof args === "object" && args !== null) {
    return Object.values(args).map(String);
  }
  return [String(args)];
}

interface ExecError {
  code?: number;
  stderr?: string;
  stdout?: string;
}

function isExecError(err: unknown): err is ExecError & Error {
  return err instanceof Error && "code" in err;
}
