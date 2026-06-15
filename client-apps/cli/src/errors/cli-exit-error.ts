// A local error that carries its own exit code and optional remediation hints.
// classify() passes these through verbatim, so command code can fail fast with
// a precise exit code (e.g. "auth required" -> 4) without round-tripping to the
// server. UsageError is the common specialization (exit 2).

export class CliExitError extends Error {
  readonly exitCode: number;
  readonly hints?: readonly string[];

  constructor(message: string, exitCode: number, hints?: readonly string[]) {
    super(message);
    this.name = "CliExitError";
    this.exitCode = exitCode;
    this.hints = hints;
  }
}
