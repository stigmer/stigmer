package clierr

import (
	"fmt"
	"strings"
	"testing"

	pkgerrors "github.com/pkg/errors"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// =============================================================================
// Classify — gRPC code mapping
// =============================================================================

func TestClassify_GRPCCodes(t *testing.T) {
	tests := []struct {
		name         string
		code         codes.Code
		grpcMsg      string
		wantExit     int
		wantContains string
	}{
		{
			name:         "Unavailable",
			code:         codes.Unavailable,
			grpcMsg:      "connection refused",
			wantExit:     ExitConnection,
			wantContains: "Cannot connect to stigmer-server",
		},
		{
			name:         "DeadlineExceeded",
			code:         codes.DeadlineExceeded,
			grpcMsg:      "deadline exceeded",
			wantExit:     ExitConnection,
			wantContains: "Operation timed out",
		},
		{
			name:         "ResourceExhausted",
			code:         codes.ResourceExhausted,
			grpcMsg:      "quota exceeded",
			wantExit:     ExitConnection,
			wantContains: "Rate limit exceeded",
		},
		{
			name:         "NotFound",
			code:         codes.NotFound,
			grpcMsg:      "agent 'summarizer' not found",
			wantExit:     ExitNotFound,
			wantContains: "agent 'summarizer' not found",
		},
		{
			name:         "InvalidArgument",
			code:         codes.InvalidArgument,
			grpcMsg:      "message is required",
			wantExit:     ExitUsage,
			wantContains: "message is required",
		},
		{
			name:         "FailedPrecondition",
			code:         codes.FailedPrecondition,
			grpcMsg:      "organization context not set",
			wantExit:     ExitUsage,
			wantContains: "Precondition failed: organization context not set",
		},
		{
			name:         "AlreadyExists",
			code:         codes.AlreadyExists,
			grpcMsg:      "agent 'summarizer' already exists",
			wantExit:     ExitUsage,
			wantContains: "Already exists: agent 'summarizer' already exists",
		},
		{
			name:         "Unauthenticated",
			code:         codes.Unauthenticated,
			grpcMsg:      "token expired",
			wantExit:     ExitAuth,
			wantContains: "Not authenticated",
		},
		{
			name:         "PermissionDenied",
			code:         codes.PermissionDenied,
			grpcMsg:      "user is not a member of org acme",
			wantExit:     ExitAuth,
			wantContains: "Permission denied: user is not a member of org acme",
		},
		{
			name:         "Internal",
			code:         codes.Internal,
			grpcMsg:      "unexpected nil pointer",
			wantExit:     ExitGeneral,
			wantContains: "Internal server error",
		},
		{
			name:         "Aborted",
			code:         codes.Aborted,
			grpcMsg:      "transaction conflict",
			wantExit:     ExitGeneral,
			wantContains: "Operation aborted: transaction conflict",
		},
		{
			name:         "Canceled",
			code:         codes.Canceled,
			grpcMsg:      "context canceled",
			wantExit:     ExitGeneral,
			wantContains: "Operation cancelled",
		},
		{
			name:         "Unknown_falls_to_default",
			code:         codes.Unknown,
			grpcMsg:      "something strange",
			wantExit:     ExitGeneral,
			wantContains: "something strange",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := status.Error(tt.code, tt.grpcMsg)
			ce := Classify(err)

			if ce == nil {
				t.Fatal("Classify returned nil for non-nil error")
			}
			if ce.ExitCode != tt.wantExit {
				t.Errorf("ExitCode = %d, want %d", ce.ExitCode, tt.wantExit)
			}
			if !strings.Contains(ce.Message, tt.wantContains) {
				t.Errorf("Message %q does not contain %q", ce.Message, tt.wantContains)
			}
			if ce.Cause == nil {
				t.Error("Cause should preserve the original gRPC error")
			}
		})
	}
}

// =============================================================================
// Classify — hints verification
// =============================================================================

func TestClassify_HintsPresent(t *testing.T) {
	tests := []struct {
		name     string
		code     codes.Code
		wantHint string
	}{
		{"Unavailable_server_hint", codes.Unavailable, "stigmer server"},
		{"Unauthenticated_login_hint", codes.Unauthenticated, "stigmer login"},
		{"PermissionDenied_login_hint", codes.PermissionDenied, "stigmer login"},
		{"DeadlineExceeded_status_hint", codes.DeadlineExceeded, "stigmer server status"},
		{"ResourceExhausted_wait_hint", codes.ResourceExhausted, "Wait a moment"},
		{"Internal_debug_hint", codes.Internal, "--debug"},
		{"Aborted_retry_hint", codes.Aborted, "safely retry"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ce := Classify(status.Error(tt.code, "msg"))

			found := false
			for _, h := range ce.Hints {
				if strings.Contains(h, tt.wantHint) {
					found = true
					break
				}
			}
			if !found {
				t.Errorf("no hint contains %q; hints = %v", tt.wantHint, ce.Hints)
			}
		})
	}
}

