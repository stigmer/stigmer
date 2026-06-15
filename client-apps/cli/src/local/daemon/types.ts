// Shared types for the daemon supervisor and its injectable seams.
//
// The supervisor's restart/health policy is the part that must be exhaustively
// testable, so every side effect it performs — spawning a process, reading the
// clock — goes through an interface that tests can fake. The Go daemon's policy
// is only reachable through a full integration run; this design makes it a pure
// unit.

/** How a child terminated. */
export interface ExitInfo {
  code: number | null;
  signal: NodeJS.Signals | null;
}

/** A request to launch one child process. */
export interface SpawnRequest {
  command: string;
  args: string[];
  cwd?: string;
  env: NodeJS.ProcessEnv;
  /** Log file the child's stdout+stderr are appended to. */
  logFile: string;
  /** If set, the host watches stdout for this line and fires onReady once. */
  readinessMarker?: string;
}

/** A live handle to a spawned child. */
export interface ChildHandle {
  readonly pid: number;
  /** True once the child has terminated (and been observed). */
  hasExited(): boolean;
  /** Register the exit callback (invoked once). */
  onExit(cb: (info: ExitInfo) => void): void;
  /** Register the readiness callback (invoked once if a marker was set). */
  onReady(cb: () => void): void;
  /** Signal the child's process group. */
  kill(signal: NodeJS.Signals): void;
}

/** Spawns child processes. The real implementation pipes + tees logs; tests
 * substitute a fake that drives exit/readiness synthetically. */
export interface ProcessHost {
  spawn(request: SpawnRequest): ChildHandle;
}

/** Time source, injectable so policy tests run without real delays. */
export interface Clock {
  /** Current epoch milliseconds. */
  now(): number;
  /** Resolve after `ms` milliseconds. */
  sleep(ms: number): Promise<void>;
}

/**
 * Declarative description of one managed component. `resolve` is called lazily
 * at (re)start time so binary resolution and env construction happen fresh on
 * every attempt — matching the Go daemon's per-start `startFn`.
 */
export interface ComponentSpec {
  name: string;
  pidFile: string;
  /** Critical components abort daemon startup if they fail to start/gate. */
  critical: boolean;
  /** Produce the spawn request for a (re)start. */
  resolve(): SpawnRequest;
  /** Optional post-spawn readiness gate (e.g. the server's gRPC port). */
  gate?: ReadinessGate;
}

/** A post-spawn readiness check with its own deadline. */
export interface ReadinessGate {
  /** Resolves when ready; rejects if the deadline passes or the child exits. */
  wait(handle: ChildHandle): Promise<void>;
  /** Human description for logs/errors. */
  description: string;
}
