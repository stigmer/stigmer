package root

import (
	"bytes"
	"io"
	"os"
	"testing"

	projectv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/management/project/v1"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/clioutput"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// =============================================================================
// resolveApplyOrganization
// =============================================================================

func TestResolveApplyOrganization_FlagOverrideWins(t *testing.T) {
	cfg := &config.Config{Backend: config.BackendConfig{Type: config.BackendTypeCloud}}
	proj := projectWithOrg("yaml-org")

	orgID, err := captureStderrAndResolveOrg(t, cfg, proj, "flag-org")
	require.NoError(t, err)
	assert.Equal(t, "flag-org", orgID)
}

func TestResolveApplyOrganization_FlagOverridesProjectAndConfig(t *testing.T) {
	cfg := &config.Config{
		Backend: config.BackendConfig{
			Type:  config.BackendTypeCloud,
			Cloud: &config.CloudBackendConfig{OrgID: "cloud-org"},
		},
	}
	proj := projectWithOrg("yaml-org")

	orgID, err := captureStderrAndResolveOrg(t, cfg, proj, "flag-org")
	require.NoError(t, err)
	assert.Equal(t, "flag-org", orgID)
}

func TestResolveApplyOrganization_ProjectMetadataOrg(t *testing.T) {
	cfg := &config.Config{Backend: config.BackendConfig{Type: config.BackendTypeCloud}}
	proj := projectWithOrg("yaml-org")

	orgID, err := captureStderrAndResolveOrg(t, cfg, proj, "")
	require.NoError(t, err)
	assert.Equal(t, "yaml-org", orgID)
}

func TestResolveApplyOrganization_CloudConfigOrg(t *testing.T) {
	cfg := &config.Config{
		Backend: config.BackendConfig{
			Type:  config.BackendTypeCloud,
			Cloud: &config.CloudBackendConfig{OrgID: "cloud-org"},
		},
	}
	proj := projectWithOrg("")

	orgID, err := captureStderrAndResolveOrg(t, cfg, proj, "")
	require.NoError(t, err)
	assert.Equal(t, "cloud-org", orgID)
}

func TestResolveApplyOrganization_CloudModeNoOrgAnywhere(t *testing.T) {
	cfg := &config.Config{
		Backend: config.BackendConfig{
			Type:  config.BackendTypeCloud,
			Cloud: &config.CloudBackendConfig{},
		},
	}
	proj := projectWithOrg("")

	_, err := captureStderrAndResolveOrg(t, cfg, proj, "")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "organization not set")
	assert.Contains(t, err.Error(), "--org flag")
}

func TestResolveApplyOrganization_CloudModeNilCloudConfig(t *testing.T) {
	cfg := &config.Config{
		Backend: config.BackendConfig{Type: config.BackendTypeCloud},
	}
	proj := projectWithOrg("")

	_, err := captureStderrAndResolveOrg(t, cfg, proj, "")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "organization not set")
}

func TestResolveApplyOrganization_LocalModeReturnsLocal(t *testing.T) {
	cfg := &config.Config{
		Backend: config.BackendConfig{Type: config.BackendTypeLocal},
	}
	proj := projectWithOrg("")

	orgID, err := captureStderrAndResolveOrg(t, cfg, proj, "")
	require.NoError(t, err)
	assert.Equal(t, "local", orgID)
}

func TestResolveApplyOrganization_LocalModeIgnoresProjectOrg(t *testing.T) {
	cfg := &config.Config{
		Backend: config.BackendConfig{Type: config.BackendTypeLocal},
	}
	proj := projectWithOrg("yaml-org")

	// Flag override still works in local mode
	orgID, err := captureStderrAndResolveOrg(t, cfg, proj, "flag-org")
	require.NoError(t, err)
	assert.Equal(t, "flag-org", orgID)
}

func TestResolveApplyOrganization_NilProjectMetadata(t *testing.T) {
	cfg := &config.Config{
		Backend: config.BackendConfig{Type: config.BackendTypeLocal},
	}
	proj := &projectv1.Project{Spec: &projectv1.ProjectSpec{}}

	orgID, err := captureStderrAndResolveOrg(t, cfg, proj, "")
	require.NoError(t, err)
	assert.Equal(t, "local", orgID)
}

// =============================================================================
// buildAtomicTrackResult
// =============================================================================

func TestBuildAtomicTrackResult_IsWarning(t *testing.T) {
	cr := buildAtomicTrackResult()
	assert.Equal(t, clioutput.StatusWarning, cr.Status)
}

func TestBuildAtomicTrackResult_ContainsGuidance(t *testing.T) {
	cr := buildAtomicTrackResult()
	assert.Contains(t, cr.Message, "stigmer.yaml")

	hasApplyFileHint := false
	for _, sec := range cr.Sections {
		for _, item := range sec.Items {
			if assert.ObjectsAreEqual("stigmer apply -f agent.yaml", item) {
				hasApplyFileHint = true
			}
		}
	}
	assert.True(t, hasApplyFileHint, "should contain file-mode example")
}

func TestBuildAtomicTrackResult_HasHint(t *testing.T) {
	cr := buildAtomicTrackResult()
	assert.True(t, len(cr.Hints) > 0)
}

// =============================================================================
// Helpers
// =============================================================================

func projectWithOrg(org string) *projectv1.Project {
	p := newTestProject(testApplyProjectName)
	p.Metadata.Org = org
	return p
}

func captureStderrAndResolveOrg(
	t *testing.T,
	cfg *config.Config,
	proj *projectv1.Project,
	override string,
) (string, error) {
	t.Helper()

	oldStderr := os.Stderr
	r, w, err := os.Pipe()
	require.NoError(t, err)
	os.Stderr = w

	orgID, resolveErr := resolveApplyOrganization(cfg, proj, override)

	w.Close()
	os.Stderr = oldStderr

	var buf bytes.Buffer
	io.Copy(&buf, r)

	return orgID, resolveErr
}
