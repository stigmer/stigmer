package root

import (
	"bytes"
	"io"
	"os"
	"testing"

	"github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/commons/apiresource"
	projectv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/tenancy/project/v1"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/climsg"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/clioutput"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// =============================================================================
// resolveApplyOrganization — unified priority chain
// flag > metadata > context.organization > Backend.Cloud.OrgID > error
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
		Context: config.ContextConfig{Organization: "ctx-org"},
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

func TestResolveApplyOrganization_ContextOrganization(t *testing.T) {
	cfg := &config.Config{
		Backend: config.BackendConfig{Type: config.BackendTypeLocal},
		Context: config.ContextConfig{Organization: "ctx-org"},
	}
	proj := projectWithOrg("")

	orgID, err := captureStderrAndResolveOrg(t, cfg, proj, "")
	require.NoError(t, err)
	assert.Equal(t, "ctx-org", orgID)
}

func TestResolveApplyOrganization_ContextOverridesCloudOrgID(t *testing.T) {
	cfg := &config.Config{
		Backend: config.BackendConfig{
			Type:  config.BackendTypeCloud,
			Cloud: &config.CloudBackendConfig{OrgID: "cloud-org"},
		},
		Context: config.ContextConfig{Organization: "ctx-org"},
	}
	proj := projectWithOrg("")

	orgID, err := captureStderrAndResolveOrg(t, cfg, proj, "")
	require.NoError(t, err)
	assert.Equal(t, "ctx-org", orgID)
}

func TestResolveApplyOrganization_CloudOrgIDBackwardCompat(t *testing.T) {
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

func TestResolveApplyOrganization_NoOrgAnywhere(t *testing.T) {
	cfg := &config.Config{
		Backend: config.BackendConfig{Type: config.BackendTypeLocal},
	}
	proj := projectWithOrg("")

	_, err := captureStderrAndResolveOrg(t, cfg, proj, "")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "organization not set")
	assert.Contains(t, err.Error(), "--org flag")
	assert.Contains(t, err.Error(), "stigmer config context set --org")
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

func TestResolveApplyOrganization_FlagOverrideLocalMode(t *testing.T) {
	cfg := &config.Config{
		Backend: config.BackendConfig{Type: config.BackendTypeLocal},
		Context: config.ContextConfig{Organization: "ctx-org"},
	}
	proj := projectWithOrg("yaml-org")

	orgID, err := captureStderrAndResolveOrg(t, cfg, proj, "flag-org")
	require.NoError(t, err)
	assert.Equal(t, "flag-org", orgID)
}

func TestResolveApplyOrganization_ProjectMetadataLocalMode(t *testing.T) {
	cfg := &config.Config{
		Backend: config.BackendConfig{Type: config.BackendTypeLocal},
		Context: config.ContextConfig{Organization: "ctx-org"},
	}
	proj := projectWithOrg("yaml-org")

	orgID, err := captureStderrAndResolveOrg(t, cfg, proj, "")
	require.NoError(t, err)
	assert.Equal(t, "yaml-org", orgID)
}

func TestResolveApplyOrganization_NilProjectMetadata(t *testing.T) {
	cfg := &config.Config{
		Backend: config.BackendConfig{Type: config.BackendTypeLocal},
		Context: config.ContextConfig{Organization: "ctx-org"},
	}
	proj := &projectv1.Project{Spec: &projectv1.ProjectSpec{}}

	orgID, err := captureStderrAndResolveOrg(t, cfg, proj, "")
	require.NoError(t, err)
	assert.Equal(t, "ctx-org", orgID)
}

func TestResolveApplyOrganization_NilProjectMetadataNoContext(t *testing.T) {
	cfg := &config.Config{
		Backend: config.BackendConfig{Type: config.BackendTypeLocal},
	}
	proj := &projectv1.Project{Spec: &projectv1.ProjectSpec{}}

	_, err := captureStderrAndResolveOrg(t, cfg, proj, "")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "organization not set")
}

// =============================================================================
// resolveOrgID — flag > context > ""
// =============================================================================

func TestResolveOrgID_FlagOverride(t *testing.T) {
	cfg := &config.Config{
		Backend: config.BackendConfig{Type: config.BackendTypeLocal},
		Context: config.ContextConfig{Organization: "ctx-org"},
	}
	assert.Equal(t, "flag-org", resolveOrgID("flag-org", cfg))
}

func TestResolveOrgID_ContextOrg(t *testing.T) {
	cfg := &config.Config{
		Backend: config.BackendConfig{Type: config.BackendTypeLocal},
		Context: config.ContextConfig{Organization: "ctx-org"},
	}
	assert.Equal(t, "ctx-org", resolveOrgID("", cfg))
}

func TestResolveOrgID_CloudBackwardCompat(t *testing.T) {
	cfg := &config.Config{
		Backend: config.BackendConfig{
			Type:  config.BackendTypeCloud,
			Cloud: &config.CloudBackendConfig{OrgID: "cloud-org"},
		},
	}
	assert.Equal(t, "cloud-org", resolveOrgID("", cfg))
}

func TestResolveOrgID_NoOrgAnywhere(t *testing.T) {
	cfg := &config.Config{Backend: config.BackendConfig{Type: config.BackendTypeLocal}}
	assert.Equal(t, "", resolveOrgID("", cfg))
}

// =============================================================================
// ResolveContextOrganization (config method)
// =============================================================================

func TestResolveContextOrganization_ContextSet(t *testing.T) {
	cfg := &config.Config{Context: config.ContextConfig{Organization: "ctx-org"}}
	assert.Equal(t, "ctx-org", cfg.ResolveContextOrganization())
}

func TestResolveContextOrganization_CloudFallback(t *testing.T) {
	cfg := &config.Config{
		Backend: config.BackendConfig{
			Cloud: &config.CloudBackendConfig{OrgID: "cloud-org"},
		},
	}
	assert.Equal(t, "cloud-org", cfg.ResolveContextOrganization())
}

func TestResolveContextOrganization_ContextTakesPrecedence(t *testing.T) {
	cfg := &config.Config{
		Backend: config.BackendConfig{
			Cloud: &config.CloudBackendConfig{OrgID: "cloud-org"},
		},
		Context: config.ContextConfig{Organization: "ctx-org"},
	}
	assert.Equal(t, "ctx-org", cfg.ResolveContextOrganization())
}

func TestResolveContextOrganization_Empty(t *testing.T) {
	cfg := &config.Config{}
	assert.Equal(t, "", cfg.ResolveContextOrganization())
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
// warnOrgMismatch — detects accidental hardcoded org in resource YAMLs
// =============================================================================

func TestWarnOrgMismatch_DifferentOrgs(t *testing.T) {
	var buf bytes.Buffer
	restore := climsg.ReplaceOutput(&buf)
	defer restore()

	metadata := &apiresource.ApiResourceMetadata{Name: "my-agent", Org: "stale-org"}
	warnOrgMismatch("agent", metadata, "project-org")

	output := buf.String()
	assert.Contains(t, output, "my-agent")
	assert.Contains(t, output, "stale-org")
	assert.Contains(t, output, "project-org")
}

func TestWarnOrgMismatch_SameOrg(t *testing.T) {
	var buf bytes.Buffer
	restore := climsg.ReplaceOutput(&buf)
	defer restore()

	metadata := &apiresource.ApiResourceMetadata{Name: "my-agent", Org: "same-org"}
	warnOrgMismatch("agent", metadata, "same-org")

	assert.Empty(t, buf.String())
}

func TestWarnOrgMismatch_EmptyResourceOrg(t *testing.T) {
	var buf bytes.Buffer
	restore := climsg.ReplaceOutput(&buf)
	defer restore()

	metadata := &apiresource.ApiResourceMetadata{Name: "my-agent", Org: ""}
	warnOrgMismatch("agent", metadata, "project-org")

	assert.Empty(t, buf.String())
}

func TestWarnOrgMismatch_EmptyResolvedOrg(t *testing.T) {
	var buf bytes.Buffer
	restore := climsg.ReplaceOutput(&buf)
	defer restore()

	metadata := &apiresource.ApiResourceMetadata{Name: "my-org", Org: "some-org"}
	warnOrgMismatch("organization", metadata, "")

	assert.Empty(t, buf.String())
}

func TestWarnOrgMismatch_NilMetadata(t *testing.T) {
	var buf bytes.Buffer
	restore := climsg.ReplaceOutput(&buf)
	defer restore()

	warnOrgMismatch("agent", nil, "project-org")

	assert.Empty(t, buf.String())
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
