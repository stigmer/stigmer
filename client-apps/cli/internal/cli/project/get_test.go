package project

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// =============================================================================
// Options Validation Tests
// =============================================================================

func TestGet_NilOptions(t *testing.T) {
	result, err := Get(nil)

	assert.Nil(t, result)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "get options cannot be nil")
}

func TestGet_NilClient(t *testing.T) {
	opts := &GetOptions{
		Reference: "my-project",
		OrgID:     "test-org",
		Client:    nil,
	}

	result, err := Get(opts)

	assert.Nil(t, result)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "client cannot be nil")
}

func TestGet_EmptyReference(t *testing.T) {
	opts := &GetOptions{
		Reference: "",
		OrgID:     "test-org",
		Client:    stubClient(),
	}

	result, err := Get(opts)

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
			name: "nil client",
			opts: &GetOptions{
				Reference: "my-project",
				OrgID:     "test-org",
				Client:    nil,
			},
			wantErr:     true,
			errContains: "client cannot be nil",
		},
		{
			name: "empty reference",
			opts: &GetOptions{
				Reference: "",
				OrgID:     "test-org",
				Client:    stubClient(),
			},
			wantErr:     true,
			errContains: "project reference cannot be empty",
		},
		{
			name: "whitespace-only reference",
			opts: &GetOptions{
				Reference: "   ",
				OrgID:     "test-org",
				Client:    stubClient(),
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
			}
		})
	}
}

// =============================================================================
// Error Wrapping Tests
// =============================================================================

func TestGetFromBackend_InvalidReference_EmptyString(t *testing.T) {
	result, err := GetFromBackend(stubClient(), "test-org", "")

	assert.Nil(t, result)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "invalid project reference")
}

func TestGetFromBackend_InvalidReference_SlugOnlyWithoutOrg(t *testing.T) {
	result, err := GetFromBackend(stubClient(), "", "my-project")

	assert.Nil(t, result)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "invalid project reference")
}

// =============================================================================
// GetOptions Struct Tests
// =============================================================================

func TestGetOptions_StructFields(t *testing.T) {
	opts := GetOptions{
		Reference: "test-reference",
		OrgID:     "test-org",
		Client:    stubClient(),
	}

	assert.Equal(t, "test-reference", opts.Reference)
	assert.Equal(t, "test-org", opts.OrgID)
	assert.NotNil(t, opts.Client)
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
			_, err := GetFromBackend(stubClient(), tt.orgID, tt.ref)

			if tt.wantErr {
				require.Error(t, err)
				assert.Contains(t, err.Error(), tt.errContains)
			}
		})
	}
}