// =============================================================================
// Classify — error chain unwrapping
// =============================================================================

func TestClassify_WrappedGRPCError(t *testing.T) {
	grpcErr := status.Error(codes.NotFound, "agent not found in org")
	wrapped := pkgerrors.Wrap(grpcErr, "failed to resolve agent")

	ce := Classify(wrapped)

	if ce == nil {
		t.Fatal("Classify returned nil")
	}
	if ce.ExitCode != ExitNotFound {
		t.Errorf("ExitCode = %d, want %d (NotFound)", ce.ExitCode, ExitNotFound)
	}
	if !strings.Contains(ce.Message, "agent not found in org") {
		t.Errorf("Message %q should contain the gRPC message", ce.Message)
	}
}

func TestClassify_DoubleWrappedGRPCError(t *testing.T) {
	grpcErr := status.Error(codes.Unavailable, "connection refused")
	inner := pkgerrors.Wrap(grpcErr, "subscribe failed")
	outer := pkgerrors.Wrap(inner, "agent execution failed")

	ce := Classify(outer)

	if ce == nil {
		t.Fatal("Classify returned nil")
	}
	if ce.ExitCode != ExitConnection {
		t.Errorf("ExitCode = %d, want %d (Connection)", ce.ExitCode, ExitConnection)
	}
	if !strings.Contains(ce.Message, "Cannot connect to stigmer-server") {
		t.Errorf("Message %q should be the Unavailable message", ce.Message)
	}
}

func TestClassify_WrappedWithFmtErrorf(t *testing.T) {
	grpcErr := status.Error(codes.PermissionDenied, "access denied")
	wrapped := fmt.Errorf("operation failed: %w", grpcErr)

	ce := Classify(wrapped)

	if ce == nil {
		t.Fatal("Classify returned nil")
	}
	if ce.ExitCode != ExitAuth {
		t.Errorf("ExitCode = %d, want %d (Auth)", ce.ExitCode, ExitAuth)
	}
}

// =============================================================================
// Classify — non-gRPC errors and edge cases
// =============================================================================

func TestClassify_NonGRPCError(t *testing.T) {
	err := fmt.Errorf("config file not found: %s", "/home/user/.stigmer/config.yaml")
	ce := Classify(err)

	if ce == nil {
		t.Fatal("Classify returned nil")
	}
	if ce.ExitCode != ExitGeneral {
		t.Errorf("ExitCode = %d, want %d (General)", ce.ExitCode, ExitGeneral)
	}
	if !strings.Contains(ce.Message, "config file not found") {
		t.Errorf("Message %q should contain the original error text", ce.Message)
	}
	if len(ce.Hints) != 0 {
		t.Errorf("Hints should be empty for generic errors, got %v", ce.Hints)
	}
}

func TestClassify_NilError(t *testing.T) {
	ce := Classify(nil)
	if ce != nil {
		t.Errorf("Classify(nil) should return nil, got %+v", ce)
	}
}

// =============================================================================
// CLIError — error interface
// =============================================================================

func TestCLIError_ErrorInterface(t *testing.T) {
	ce := &CLIError{
		ExitCode: ExitAuth,
		Message:  "Not authenticated",
		Cause:    status.Error(codes.Unauthenticated, "token expired"),
	}

	if ce.Error() != "Not authenticated" {
		t.Errorf("Error() = %q, want %q", ce.Error(), "Not authenticated")
	}

	if ce.Unwrap() == nil {
		t.Error("Unwrap() should return the cause")
	}
}

// =============================================================================
// extractGRPCStatus — chain walking
// =============================================================================

func TestExtractGRPCStatus_DirectError(t *testing.T) {
	err := status.Error(codes.NotFound, "not found")
	st, ok := extractGRPCStatus(err)

	if !ok {
		t.Fatal("expected to extract gRPC status from direct error")
	}
	if st.Code() != codes.NotFound {
		t.Errorf("code = %v, want NotFound", st.Code())
	}
}

