// Exit codes returned by the CLI. The convention mirrors the Go CLI
// (internal/cli/clierr/exit_codes.go) so scripts and CI can branch on `$?`
// without parsing stderr. classify() maps gRPC/Connect status codes onto these.

export const ExitCode = {
  Success: 0,
  General: 1, // Internal, Aborted, remote Canceled, Unknown, non-gRPC errors
  Usage: 2, // InvalidArgument, FailedPrecondition, AlreadyExists
  Connection: 3, // Unavailable, DeadlineExceeded, ResourceExhausted
  Auth: 4, // Unauthenticated, PermissionDenied
  NotFound: 5, // NotFound
} as const;

export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];
