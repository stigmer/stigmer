package steps

import (
	"testing"

	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stretchr/testify/assert"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// TestRequireOrgForReference verifies the getByReference org requirement is
// derived from kind_meta authorization scope: ORGANIZATION-scoped kinds demand
// an org (their slug is per-org-unique), while OWNER_ONLY kinds are exempt
// (globally/owner-unique slugs). This is the cross-edition contract cloud also
// enforces per-handler.
func TestRequireOrgForReference(t *testing.T) {
	tests := []struct {
		name    string
		kind    apiresourcekind.ApiResourceKind
		org     string
		wantErr bool
	}{
		{
			name:    "org-scoped kind (project) with empty org is rejected",
			kind:    apiresourcekind.ApiResourceKind_project,
			org:     "",
			wantErr: true,
		},
		{
			name:    "org-scoped kind (project) with an org is allowed",
			kind:    apiresourcekind.ApiResourceKind_project,
			org:     "acme",
			wantErr: false,
		},
		{
			name:    "org-scoped kind (workflow) with empty org is rejected",
			kind:    apiresourcekind.ApiResourceKind_workflow,
			org:     "",
			wantErr: true,
		},
		{
			name:    "owner-only kind (execution_context) is exempt from the org requirement",
			kind:    apiresourcekind.ApiResourceKind_execution_context,
			org:     "",
			wantErr: false,
		},
		{
			name:    "organization (owner-only tenancy root) is exempt from the org requirement",
			kind:    apiresourcekind.ApiResourceKind_organization,
			org:     "",
			wantErr: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := RequireOrgForReference(tt.kind, tt.org)
			if !tt.wantErr {
				assert.NoError(t, err)
				return
			}
			assert.Error(t, err)
			assert.Equal(t, codes.InvalidArgument, status.Code(err),
				"an org-scoped kind with empty org must be rejected with InvalidArgument")
			assert.Contains(t, err.Error(), "org is required")
		})
	}
}
