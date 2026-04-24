import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

// ---------------------------------------------------------------------------
// Types matching the Rust sidecar module's serialized structs
// ---------------------------------------------------------------------------

export interface LocalRunnerInfo {
  name: string;
  runner_id: string;
  slug: string;
  org: string;
  backend_endpoint: string;
  pid: number;
  task_queue: string;
  started_at: string;
  managed_by_daemon: boolean;
  managed_by_desktop: boolean;
}

export interface RunnerStartedPayload {
  name: string;
  pid: number;
}

export interface RunnerStoppedPayload {
  name: string;
  exit_code: number | null;
}

export interface RunnerLogPayload {
  name: string;
  line: string;
  stream: "stdout" | "stderr";
}

export interface RunnerErrorPayload {
  name: string;
  message: string;
}

export interface StartRunnerOptions {
  name?: string;
  endpoint?: string;
  token?: string;
}

// ---------------------------------------------------------------------------
// Typed invoke wrappers for the Rust Tauri commands
// ---------------------------------------------------------------------------

export function invokeStartRunner(
  opts: StartRunnerOptions,
): Promise<string> {
  return invoke<string>("start_runner", {
    name: opts.name ?? null,
    endpoint: opts.endpoint ?? null,
    token: opts.token ?? null,
  });
}

export function invokeStopRunner(runnerName: string): Promise<void> {
  return invoke<void>("stop_runner", { runnerName });
}

export function invokeStopAllRunners(): Promise<void> {
  return invoke<void>("stop_all_runners");
}

export function invokeListLocalRunners(): Promise<LocalRunnerInfo[]> {
  return invoke<LocalRunnerInfo[]>("list_local_runners");
}

export function invokeGetRunnerLogs(
  runnerName: string,
  tail?: number,
): Promise<string[]> {
  return invoke<string[]>("get_runner_logs", {
    runnerName,
    tail: tail ?? null,
  });
}

// ---------------------------------------------------------------------------
// Typed event listeners
// ---------------------------------------------------------------------------

export function onRunnerStarted(
  handler: (payload: RunnerStartedPayload) => void,
): Promise<UnlistenFn> {
  return listen<RunnerStartedPayload>("runner:started", (e) =>
    handler(e.payload),
  );
}

export function onRunnerStopped(
  handler: (payload: RunnerStoppedPayload) => void,
): Promise<UnlistenFn> {
  return listen<RunnerStoppedPayload>("runner:stopped", (e) =>
    handler(e.payload),
  );
}

export function onRunnerLog(
  handler: (payload: RunnerLogPayload) => void,
): Promise<UnlistenFn> {
  return listen<RunnerLogPayload>("runner:log", (e) =>
    handler(e.payload),
  );
}

export function onRunnerError(
  handler: (payload: RunnerErrorPayload) => void,
): Promise<UnlistenFn> {
  return listen<RunnerErrorPayload>("runner:error", (e) =>
    handler(e.payload),
  );
}
