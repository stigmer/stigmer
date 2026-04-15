package organization

import (
	"testing"

	"github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/commons/apiresource"
	organizationv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/tenancy/organization/v1"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"
)

const (
	testOrgID   = "org_01kewqjbtdy0w4d14bnhhy4yc2"
	testOrgName = "Test Organization"
	testOrgSlug = "test-org"
)

type mockConn struct {
	grpc.ClientConnInterface
}

func createTestOrganization() *organizationv1.Organization {
	return &organizationv1.Organization{
		ApiVersion: "tenancy.stigmer.ai/v1",
		Kind:       "Organization",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: testOrgName,
			Slug: testOrgSlug,
		},
		Spec: &organizationv1.OrganizationSpec{
			Description: "A test organization",
		},
	}
}

func createTestOrganizationWithID() *organizationv1.Organization {
	org := createTestOrganization()
	org.Metadata.Id = testOrgID
	return org
}

// =============================================================================
// ApplyOptions Validation Tests
// =============================================================================

func TestApply_NilOrganization(t *testing.T) {
	opts := &ApplyOptions{
		Organization: nil,
		Conn:         &mockConn{},
		OrgID:        testOrgID,
	}

	result, err := Apply(opts)

	require.Error(t, err)
	assert.Nil(t, result)
	assert.Contains(t, err.Error(), "organization is required")
}

func TestApply_NilConnection(t *testing.T) {
	opts := &ApplyOptions{
		Organization: createTestOrganization(),
		Conn:         nil,
		OrgID:        testOrgID,
	}

	result, err := Apply(opts)

	require.Error(t, err)
	assert.Nil(t, result)
	assert.Contains(t, err.Error(), "connection is required")
}

func TestApply_ValidationOrder(t *testing.T) {
	t.Run("nil organization checked first", func(t *testing.T) {
		_, err := Apply(&ApplyOptions{
			Organization: nil,
			Conn:         &mockConn{},
		})
		require.Error(t, err)
		assert.Contains(t, err.Error(), "organization is required")
	})

	t.Run("nil connection checked second", func(t *testing.T) {
		_, err := Apply(&ApplyOptions{
			Organization: createTestOrganization(),
			Conn:         nil,
		})
		require.Error(t, err)
		assert.Contains(t, err.Error(), "connection is required")
	})
}

// =============================================================================
// DryRun Mode Tests
// =============================================================================

func TestApply_DryRun_ReturnsWithoutRPC(t *testing.T) {
	org := createTestOrganization()

	opts := &ApplyOptions{
		Organization: org,
		Conn:         &mockConn{},
		OrgID:        testOrgID,
		DryRun:       true,
		Quiet:        true,
	}

	result, err := Apply(opts)

	require.NoError(t, err)
	require.NotNil(t, result)
	assert.Equal(t, org, result.Organization)
	assert.False(t, result.Created)
}

func TestApply_DryRun_PreservesOrganization(t *testing.T) {
	org := &organizationv1.Organization{
		ApiVersion: "tenancy.stigmer.ai/v1",
		Kind:       "Organization",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: testOrgName,
			Slug: testOrgSlug,
			Org:  testOrgID,
		},
		Spec: &organizationv1.OrganizationSpec{
			Description: "Preserved description",
		},
	}

	opts := &ApplyOptions{
		Organization: org,
		Conn:         &mockConn{},
		OrgID:        testOrgID,
		DryRun:       true,
		Quiet:        true,
	}

	result, err := Apply(opts)

	require.NoError(t, err)
	require.NotNil(t, result)
	assert.Equal(t, testOrgName, result.Organization.Metadata.Name)
	assert.Equal(t, testOrgID, result.Organization.Metadata.Org)
	assert.Equal(t, "Preserved description", result.Organization.Spec.Description)
}

func TestApply_DryRun_RequiresConnection(t *testing.T) {
	opts := &ApplyOptions{
		Organization: createTestOrganization(),
		Conn:         nil,
		OrgID:        testOrgID,
		DryRun:       true,
		Quiet:        true,
	}

	result, err := Apply(opts)

	require.Error(t, err)
	assert.Nil(t, result)
	assert.Contains(t, err.Error(), "connection is required")
}

// =============================================================================
// Metadata Population Tests
// =============================================================================

func TestApply_SetsOrgWhenEmpty(t *testing.T) {
	org := createTestOrganization()
	org.Metadata.Org = ""

	opts := &ApplyOptions{
		Organization: org,
		Conn:         &mockConn{},
		OrgID:        testOrgID,
		DryRun:       true,
		Quiet:        true,
	}

	result, err := Apply(opts)

	require.NoError(t, err)
	require.NotNil(t, result)
	assert.Equal(t, testOrgID, result.Organization.Metadata.Org)
}

func TestApply_PreservesExistingOrg(t *testing.T) {
	existingOrg := "existing-org"
	org := createTestOrganization()
	org.Metadata.Org = existingOrg

	opts := &ApplyOptions{
		Organization: org,
		Conn:         &mockConn{},
		OrgID:        testOrgID,
		DryRun:       true,
		Quiet:        true,
	}

	result, err := Apply(opts)

	require.NoError(t, err)
	require.NotNil(t, result)
	assert.Equal(t, existingOrg, result.Organization.Metadata.Org)
}

func TestApply_CreatesMetadataWhenNil(t *testing.T) {
	org := &organizationv1.Organization{
		ApiVersion: "tenancy.stigmer.ai/v1",
		Kind:       "Organization",
		Metadata:   nil,
		Spec: &organizationv1.OrganizationSpec{
			Description: "Test",
		},
	}

	opts := &ApplyOptions{
		Organization: org,
		Conn:         &mockConn{},
		OrgID:        testOrgID,
		DryRun:       true,
		Quiet:        true,
	}

	result, err := Apply(opts)

	require.NoError(t, err)
	require.NotNil(t, result)
	require.NotNil(t, result.Organization.Metadata)
	assert.Equal(t, testOrgID, result.Organization.Metadata.Org)
}

func TestApply_EmptyOrgID_StillValid(t *testing.T) {
	opts := &ApplyOptions{
		Organization: createTestOrganization(),
		Conn:         &mockConn{},
		OrgID:        "",
		DryRun:       true,
		Quiet:        true,
	}

	result, err := Apply(opts)

	require.NoError(t, err)
	require.NotNil(t, result)
	assert.Equal(t, opts.Organization, result.Organization)
}

// =============================================================================
// Structure Tests
// =============================================================================

func TestApplyOptions_AllFields(t *testing.T) {
	org := createTestOrganization()

	opts := &ApplyOptions{
		Organization: org,
		OrgID:        testOrgID,
		Conn:         &mockConn{},
		Quiet:        true,
		DryRun:       true,
	}

	assert.Equal(t, org, opts.Organization)
	assert.Equal(t, testOrgID, opts.OrgID)
	assert.NotNil(t, opts.Conn)
	assert.True(t, opts.Quiet)
	assert.True(t, opts.DryRun)
}

func TestApplyResult_Structure(t *testing.T) {
	org := createTestOrganizationWithID()

	result := &ApplyResult{
		Organization: org,
		Created:      true,
	}

	assert.NotNil(t, result.Organization)
	assert.Equal(t, testOrgID, result.Organization.Metadata.Id)
	assert.True(t, result.Created)
}

func TestApplyResult_UpdateCase(t *testing.T) {
	org := createTestOrganizationWithID()

	result := &ApplyResult{
		Organization: org,
		Created:      false,
	}

	assert.NotNil(t, result.Organization)
	assert.False(t, result.Created)
}
