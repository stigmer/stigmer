package search

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	stigmer "github.com/stigmer/stigmer/sdk/go"

	"github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/commons/apiresource/apiresourcekind"
	searchv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/search/v1"
)

func TestResult_IsEmpty(t *testing.T) {
	tests := []struct {
		name     string
		result   *Result
		expected bool
	}{
		{
			name:     "empty entries",
			result:   &Result{Entries: []*searchv1.SearchResult{}},
			expected: true,
		},
		{
			name:     "nil entries",
			result:   &Result{Entries: nil},
			expected: true,
		},
		{
			name: "with entries",
			result: &Result{
				Entries: []*searchv1.SearchResult{
					{Name: "test"},
				},
			},
			expected: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.expected, tt.result.IsEmpty())
		})
	}
}

func TestResult_HasMorePages(t *testing.T) {
	tests := []struct {
		name        string
		result      *Result
		currentPage int32
		expected    bool
	}{
		{
			name:        "has more pages",
			result:      &Result{TotalPages: 5},
			currentPage: 2,
			expected:    true,
		},
		{
			name:        "on last page",
			result:      &Result{TotalPages: 5},
			currentPage: 5,
			expected:    false,
		},
		{
			name:        "single page",
			result:      &Result{TotalPages: 1},
			currentPage: 1,
			expected:    false,
		},
		{
			name:        "past last page",
			result:      &Result{TotalPages: 3},
			currentPage: 4,
			expected:    false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.expected, tt.result.HasMorePages(tt.currentPage))
		})
	}
}

// placeholder is a non-nil Client pointer used only to satisfy the "client is
// required" validation in unit tests that never hit the network.
var placeholder = &stigmer.Client{}

func TestValidateOptions(t *testing.T) {
	tests := []struct {
		name      string
		opts      *Options
		expectErr bool
		errMsg    string
	}{
		{
			name:      "nil client",
			opts:      &Options{Client: nil},
			expectErr: true,
			errMsg:    "client is required",
		},
		{
			name: "page size exceeds max",
			opts: &Options{
				Client:   placeholder,
				PageSize: 200,
			},
			expectErr: true,
			errMsg:    "page size cannot exceed",
		},
		{
			name: "valid options",
			opts: &Options{
				Client:   placeholder,
				PageSize: 50,
			},
			expectErr: false,
		},
		{
			name: "valid with kinds",
			opts: &Options{
				Client: placeholder,
				Kinds:  []apiresourcekind.ApiResourceKind{apiresourcekind.ApiResourceKind_agent},
			},
			expectErr: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateOptions(tt.opts)
			if tt.expectErr {
				require.Error(t, err)
				assert.Contains(t, err.Error(), tt.errMsg)
			} else {
				assert.NoError(t, err)
			}
		})
	}
}

func TestBuildSearchParams(t *testing.T) {
	tests := []struct {
		name             string
		opts             *Options
		expectedPage     int32
		expectedPageSize int32
		expectedKinds    int
	}{
		{
			name: "default pagination",
			opts: &Options{
				Client: placeholder,
			},
			expectedPage:     1,
			expectedPageSize: DefaultPageSize,
			expectedKinds:    0,
		},
		{
			name: "custom pagination",
			opts: &Options{
				Client:   placeholder,
				Page:     3,
				PageSize: 50,
			},
			expectedPage:     3,
			expectedPageSize: 50,
			expectedKinds:    0,
		},
		{
			name: "with kinds",
			opts: &Options{
				Client: placeholder,
				Kinds:  []apiresourcekind.ApiResourceKind{apiresourcekind.ApiResourceKind_agent, apiresourcekind.ApiResourceKind_skill},
			},
			expectedPage:     1,
			expectedPageSize: DefaultPageSize,
			expectedKinds:    2,
		},
		{
			name: "zero page defaults to 1",
			opts: &Options{
				Client: placeholder,
				Page:   0,
			},
			expectedPage:     1,
			expectedPageSize: DefaultPageSize,
			expectedKinds:    0,
		},
		{
			name: "negative page defaults to 1",
			opts: &Options{
				Client: placeholder,
				Page:   -5,
			},
			expectedPage:     1,
			expectedPageSize: DefaultPageSize,
			expectedKinds:    0,
		},
		{
			name: "with query and org",
			opts: &Options{
				Client: placeholder,
				Query:  "test query",
				Org:    "acme",
			},
			expectedPage:     1,
			expectedPageSize: DefaultPageSize,
			expectedKinds:    0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			params := buildSearchParams(tt.opts)

			assert.Equal(t, tt.expectedPage, params.Page.Num)
			assert.Equal(t, tt.expectedPageSize, params.Page.Size)
			assert.Len(t, params.Kinds, tt.expectedKinds)
			assert.Equal(t, tt.opts.Query, params.Query)
			assert.Equal(t, tt.opts.Org, params.Org)
			assert.Equal(t, tt.opts.ExcludePublic, params.ExcludePublic)
		})
	}
}
