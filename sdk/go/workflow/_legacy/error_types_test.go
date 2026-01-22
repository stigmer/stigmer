package workflow

import (
	"testing"
)

func TestErrorTypeConstants(t *testing.T) {
	// Verify error type constants match backend expectations
	tests := []struct {
		name     string
		constant string
		expected string
	}{
		{"HTTP Call", ErrorTypeHTTPCall, "CallHTTP error"},
		{"gRPC Call", ErrorTypeGRPCCall, "CallGRPC error"},
		{"Validation", ErrorTypeValidation, "Validation"},
		{"If Statement", ErrorTypeIfStatement, "If statement error"},
		{"Command", ErrorTypeCommand, "command"},
		{"Any", ErrorTypeAny, "*"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.constant != tt.expected {
				t.Errorf("Error type constant mismatch: got %q, want %q", tt.constant, tt.expected)
			}
		})
	}
}

func TestGetErrorTypeInfo(t *testing.T) {
	tests := []struct {
		name      string
		errorType string
		wantFound bool
	}{
		{"HTTP Call exists", ErrorTypeHTTPCall, true},
		{"gRPC Call exists", ErrorTypeGRPCCall, true},
		{"Validation exists", ErrorTypeValidation, true},
		{"Unknown type", "UnknownError", false},
		{"Custom user type", "InsufficientInventory", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			info, found := GetErrorTypeInfo(tt.errorType)
			if found != tt.wantFound {
				t.Errorf("GetErrorTypeInfo(%q) found = %v, want %v", tt.errorType, found, tt.wantFound)
			}
			if found && info.Code != tt.errorType {
				t.Errorf("GetErrorTypeInfo(%q) code = %q, want %q", tt.errorType, info.Code, tt.errorType)
			}
		})
	}
}

func TestIsPlatformErrorType(t *testing.T) {
	tests := []struct {
		name      string
		errorType string
		want      bool
	}{
		{"HTTP Call is platform", ErrorTypeHTTPCall, true},
		{"gRPC Call is platform", ErrorTypeGRPCCall, true},
		{"Validation is platform", ErrorTypeValidation, true},
		{"Any is platform", ErrorTypeAny, true},
		{"Custom is not platform", "InsufficientInventory", false},
		{"Unknown is not platform", "RandomError", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := IsPlatformErrorType(tt.errorType); got != tt.want {
				t.Errorf("IsPlatformErrorType(%q) = %v, want %v", tt.errorType, got, tt.want)
			}
		})
	}
}

func TestListPlatformErrorTypes(t *testing.T) {
	types := ListPlatformErrorTypes()

	// Should have at least 5 platform error types (excluding "*")
	if len(types) < 5 {
		t.Errorf("ListPlatformErrorTypes() returned %d types, want at least 5", len(types))
	}

	// Should not contain wildcard "*"
	for _, info := range types {
		if info.Code == ErrorTypeAny {
			t.Errorf("ListPlatformErrorTypes() should not contain wildcard '*'")
		}
	}

	// Verify all returned types are in the registry
	for _, info := range types {
		if !IsPlatformErrorType(info.Code) {
			t.Errorf("ListPlatformErrorTypes() returned non-platform type %q", info.Code)
		}
	}
}

func TestErrorRegistry(t *testing.T) {
	// Verify registry has required fields for each error type
	for code, info := range ErrorRegistry {
		t.Run(code, func(t *testing.T) {
			if info.Code == "" {
				t.Error("ErrorTypeInfo.Code is empty")
			}
			if info.Code != code {
				t.Errorf("Registry key %q doesn't match Code %q", code, info.Code)
			}
			if info.Category == "" {
				t.Error("ErrorTypeInfo.Category is empty")
			}
			if info.Source == "" {
				t.Error("ErrorTypeInfo.Source is empty")
			}
			if info.Description == "" {
				t.Error("ErrorTypeInfo.Description is empty")
			}
			if len(info.Examples) == 0 && code != ErrorTypeAny {
				t.Error("ErrorTypeInfo.Examples is empty")
			}
		})
	}
}
