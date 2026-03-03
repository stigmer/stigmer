package clierr

// Exit codes returned by the CLI. These follow a convention similar to
// BSD sysexits.h but tailored to the Stigmer domain. Scripts and CI
// pipelines can inspect $? to determine the error category without
// parsing stderr.
const (
	ExitSuccess    = 0
	ExitGeneral    = 1 // Internal, Aborted, Canceled, Unknown, non-gRPC errors
	ExitUsage      = 2 // InvalidArgument, FailedPrecondition, AlreadyExists
	ExitConnection = 3 // Unavailable, DeadlineExceeded, ResourceExhausted
	ExitAuth       = 4 // Unauthenticated, PermissionDenied
	ExitNotFound   = 5 // NotFound
)
