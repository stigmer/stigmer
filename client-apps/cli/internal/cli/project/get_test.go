package project

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"
)

// mockClientConn implements grpc.ClientConnInterface for testing.
// This is a minimal mock that satisfies the interface without requiring
// a real gRPC connection.
type mockClientConn struct{}

func (m *mockClientConn) Invoke(ctx context.Context, method string, args interface{}, reply interface{}, opts ...grpc.CallOption) error {
	// This mock doesn't actually invoke anything - it's used for validation tests
	return nil
}

func (m *mockClientConn) NewStream(ctx context.Context, desc *grpc.StreamDesc, method string, opts ...grpc.CallOption) (grpc.ClientStream, error) {
	return nil, nil
}

// =============================================================================
// Options Validation Tests
// =============================================================================

func TestGet_NilOptions(t *testing.T) {
	// Act
	result, err := Get(nil)

	// Assert
	assert.Nil(t, result)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "get options cannot be nil")
}

func TestGet_NilConnection(t *testing.T) {
	// Arrange
	opts := &GetOptions{
		Reference: "my-project",
		OrgID:     "test-org",
		Conn:      nil,
	}

	// Act
	result, err := Get(opts)

	// Assert
	assert.Nil(t, result)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "gRPC connection cannot be nil")
}

func TestGet_EmptyReference(t *testing.T) {
	// Arrange
	opts := &GetOptions{
		Reference: "",
		OrgID:     "test-org",
		Conn:      &mockClientConn{},
	}

	// Act
	result, err := Get(opts)

	// Assert
	assert.Nil(t, result)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "project reference cannot be empty")
}

// =============================================================================
// Reference Type Detection Tests
// =============================================================================

func TestGetOptions_ValidatesAllFields(t *testing.T) {
	tests := []struct {
		name        string
		opts        *GetOptions
		wantErr     bool
		errContains string
	}{
		{
			name:        "nil options",
			opts:        nil,
			wantErr:     true,
			errContains: "get options cannot be nil",
		},
		{
			name: "nil connection",
			opts: &GetOptions{
				Reference: "my-project",
				OrgID:     "test-org",
				Conn:      nil,
			},
			wantErr:     true,
			errContains: "gRPC connection cannot be nil",
		},
		{
			name: "empty reference",
			opts: &GetOptions{
				Reference: "",
				OrgID:     "test-org",
				Conn:      &mockClientConn{},
			},
			wantErr:     true,
			errContains: "project reference cannot be empty",
		},
		{
			name: "whitespace-only reference",
			opts: &GetOptions{
				Reference: "   ",
				OrgID:     "test-org",
				Conn:      &mockClientConn{},
			},
			wantErr:     true,
			errContains: "invalid project reference",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, err := Get(tt.opts)

			if tt.wantErr {
				require.Error(t, err)
				assert.Contains(t, err.Error(), tt.errContains)
				assert.Nil(t, result)
			} else {
				// Note: Valid options would still fail because mock doesn't return data
				// This is expected - we're testing validation, not the full RPC path
			}
		})
	}
}

// =============================================================================
// Error Wrapping Tests
// =============================================================================

func TestGetFromBackend_InvalidReference_EmptyString(t *testing.T) {
	// Arrange
	conn := &mockClientConn{}

	// Act
	result, err := GetFromBackend(conn, "test-org", "")

	// Assert
	assert.Nil(t, result)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "invalid project reference")
}

func TestGetFromBackend_InvalidReference_SlugOnlyWithoutOrg(t *testing.T) {
	// When a slug-only reference is provided without a context org,
	// the reference package should return an error
	conn := &mockClientConn{}

	// Act - slug-only reference without context org
	result, err := GetFromBackend(conn, "", "my-project")

	// Assert - should fail because no org context
	assert.Nil(t, result)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "invalid project reference")
}

// =============================================================================
// GetOptions Struct Tests
// =============================================================================

func TestGetOptions_StructFields(t *testing.T) {
	// Verify the GetOptions struct has all expected fields
	// This is a compile-time check wrapped in a test
	opts := GetOptions{
		Reference: "test-reference",
		OrgID:     "test-org",
		Conn:      &mockClientConn{},
	}

	assert.Equal(t, "test-reference", opts.Reference)
	assert.Equal(t, "test-org", opts.OrgID)
	assert.NotNil(t, opts.Conn)
}

// =============================================================================
// Reference Format Tests
// These tests verify that different reference formats are handled correctly
// by the validation layer before reaching the gRPC client.
// =============================================================================

func TestGetFromBackend_ReferenceFormats(t *testing.T) {
	tests := []struct {
		name        string
		ref         string
		orgID       string
		wantErr     bool
		errContains string
	}{
		{
			name:    "resource ID format (prj_xxx)",
			ref:     "prj_01h9abcdef123456789",
			orgID:   "",
			wantErr: false, // Valid format, will fail at gRPC level (not tested here)
		},
		{
			name:    "org/slug format",
			ref:     "stigmer/my-project",
			orgID:   "",
			wantErr: false, // Valid format, will fail at gRPC level (not tested here)
		},
		{
			name:    "slug-only with context org",
			ref:     "my-project",
			orgID:   "test-org",
			wantErr: false, // Valid format, will fail at gRPC level (not tested here)
		},
		{
			name:        "slug-only without context org",
			ref:         "my-project",
			orgID:       "",
			wantErr:     true,
			errContains: "invalid project reference",
		},
		{
			name:        "empty reference",
			ref:         "",
			orgID:       "test-org",
			wantErr:     true,
			errContains: "invalid project reference",
		},
		{
			name:        "whitespace reference",
			ref:         "   ",
			orgID:       "test-org",
			wantErr:     true,
			errContains: "invalid project reference",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			conn := &mockClientConn{}

			// Note: For valid references, the call will proceed to the mock gRPC
			// client which doesn't return real data. We're only testing the
			// validation and reference parsing layer here.
			_, err := GetFromBackend(conn, tt.orgID, tt.ref)

			if tt.wantErr {
				require.Error(t, err)
				assert.Contains(t, err.Error(), tt.errContains)
			}
			// For non-error cases, we don't assert success because the mock
			// gRPC client will return nil/error - we just verify no panic
		})
	}
}
