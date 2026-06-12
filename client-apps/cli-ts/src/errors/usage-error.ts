// A local (client-side) validation failure — bad flags, an unknown output
// format, a malformed resource reference, etc. Maps to ExitCode.Usage (2), the
// same code the server's InvalidArgument produces, so scripts see a consistent
// "usage" exit regardless of where validation happened.

import { CliExitError } from "./cli-exit-error.js";
import { ExitCode } from "./exit-codes.js";

export class UsageError extends CliExitError {
  constructor(message: string) {
    super(message, ExitCode.Usage);
    this.name = "UsageError";
  }
}
