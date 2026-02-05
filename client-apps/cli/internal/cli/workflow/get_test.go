package workflow

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"
)

// =============================================================================
// Mock gRPC Connection for Get Tests
// =============================================================================

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
	result, err := Get(nil)

	assert.Nil(t, result)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "get options cannot be nil")
}

func TestGet_NilConnection(t *testing.T) {
	opts := &GetOptions{
		Reference: "my-workflow",
		OrgID:     testOrgID,
		Conn:      nil,
	}

	result, err := Get(opts)

	assert.Nil(t, result)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "gRPC connection cannot be nil")
}

func TestGet_EmptyReference(t *testing.T) {
	opts := &GetOptions{
		Reference: "",
		OrgID:     testOrgID,
		Conn:      &mockClientConn{},
	}

	result, err := Get(opts)

	assert.Nil(t, result)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "workflow reference cannot be empty")
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
				Reference: "my-workflow",
				OrgID:     testOrgID,
				Conn:      nil,
			},
			wantErr:     true,
			errContains: "gRPC connection cannot be nil",
		},
		{
			name: "empty reference",
			opts: &GetOptions{
				Reference: "",
				OrgID:     testOrgID,
				Conn:      &mockClientConn{},
			},
			wantErr:     true,
			errContains: "workflow reference cannot be empty",
		},
		{
			name: "whitespace-only reference",
			opts: &GetOptions{
				Reference: "   ",
				OrgID:     testOrgID,
				Conn:      &mockClientConn{},
			},
			wantErr:     true,
			errContains: "invalid workflow reference",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, err := Get(tt.opts)

			if tt.wantErr {
				require.Error(t, err)
				assert.Contains(t, err.Error(), tt.errContains)
				assert.Nil(t, result)
			}
		})
	}
}

// =============================================================================
// Error Wrapping Tests
// =============================================================================

func TestGetFromBackend_InvalidReference_EmptyString(t *testing.T) {
	conn := &mockClientConn{}

	result, err := GetFromBackend(conn, testOrgID, "")

	assert.Nil(t, result)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "invalid workflow reference")
}

func TestGetFromBackend_InvalidReference_SlugOnlyWithoutOrg(t *testing.T) {
	// When a slug-only reference is provided without a context org,
	// the reference package should return an error
	conn := &mockClientConn{}

	result, err := GetFromBackend(conn, "", "my-workflow")

	assert.Nil(t, result)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "invalid workflow reference")
}

// =============================================================================
// GetOptions Struct Tests
// =============================================================================

func TestGetOptions_StructFields(t *testing.T) {
	// Verify the GetOptions struct has all expected fields
	opts := GetOptions{
		Reference: "test-reference",
		OrgID:     testOrgID,
		Conn:      &mockClientConn{},
	}

	assert.Equal(t, "test-reference", opts.Reference)
	assert.Equal(t, testOrgID, opts.OrgID)
	assert.NotNil(t, opts.Conn)
}

func TestGetOptions_DefaultValues(t *testing.T) {
	opts := GetOptions{}

	assert.Equal(t, "", opts.Reference)
	assert.Equal(t, "", opts.OrgID)
	assert.Nil(t, opts.Conn)
}

// =============================================================================
// Reference Format Tests
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
			name:    "resource ID format (wfl_xxx)",
			ref:     "wfl_01h9abcdef123456789",
			orgID:   "",
			wantErr: false, // Valid format, will fail at gRPC level (not tested here)
		},
		{
			name:    "org/slug format",
			ref:     "stigmer/my-workflow",
			orgID:   "",
			wantErr: false, // Valid format, will fail at gRPC level (not tested here)
		},
		{
			name:    "slug-only with context org",
			ref:     "my-workflow",
			orgID:   testOrgID,
			wantErr: false, // Valid format, will fail at gRPC level (not tested here)
		},
		{
			name:        "slug-only without context org",
			ref:         "my-workflow",
			orgID:       "",
			wantErr:     true,
			errContains: "invalid workflow reference",
		},
		{
			name:        "empty reference",
			ref:         "",
			orgID:       testOrgID,
			wantErr:     true,
			errContains: "invalid workflow reference",
		},
		{
			name:        "whitespace reference",
			ref:         "   ",
			orgID:       testOrgID,
			wantErr:     true,
			errContains: "invalid workflow reference",
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
