/**
 * Pins the hook process runner (`run.ts`) on real processes: exec form runs
 * without a shell and shell form in bash; stdin is the call; the output is
 * capped; a timeout or the turn's stop kills the whole process group (a
 * forked child included); a command that exits while a helper it started
 * still holds the pipes answers at once and the helper lives on; a command
 * that cannot start says so; and a running hook pulses the turn's activity.
 */

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACTIVITY_PULSE_MS, activityPulseFor, hookTimeoutMs, OUTPUT_CAP_BYTES, runHookProcess, type HookProcessSpec } from "../run.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "hook-run-"));
});
afterEach(() => {
  vi.useRealTimers();
  rmSync(dir, { recursive: true, force: true });
});

const spec = (overrides: Partial<HookProcessSpec>): HookProcessSpec => ({
  command: "true",
  args: null,
  timeoutSeconds: 10,
  cwd: dir,
  env: { PATH: process.env["PATH"] ?? "/usr/bin:/bin" },
  stdin: "",
  ...overrides,
});

describe("runHookProcess", () => {
  it("runs shell form in bash, in the workspace, with stdin and the environment", async () => {
    const result = await runHookProcess(
      spec({ command: 'read -r line; printf "%s|%s|%s" "$line" "$PWD" "$GREETING"; echo oops >&2; exit 3', env: { PATH: process.env["PATH"] ?? "", GREETING: "hi" }, stdin: '{"tool_name":"Bash"}' }),
      {},
    );
    expect(result.exitCode).toBe(3);
    const [input, cwd, greeting] = result.stdout.split("|");
    expect(input).toBe('{"tool_name":"Bash"}');
    // macOS reports the temporary directory through its /private link.
    expect(cwd?.endsWith(basename(dir))).toBe(true);
    expect(greeting).toBe("hi");
    expect(result.stderr.trim()).toBe("oops");
    expect(result.timedOut).toBe(false);
  });

  it("runs exec form with no shell: its arguments are not re-parsed", async () => {
    const result = await runHookProcess(spec({ command: "printf", args: ["%s", "$HOME; echo injected"] }), {});
    expect(result.stdout).toBe("$HOME; echo injected");
  });

  it("caps each output stream", async () => {
    const result = await runHookProcess(spec({ command: `head -c ${OUTPUT_CAP_BYTES + 4096} /dev/zero | tr '\\0' 'a'` }), {});
    expect(result.stdout.length).toBe(OUTPUT_CAP_BYTES);
  });

  it("kills the whole process group on timeout, a forked child included", async () => {
    const marker = join(dir, "survived");
    const result = await runHookProcess(spec({ command: `(sleep 2; touch ${marker}) & sleep 30`, timeoutSeconds: 1 }), {});
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 2500));
    expect(existsSync(marker)).toBe(false);
  });

  it("answers as soon as the command exits, leaving a helper it started running", async () => {
    const marker = join(dir, "helper-ran");
    const started = Date.now();
    const result = await runHookProcess(
      spec({ command: `(sleep 2; touch ${marker}) & printf '%s' '{"decision":"block","reason":"no"}'; exit 0`, timeoutSeconds: 10 }),
      {},
    );
    expect(Date.now() - started).toBeLessThan(1500);
    expect(result).toMatchObject({ exitCode: 0, timedOut: false, stdout: '{"decision":"block","reason":"no"}' });
    await new Promise((resolve) => setTimeout(resolve, 2500));
    expect(existsSync(marker), "the helper was left alone").toBe(true);
  });

  it("kills the command when the turn stops", async () => {
    const controller = new AbortController();
    const running = runHookProcess(spec({ command: "sleep 30" }), { signal: controller.signal });
    setTimeout(() => controller.abort(), 100);
    const result = await running;
    expect(result.exitCode).toBeNull();
    expect(result.timedOut).toBe(false);
  });

  it("does not start a command under a stop that already fired", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await runHookProcess(spec({ command: "sleep 30" }), { signal: controller.signal });
    expect(result.exitCode).toBeNull();
  });

  it("stops cleanly when a command that cannot start meets a stop that already fired", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await runHookProcess(spec({ command: join(dir, "missing"), args: ["x"] }), { signal: controller.signal });
    expect(result.spawnError).toContain("ENOENT");
  });

  it("says when a command cannot start", async () => {
    const result = await runHookProcess(spec({ command: join(dir, "missing"), args: ["x"] }), {});
    expect(result.spawnError).toContain("ENOENT");
    expect(result.exitCode).toBeNull();
  });

  it("does not fail a command that never reads its input", async () => {
    const result = await runHookProcess(spec({ command: "exit 0", stdin: "x".repeat(1024 * 1024) }), {});
    expect(result.exitCode).toBe(0);
  });

  it("pulses at the interval it is given", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const onPulse = vi.fn();
    const running = runHookProcess(spec({ command: "sleep 0.3" }), { onPulse, pulseMs: 100 });
    vi.advanceTimersByTime(350);
    await running;
    expect(onPulse).toHaveBeenCalledTimes(3);
  });

  it("waits a timeout past the timer's limit as long as a timer can, never firing at once", () => {
    expect(hookTimeoutMs(600)).toBe(600_000);
    expect(hookTimeoutMs(4_294_967_295)).toBe(2 ** 31 - 1);
  });

  it("derives the pulse from the stall timeout: a third of it, at most the default", () => {
    expect(activityPulseFor(180_000)).toBe(ACTIVITY_PULSE_MS);
    expect(activityPulseFor(900)).toBe(300);
    expect(activityPulseFor(1)).toBe(1);
  });

  it("pulses the turn's activity while the command lives", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const onPulse = vi.fn();
    const running = runHookProcess(spec({ command: "sleep 0.3" }), { onPulse });
    vi.advanceTimersByTime(ACTIVITY_PULSE_MS * 2);
    await running;
    expect(onPulse).toHaveBeenCalledTimes(2);
  });
});
