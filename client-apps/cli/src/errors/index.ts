// Public surface of the CLI error-handling module.

export { ExitCode } from "./exit-codes.js";
export { type CliError, classify, codeName } from "./classify.js";
export { CliExitError } from "./cli-exit-error.js";
export { formatError, handle } from "./handle.js";
export { UsageError } from "./usage-error.js";
