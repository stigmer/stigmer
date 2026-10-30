/**
 * The process exit codes Stigmer's command-line tools share (the `stigmer`
 * CLI and the terminal kit's `stigmer-ink`), so a script branches on `$?`
 * without parsing output. The table alone, with no import, published as
 * `@stigmer/client/exit-codes`: a module loaded straight from source by plain
 * Node (the CLI's Temporal downloader, staged for the all-in-one image) can
 * read it. `exitCodeOf` beside it (exit-codes.ts, `@stigmer/client/node`)
 * reads a code from a turn's outcome or an error.
 */

export const ExitCode = {
  Success: 0,
  General: 1, // Internal, Aborted, remote Canceled, Unknown, non-gRPC errors; a turn that failed or was stopped
  Usage: 2, // InvalidArgument, FailedPrecondition, AlreadyExists
  Connection: 3, // Unavailable, DeadlineExceeded, ResourceExhausted
  Auth: 4, // Unauthenticated, PermissionDenied
  NotFound: 5, // NotFound
  Interrupted: 130, // the person pressed Ctrl+C, or the host stopped waiting
} as const;

export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];
