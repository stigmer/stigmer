package workflow

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
		Reference: "my-workflow",
		OrgID:     testOrgID,
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
		OrgID:     testOrgID,
		Client:    stubClient(),
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
			name: "nil client",
			opts: &GetOptions{
				Reference: "my-workflow",
				OrgID:     testOrgID,
				Client:    nil,
			},
			wantErr:     true,
			errContains: "client cannot be nil",
		},
		{
			name: "empty reference",
			opts: &GetOptions{
				Reference: "",
				OrgID:     testOrgID,
				Client:    stubClient(),
			},
			wantErr:     true,
			errContains: "workflow reference cannot be empty",
		},
		{
			name: "whitespace-only reference",
			opts: &GetOptions{
				Reference: "   ",
				OrgID:     testOrgID,
				Client:    stubClient(),
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
	result, err := GetFromBackend(stubClient(), testOrgID, "")

	assert.Nil(t, result)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "invalid workflow reference")
}

func TestGetFromBackend_InvalidReference_SlugOnlyWithoutOrg(t *testing.T) {
	result, err := GetFromBackend(stubClient(), "", "my-workflow")

	assert.Nil(t, result)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "invalid workflow reference")
}

// =============================================================================
// GetOptions Struct Tests
// =============================================================================

func TestGetOptions_StructFields(t *testing.T) {
	opts := GetOptions{
		Reference: "test-reference",
		OrgID:     testOrgID,
		Client:    stubClient(),
	}

	assert.Equal(t, "test-reference", opts.Reference)
	assert.Equal(t, testOrgID, opts.OrgID)
	assert.NotNil(t, opts.Client)
}

func TestGetOptions_DefaultValues(t *testing.T) {
	opts := GetOptions{}

	assert.Equal(t, "", opts.Reference)
	assert.Equal(t, "", opts.OrgID)
	assert.Nil(t, opts.Client)
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
			_, err := GetFromBackend(stubClient(), tt.orgID, tt.ref)

			if tt.wantErr {
				require.Error(t, err)
				assert.Contains(t, err.Error(), tt.errContains)
			}
		})
	}
}
