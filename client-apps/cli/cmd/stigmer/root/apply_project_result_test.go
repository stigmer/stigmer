package root

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"

	"github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/commons/apiresource/apiresourcekind"
	projectv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/tenancy/project/v1"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/apply"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/project"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/clioutput"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// =============================================================================
// buildSDKResult
// =============================================================================

func TestBuildSDKResult_Created(t *testing.T) {
	result := newTestProjectApplyResult(testApplyProjectName, testApplyProjectSlug, true)
	members := newTestMembers(
		apiresourcekind.ApiResourceKind_skill,
		apiresourcekind.ApiResourceKind_agent,
	)
	cr := buildSDKResult(result, members)

	assert.Equal(t, clioutput.StatusSuccess, cr.Status)
	assert.Contains(t, cr.Message, "created")
	assert.Contains(t, cr.Message, testApplyProjectName)
}

func TestBuildSDKResult_Updated(t *testing.T) {
	result := newTestProjectApplyResult(testApplyProjectName, testApplyProjectSlug, false)
	cr := buildSDKResult(result, nil)

	assert.Contains(t, cr.Message, "updated")
}

func TestBuildSDKResult_ModeFieldIsSDK(t *testing.T) {
	result := newTestProjectApplyResult(testApplyProjectName, testApplyProjectSlug, true)
	cr := buildSDKResult(result, nil)

	requireSectionField(t, cr, "Project", "Mode", "SDK")
}

func TestBuildSDKResult_SkillsAppearFirst(t *testing.T) {
	result := newTestProjectApplyResult(testApplyProjectName, testApplyProjectSlug, true)
	members := newTestMembers(
		apiresourcekind.ApiResourceKind_skill,
		apiresourcekind.ApiResourceKind_skill,
		apiresourcekind.ApiResourceKind_agent,
		apiresourcekind.ApiResourceKind_workflow,
		apiresourcekind.ApiResourceKind_mcp_server,
	)
	cr := buildSDKResult(result, members)

	requireSectionField(t, cr, "Members Applied", "skill", "2")
	requireSectionField(t, cr, "Members Applied", "agent", "1")
	requireSectionField(t, cr, "Members Applied", "workflow", "1")
	requireSectionField(t, cr, "Members Applied", "mcp_server", "1")
}

func TestBuildSDKResult_WithReconciliation(t *testing.T) {
	result := newTestProjectApplyResult(testApplyProjectName, testApplyProjectSlug, false)
	result.Project.Status = &projectv1.ProjectStatus{
		LastReconciliation: &projectv1.ReconciliationSummary{
			Created: newTestMembers(apiresourcekind.ApiResourceKind_agent),
			Deleted: newTestMembers(apiresourcekind.ApiResourceKind_skill, apiresourcekind.ApiResourceKind_skill),
		},
	}
	cr := buildSDKResult(result, nil)

	requireSectionField(t, cr, "Reconciliation", "Created", "1")
	requireSectionField(t, cr, "Reconciliation", "Pruned", "2")
}

func TestBuildSDKResult_EmptyMembers(t *testing.T) {
	result := newTestProjectApplyResult(testApplyProjectName, testApplyProjectSlug, true)
	cr := buildSDKResult(result, nil)

	assert.Equal(t, clioutput.StatusSuccess, cr.Status)
	requireSectionField(t, cr, "Project", "Name", testApplyProjectName)
}

func TestBuildSDKResult_ProjectIDShown(t *testing.T) {
	result := newTestProjectApplyResult(testApplyProjectName, testApplyProjectSlug, true)
	cr := buildSDKResult(result, nil)

	requireSectionField(t, cr, "Project", "ID", testApplyProjectID)
}

func TestBuildSDKResult_HasViewHint(t *testing.T) {
	result := newTestProjectApplyResult(testApplyProjectName, testApplyProjectSlug, true)
	cr := buildSDKResult(result, nil)

	require.True(t, len(cr.Hints) > 0)
	assert.Contains(t, cr.Hints[0], "stigmer get project")
}

// =============================================================================
// executeSDKDryRun
// =============================================================================

func TestExecuteSDKDryRun_RendersProjectInfo(t *testing.T) {
	dir := t.TempDir()
	detectResult := &project.DetectResult{
		Track:     project.TrackProject,
		ConfigDir: dir,
		Project: &projectv1.Project{
			Metadata: &apiresource.ApiResourceMetadata{Name: "sdk-project"},
			Spec:     &projectv1.ProjectSpec{EntryPoint: "main.go"},
		},
	}

	var buf bytes.Buffer
	renderer := clioutput.NewRenderer(clioutput.FormatHuman, &buf, &buf)

	err := executeSDKDryRun(detectResult, apply.RuntimeGo, renderer)
	require.NoError(t, err)
}

func TestExecuteSDKDryRun_WarnsWhenEntryPointMissing(t *testing.T) {
	dir := t.TempDir()
	detectResult := &project.DetectResult{
		Track:     project.TrackProject,
		ConfigDir: dir,
		Project: &projectv1.Project{
			Metadata: &apiresource.ApiResourceMetadata{Name: "sdk-project"},
			Spec:     &projectv1.ProjectSpec{EntryPoint: "nonexistent.go"},
		},
	}

	var buf bytes.Buffer
	renderer := clioutput.NewRenderer(clioutput.FormatHuman, &buf, &buf)

	err := executeSDKDryRun(detectResult, apply.RuntimeGo, renderer)
	require.NoError(t, err)
}

func TestExecuteSDKDryRun_NoWarningWhenEntryPointExists(t *testing.T) {
	dir := t.TempDir()
	entryPoint := "main.go"
	require.NoError(t, os.WriteFile(filepath.Join(dir, entryPoint), []byte("package main"), 0644))

	detectResult := &project.DetectResult{
		Track:     project.TrackProject,
		ConfigDir: dir,
		Project: &projectv1.Project{
			Metadata: &apiresource.ApiResourceMetadata{Name: "sdk-project"},
			Spec:     &projectv1.ProjectSpec{EntryPoint: entryPoint},
		},
	}

	var buf bytes.Buffer
	renderer := clioutput.NewRenderer(clioutput.FormatHuman, &buf, &buf)

	err := executeSDKDryRun(detectResult, apply.RuntimeGo, renderer)
	require.NoError(t, err)
}

func TestExecuteSDKDryRun_PythonRuntime(t *testing.T) {
	dir := t.TempDir()
	detectResult := &project.DetectResult{
		Track:     project.TrackProject,
		ConfigDir: dir,
		Project: &projectv1.Project{
			Metadata: &apiresource.ApiResourceMetadata{Name: "py-project"},
			Spec:     &projectv1.ProjectSpec{EntryPoint: "main.py"},
		},
	}

	var buf bytes.Buffer
	renderer := clioutput.NewRenderer(clioutput.FormatHuman, &buf, &buf)

	err := executeSDKDryRun(detectResult, apply.RuntimePython, renderer)
	require.NoError(t, err)
}
