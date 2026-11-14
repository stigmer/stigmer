// A local error that carries its own exit code and optional remediation hints.
// classify() passes these through verbatim, so command code can fail fast with
// a precise exit code (e.g. "auth required" -> 4) without round-tripping to the
// server. UsageError is the common specialization (exit 2).
//
// A command that says a server's refusal in its own words passes the refusal
// as `cause`: classify() then keeps its RPC status, so the failure still
// reads as the server's answer (its help line, its debug code).

export class CliExitError extends Error {
  readonly exitCode: number;
  readonly hints?: readonly string[];

  constructor(message: string, exitCode: number, hints?: readonly string[], options?: { readonly cause?: unknown }) {
    super(message, options);
    this.name = "CliExitError";
    this.exitCode = exitCode;
    this.hints = hints;
  }
}
