package clierr

import (
	"errors"
	"fmt"
	"os"
	"strings"

	stigmer "github.com/stigmer/stigmer/sdk/go"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// debug controls whether Handle prints the raw error chain. Set via
// SetDebug, typically wired from the --debug global flag.
var debug bool

// SetDebug enables or disables debug output in Handle. When enabled,
// Handle appends the raw error chain and gRPC code after the
// user-facing message.
func SetDebug(enabled bool) {
	debug = enabled
}

// CLIError is the structured result of classifying a raw error. It
// carries everything needed to print a user-facing message and exit
// with the correct code. Classify produces these; Handle consumes them.
type CLIError struct {
	ExitCode int
	Message  string
	Hints    []string
	Cause    error
}

func (e *CLIError) Error() string { return e.Message }
func (e *CLIError) Unwrap() error { return e.Cause }

// Classify maps any error into a CLIError. It walks the error chain to
// find a gRPC status (fixing the case where commands wrap gRPC errors
// with errors.Wrap), then maps the gRPC code to an exit code and
// user-facing message. Non-gRPC errors fall through to a generic
// classification.
func Classify(err error) *CLIError {
	if err == nil {
		return nil
	}

	if st, ok := extractGRPCStatus(err); ok {
		return classifyGRPCCode(st)
	}

	return &CLIError{
		ExitCode: ExitGeneral,
		Message:  err.Error(),
		Cause:    err,
	}
}

// extractGRPCStatus walks the Unwrap chain looking for an error that
// implements the gRPC GRPCStatus() interface. status.FromError only
// checks the outermost error; this handles the common case where
// commands wrap gRPC errors with errors.Wrap before they reach Handle.
// Also recognises SDK *stigmer.Error, which wraps gRPC codes.
func extractGRPCStatus(err error) (*status.Status, bool) {
	var sdkErr *stigmer.Error
	if errors.As(err, &sdkErr) {
		return status.New(sdkErr.GRPCCode, sdkErr.Message), true
	}
	for e := err; e != nil; e = errors.Unwrap(e) {
		if st, ok := status.FromError(e); ok {
			if st.Code() != codes.OK {
				return st, true
			}
		}
	}
	return nil, false
}

func classifyGRPCCode(st *status.Status) *CLIError {
	switch st.Code() {

	case codes.Unavailable:
		return &CLIError{
			ExitCode: ExitConnection,
			Message:  "Cannot connect to stigmer-server",
			Hints: []string{
				"Is the server running?",
				"  stigmer server",
				"",
				"Or check status:",
				"  stigmer server status",
			},
			Cause: st.Err(),
		}

	case codes.DeadlineExceeded:
		return &CLIError{
			ExitCode: ExitConnection,
			Message:  "Operation timed out",
			Hints: []string{
				"The server took too long to respond. Try again or check server status:",
				"  stigmer server status",
			},
			Cause: st.Err(),
		}

	case codes.ResourceExhausted:
		return &CLIError{
			ExitCode: ExitConnection,
			Message:  "Rate limit exceeded",
			Hints: []string{
				"Too many requests. Wait a moment and try again.",
			},
			Cause: st.Err(),
		}

	case codes.NotFound:
		return &CLIError{
			ExitCode: ExitNotFound,
			Message:  st.Message(),
			Cause:    st.Err(),
		}

	case codes.InvalidArgument:
		return &CLIError{
			ExitCode: ExitUsage,
			Message:  st.Message(),
			Cause:    st.Err(),
		}

	case codes.FailedPrecondition:
		return &CLIError{
			ExitCode: ExitUsage,
			Message:  "Precondition failed: " + st.Message(),
			Cause:    st.Err(),
		}

	case codes.AlreadyExists:
		return &CLIError{
			ExitCode: ExitUsage,
			Message:  "Already exists: " + st.Message(),
			Cause:    st.Err(),
		}

	case codes.Unauthenticated:
		return &CLIError{
			ExitCode: ExitAuth,
			Message:  "Not authenticated",
			Hints: []string{
				"Please login:",
				"  stigmer login",
			},
			Cause: st.Err(),
		}

	case codes.PermissionDenied:
		return &CLIError{
			ExitCode: ExitAuth,
			Message:  "Permission denied: " + st.Message(),
			Hints: []string{
				"Check your permissions or re-authenticate:",
				"  stigmer login",
			},
			Cause: st.Err(),
		}

	case codes.Internal:
		return &CLIError{
			ExitCode: ExitGeneral,
			Message:  "Internal server error",
			Hints: []string{
				"This is unexpected. If the problem persists, check server logs.",
				"Run with --debug for more details.",
			},
			Cause: st.Err(),
		}

	case codes.Aborted:
		return &CLIError{
			ExitCode: ExitGeneral,
			Message:  "Operation aborted: " + st.Message(),
			Hints: []string{
				"The operation was interrupted. You can safely retry.",
			},
			Cause: st.Err(),
		}

	case codes.Canceled:
		return &CLIError{
			ExitCode: ExitGeneral,
			Message:  "Operation cancelled",
			Cause:    st.Err(),
		}

	default:
		return &CLIError{
			ExitCode: ExitGeneral,
			Message:  fmt.Sprintf("%s: %s", st.Code(), st.Message()),
			Cause:    st.Err(),
		}
	}
}

// formatError builds the stderr output for a CLIError. In normal mode
// it prints the message and hints. In debug mode it appends the raw
// error chain and gRPC code.
func formatError(ce *CLIError, debugMode bool) string {
	var b strings.Builder

	b.WriteString("Error: ")
	b.WriteString(ce.Message)
	b.WriteByte('\n')

	if len(ce.Hints) > 0 {
		b.WriteByte('\n')
		for _, h := range ce.Hints {
			b.WriteString(h)
			b.WriteByte('\n')
		}
	}

	if debugMode && ce.Cause != nil {
		b.WriteString("\n--- debug ---\n")
		if st, ok := status.FromError(ce.Cause); ok {
			fmt.Fprintf(&b, "gRPC code: %s\n", st.Code())
		}
		fmt.Fprintf(&b, "Raw error: %v\n", ce.Cause)
	}

	return b.String()
}

// Handle classifies the error, prints a user-facing message to stderr,
// and exits with the appropriate code. It is the single exit point for
// all command-level errors.
func Handle(err error) {
	if err == nil {
		return
	}

	ce := Classify(err)
	fmt.Fprint(os.Stderr, formatError(ce, debug))
	os.Exit(ce.ExitCode)
}