func TestExtractGRPCStatus_WrappedError(t *testing.T) {
	grpcErr := status.Error(codes.Internal, "db crash")
	wrapped := pkgerrors.Wrap(grpcErr, "handler failed")

	st, ok := extractGRPCStatus(wrapped)

	if !ok {
		t.Fatal("expected to extract gRPC status through Wrap")
	}
	if st.Code() != codes.Internal {
		t.Errorf("code = %v, want Internal", st.Code())
	}
}

func TestExtractGRPCStatus_NonGRPCError(t *testing.T) {
	err := fmt.Errorf("plain error")
	_, ok := extractGRPCStatus(err)

	if ok {
		t.Error("should not extract gRPC status from a plain error")
	}
}

func TestExtractGRPCStatus_NilError(t *testing.T) {
	_, ok := extractGRPCStatus(nil)
	if ok {
		t.Error("should not extract gRPC status from nil")
	}
}

// =============================================================================
// formatError — output formatting
// =============================================================================

func TestFormatError_NormalMode(t *testing.T) {
	ce := &CLIError{
		ExitCode: ExitConnection,
		Message:  "Cannot connect to stigmer-server",
		Hints:    []string{"Is the server running?", "  stigmer server"},
		Cause:    status.Error(codes.Unavailable, "connection refused"),
	}

	out := formatError(ce, false)

	if !strings.Contains(out, "Error: Cannot connect to stigmer-server") {
		t.Errorf("missing error message in output: %s", out)
	}
	if !strings.Contains(out, "stigmer server") {
		t.Errorf("missing hint in output: %s", out)
	}
	if strings.Contains(out, "--- debug ---") {
		t.Error("debug section should not appear in normal mode")
	}
}

func TestFormatError_DebugMode(t *testing.T) {
	cause := status.Error(codes.PermissionDenied, "access denied for org acme")
	ce := &CLIError{
		ExitCode: ExitAuth,
		Message:  "Permission denied: access denied for org acme",
		Hints:    []string{"Check your permissions or re-authenticate:", "  stigmer login"},
		Cause:    cause,
	}

	out := formatError(ce, true)

	if !strings.Contains(out, "--- debug ---") {
		t.Error("debug section should appear in debug mode")
	}
	if !strings.Contains(out, "gRPC code: PermissionDenied") {
		t.Errorf("missing gRPC code in debug output: %s", out)
	}
	if !strings.Contains(out, "Raw error:") {
		t.Errorf("missing raw error in debug output: %s", out)
	}
}

func TestFormatError_DebugMode_NonGRPC(t *testing.T) {
	ce := &CLIError{
		ExitCode: ExitGeneral,
		Message:  "something went wrong",
		Cause:    fmt.Errorf("disk full"),
	}

	out := formatError(ce, true)

	if !strings.Contains(out, "--- debug ---") {
		t.Error("debug section should appear even for non-gRPC errors")
	}
	if strings.Contains(out, "gRPC code:") {
		t.Error("gRPC code line should not appear for non-gRPC errors")
	}
	if !strings.Contains(out, "Raw error: disk full") {
		t.Errorf("missing raw error in debug output: %s", out)
	}
}

func TestFormatError_NoHints(t *testing.T) {
	ce := &CLIError{
		ExitCode: ExitNotFound,
		Message:  "agent not found",
		Cause:    status.Error(codes.NotFound, "agent not found"),
	}

	out := formatError(ce, false)

	lines := strings.Split(strings.TrimRight(out, "\n"), "\n")
	if len(lines) != 1 {
		t.Errorf("expected single line for no-hint errors, got %d lines: %v", len(lines), lines)
	}
}

func TestFormatError_NilCause_DebugMode(t *testing.T) {
	ce := &CLIError{
		ExitCode: ExitGeneral,
		Message:  "unknown error",
	}

	out := formatError(ce, true)

	if strings.Contains(out, "--- debug ---") {
		t.Error("debug section should not appear when Cause is nil")
	}
}

// =============================================================================
// Exit code constants sanity
// =============================================================================

func TestExitCodeValues(t *testing.T) {
	if ExitSuccess != 0 {
		t.Errorf("ExitSuccess = %d, want 0", ExitSuccess)
	}
	if ExitGeneral != 1 {
		t.Errorf("ExitGeneral = %d, want 1", ExitGeneral)
	}
	if ExitUsage != 2 {
		t.Errorf("ExitUsage = %d, want 2", ExitUsage)
	}
	if ExitConnection != 3 {
		t.Errorf("ExitConnection = %d, want 3", ExitConnection)
	}
	if ExitAuth != 4 {
		t.Errorf("ExitAuth = %d, want 4", ExitAuth)
	}
	if ExitNotFound != 5 {
		t.Errorf("ExitNotFound = %d, want 5", ExitNotFound)
	}
}
