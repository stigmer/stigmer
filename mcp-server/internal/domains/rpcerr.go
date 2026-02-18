package domains

import (
	"errors"
	"fmt"
	"log/slog"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// RPCError translates a gRPC error into a user-friendly message suitable for
// display to an AI client via CallToolResult.IsError.
//
// resourceDesc should identify what was being accessed, e.g.
// `agent "code-reviewer" in org "stigmer"`. The original gRPC error is logged
// at WARN level for operator debugging; only the classified message is
// returned to the caller.
func RPCError(err error, resourceDesc string) error {
	st, ok := status.FromError(err)
	if !ok {
		slog.Warn("non-gRPC error in tool handler", "resource", resourceDesc, "err", err)
		return fmt.Errorf("unexpected error: %v", err)
	}

	code := st.Code()
	slog.Warn("gRPC call failed",
		"resource", resourceDesc,
		"code", code.String(),
		"grpc_message", st.Message(),
	)

	return errors.New(classifyCode(code, resourceDesc, st.Message()))
}

// classifyCode maps a gRPC status code to a user-facing message.
func classifyCode(code codes.Code, resourceDesc, grpcMsg string) string {
	switch code {
	case codes.NotFound:
		return fmt.Sprintf("%s not found. Verify the org and slug are correct.", resourceDesc)
	case codes.PermissionDenied:
		return fmt.Sprintf("Permission denied for %s. Check your API key permissions.", resourceDesc)
	case codes.Unauthenticated:
		return "Authentication failed. Check your API key."
	case codes.Unavailable:
		return "Stigmer server is unavailable. Ensure it is running and reachable."
	case codes.DeadlineExceeded:
		return "Request timed out contacting stigmer-server."
	case codes.InvalidArgument:
		return grpcMsg
	default:
		return fmt.Sprintf("unexpected error: %s", grpcMsg)
	}
}
