package clierr

import (
	"fmt"
	"os"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// Handle handles CLI errors and exits with appropriate code
func Handle(err error) {
	if err == nil {
		return
	}

	// Check if it's a gRPC error
	if st, ok := status.FromError(err); ok {
		handleGRPCError(st)
		return
	}

	// Generic error
	fmt.Fprintf(os.Stderr, "Error: %v\n", err)
	os.Exit(1)
}

// handleGRPCError handles gRPC-specific errors with better messages
func handleGRPCError(st *status.Status) {
	switch st.Code() {
	case codes.Unavailable:
		fmt.Fprintf(os.Stderr, "Error: Cannot connect to stigmer-server\n")
		fmt.Fprintf(os.Stderr, "\nIs the daemon running?\n")
		fmt.Fprintf(os.Stderr, "  stigmer local start\n")
		fmt.Fprintf(os.Stderr, "\nOr check connection:\n")
		fmt.Fprintf(os.Stderr, "  stigmer local status\n")
		os.Exit(1)

	case codes.NotFound:
		fmt.Fprintf(os.Stderr, "Error: %s\n", st.Message())
		os.Exit(1)

	case codes.InvalidArgument:
		fmt.Fprintf(os.Stderr, "Error: %s\n", st.Message())
		os.Exit(1)

	case codes.Unauthenticated:
		fmt.Fprintf(os.Stderr, "Error: Not authenticated\n")
		fmt.Fprintf(os.Stderr, "\nPlease login:\n")
		fmt.Fprintf(os.Stderr, "  stigmer login\n")
		os.Exit(1)

	default:
		fmt.Fprintf(os.Stderr, "Error: %s\n", st.Message())
		os.Exit(1)
	}
}
