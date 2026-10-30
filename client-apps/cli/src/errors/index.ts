// Public surface of the CLI error-handling module.
//
// Exit codes come from @stigmer/client/exit-codes, the table the terminal kit's
// stigmer-ink reads too, so scripts and CI branch on `$?` the same way for
// both. classify() maps gRPC/Connect status codes onto them. One command
// departs: `eval run` exits with Claude Code's plugin-eval codes (2 is its
// partial run, 130 an interrupt, and a refused start is 1), keeping only 3
// and 4 from this table (resources/eval-run/report.ts).

export { ExitCode } from "@stigmer/client/exit-codes";
export { type CliError, classify, codeName } from "./classify.js";
export { CliExitError } from "./cli-exit-error.js";
export { formatError, handle } from "./handle.js";
export { UsageError } from "./usage-error.js";
