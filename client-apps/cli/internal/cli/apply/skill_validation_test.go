package apply

import (
	"context"
	"testing"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	skillv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/skill/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/synthesis"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"
)

// =============================================================================
// ExternalSkillRef Tests
// =============================================================================

func TestExternalSkillRef_String(t *testing.T) {
	t.Run("with org returns org/slug format", func(t *testing.T) {
		ref := ExternalSkillRef{Org: "my-org", Slug: "my-skill"}
		assert.Equal(t, "my-org/my-skill", ref.String())
	})

	t.Run("without org returns slug only", func(t *testing.T) {
		ref := ExternalSkillRef{Slug: "my-skill"}
		assert.Equal(t, "my-skill", ref.String())
	})
}

// =============================================================================
// ExtractExternalSkillRefs Tests - Nil/Empty Input
// =============================================================================

func TestExtractExternalSkillRefs_NilResult(t *testing.T) {
	refs := ExtractExternalSkillRefs(nil)
	assert.Nil(t, refs)
}

func TestExtractExternalSkillRefs_EmptyResult(t *testing.T) {
	result := &synthesis.Result{}
	refs := ExtractExternalSkillRefs(result)
	assert.Empty(t, refs)
}

// =============================================================================
// ExtractExternalSkillRefs Tests - Dependencies Map
// =============================================================================

func TestExtractExternalSkillRefs_FromDependenciesMap(t *testing.T) {
	t.Run("extracts external skill from dependencies", func(t *testing.T) {
		result := &synthesis.Result{
			Dependencies: map[string][]string{
				"agent:reviewer": {"skill:external:code-analysis"},
			},
		}

		refs := ExtractExternalSkillRefs(result)

		require.Len(t, refs, 1)
		assert.Equal(t, "code-analysis", refs[0].Slug)
		assert.Contains(t, refs[0].ReferencedBy, "agent:reviewer")
	})

	t.Run("extracts external skill with org/slug format", func(t *testing.T) {
		result := &synthesis.Result{
			Dependencies: map[string][]string{
				"agent:reviewer": {"skill:external:my-org/code-analysis"},
			},
		}

		refs := ExtractExternalSkillRefs(result)

		require.Len(t, refs, 1)
		assert.Equal(t, "my-org", refs[0].Org)
		assert.Equal(t, "code-analysis", refs[0].Slug)
	})

	t.Run("ignores non-external skills in dependencies", func(t *testing.T) {
		result := &synthesis.Result{
			Dependencies: map[string][]string{
				"agent:reviewer": {"skill:inline-skill", "mcp_server:github"},
			},
		}

		refs := ExtractExternalSkillRefs(result)
		assert.Empty(t, refs)
	})

	t.Run("deduplicates external skills across multiple resources", func(t *testing.T) {
		result := &synthesis.Result{
			Dependencies: map[string][]string{
				"agent:reviewer":  {"skill:external:shared-skill"},
				"agent:processor": {"skill:external:shared-skill"},
			},
		}

		refs := ExtractExternalSkillRefs(result)

		require.Len(t, refs, 1)
		assert.Equal(t, "shared-skill", refs[0].Slug)
		assert.Len(t, refs[0].ReferencedBy, 2)
	})
}

// =============================================================================
// ExtractExternalSkillRefs Tests - Agent SkillRefs
// =============================================================================

func TestExtractExternalSkillRefs_FromAgentSkillRefs(t *testing.T) {
	t.Run("extracts skill refs from agent", func(t *testing.T) {
		result := &synthesis.Result{
			Agents: []*agentv1.Agent{
				{
					Metadata: &apiresource.ApiResourceMetadata{Name: "reviewer"},
					Spec: &agentv1.AgentSpec{
						SkillRefs: []*apiresource.ApiResourceReference{
							{Org: "my-org", Slug: "code-analysis"},
						},
					},
				},
			},
		}

		refs := ExtractExternalSkillRefs(result)

		require.Len(t, refs, 1)
		assert.Equal(t, "my-org", refs[0].Org)
		assert.Equal(t, "code-analysis", refs[0].Slug)
		assert.Contains(t, refs[0].ReferencedBy, "agent:reviewer")
	})

	t.Run("extracts skill refs from sub-agents", func(t *testing.T) {
		result := &synthesis.Result{
			Agents: []*agentv1.Agent{
				{
					Metadata: &apiresource.ApiResourceMetadata{Name: "main-agent"},
					Spec: &agentv1.AgentSpec{
						SubAgents: []*agentv1.SubAgent{
							{
								Name: "helper",
								SkillRefs: []*apiresource.ApiResourceReference{
									{Org: "my-org", Slug: "helper-skill"},
								},
							},
						},
					},
				},
			},
		}

		refs := ExtractExternalSkillRefs(result)

		require.Len(t, refs, 1)
		assert.Equal(t, "helper-skill", refs[0].Slug)
		assert.Contains(t, refs[0].ReferencedBy, "agent:main-agent/helper")
	})

	t.Run("handles nil agent metadata gracefully", func(t *testing.T) {
		result := &synthesis.Result{
			Agents: []*agentv1.Agent{
				{
					Spec: &agentv1.AgentSpec{
						SkillRefs: []*apiresource.ApiResourceReference{
							{Org: "my-org", Slug: "some-skill"},
						},
					},
				},
			},
		}

		refs := ExtractExternalSkillRefs(result)

		require.Len(t, refs, 1)
		assert.Equal(t, "some-skill", refs[0].Slug)
	})
}

// =============================================================================
// ExtractExternalSkillRefs Tests - Inline Skill Exclusion
// =============================================================================

func TestExtractExternalSkillRefs_ExcludesInlineSkills(t *testing.T) {
	t.Run("excludes skills defined inline in synthesis result", func(t *testing.T) {
		result := &synthesis.Result{
			Skills: []*skillv1.Skill{
				{
					Metadata: &apiresource.ApiResourceMetadata{
						Name: "inline-skill",
						Slug: "inline-skill",
					},
				},
			},
			Agents: []*agentv1.Agent{
				{
					Metadata: &apiresource.ApiResourceMetadata{Name: "reviewer"},
					Spec: &agentv1.AgentSpec{
						SkillRefs: []*apiresource.ApiResourceReference{
							{Slug: "inline-skill"},   // Should be excluded
							{Slug: "external-skill"}, // Should be included
						},
					},
				},
			},
		}

		refs := ExtractExternalSkillRefs(result)

		require.Len(t, refs, 1)
		assert.Equal(t, "external-skill", refs[0].Slug)
	})

	t.Run("excludes skills from dependencies map if defined inline", func(t *testing.T) {
		result := &synthesis.Result{
			Skills: []*skillv1.Skill{
				{
					Metadata: &apiresource.ApiResourceMetadata{
						Name: "inline-skill",
						Slug: "inline-skill",
					},
				},
			},
			Dependencies: map[string][]string{
				"agent:reviewer": {"skill:external:inline-skill", "skill:external:external-skill"},
			},
		}

		refs := ExtractExternalSkillRefs(result)

		require.Len(t, refs, 1)
		assert.Equal(t, "external-skill", refs[0].Slug)
	})

	t.Run("uses name as slug fallback for inline skill matching", func(t *testing.T) {
		result := &synthesis.Result{
			Skills: []*skillv1.Skill{
				{
					Metadata: &apiresource.ApiResourceMetadata{
						Name: "MyInlineSkill", // Will be lowercased
					},
				},
			},
			Agents: []*agentv1.Agent{
				{
					Metadata: &apiresource.ApiResourceMetadata{Name: "reviewer"},
					Spec: &agentv1.AgentSpec{
						SkillRefs: []*apiresource.ApiResourceReference{
							{Slug: "myinlineskill"}, // Should be excluded (matches lowercased name)
							{Slug: "other-skill"},   // Should be included
						},
					},
				},
			},
		}

		refs := ExtractExternalSkillRefs(result)

		require.Len(t, refs, 1)
		assert.Equal(t, "other-skill", refs[0].Slug)
	})
}

// =============================================================================
// ExtractExternalSkillRefs Tests - Combined Sources
// =============================================================================

func TestExtractExternalSkillRefs_CombinesSources(t *testing.T) {
	result := &synthesis.Result{
		Skills: []*skillv1.Skill{
			{
				Metadata: &apiresource.ApiResourceMetadata{
					Name: "inline-skill",
					Slug: "inline-skill",
				},
			},
		},
		Agents: []*agentv1.Agent{
			{
				Metadata: &apiresource.ApiResourceMetadata{Name: "agent1"},
				Spec: &agentv1.AgentSpec{
					SkillRefs: []*apiresource.ApiResourceReference{
						{Org: "org1", Slug: "from-proto"},
					},
				},
			},
		},
		Dependencies: map[string][]string{
			"agent:agent2": {"skill:external:from-deps"},
		},
	}

	refs := ExtractExternalSkillRefs(result)

	require.Len(t, refs, 2)

	// Find refs by slug
	refMap := make(map[string]ExternalSkillRef)
	for _, r := range refs {
		refMap[r.Slug] = r
	}

	assert.Contains(t, refMap, "from-proto")
	assert.Contains(t, refMap, "from-deps")
	assert.Equal(t, "org1", refMap["from-proto"].Org)
}

// =============================================================================
// SkillVerificationResult Tests
// =============================================================================

func TestSkillVerificationResult_EmptyWhenNoRefs(t *testing.T) {
	result := &SkillVerificationResult{
		Found:   []ExternalSkillRef{},
		Missing: []ExternalSkillRef{},
	}

	assert.Empty(t, result.Found)
	assert.Empty(t, result.Missing)
}

// =============================================================================
// Helper Function Tests
// =============================================================================

func TestParseOrgSlug(t *testing.T) {
	t.Run("parses org/slug format", func(t *testing.T) {
		org, slug := parseOrgSlug("my-org/my-skill")
		assert.Equal(t, "my-org", org)
		assert.Equal(t, "my-skill", slug)
	})

	t.Run("parses slug-only format", func(t *testing.T) {
		org, slug := parseOrgSlug("my-skill")
		assert.Equal(t, "", org)
		assert.Equal(t, "my-skill", slug)
	})

	t.Run("handles multiple slashes", func(t *testing.T) {
		org, slug := parseOrgSlug("my-org/path/to/skill")
		assert.Equal(t, "my-org", org)
		assert.Equal(t, "path/to/skill", slug)
	})
}

func TestMakeRefKey(t *testing.T) {
	t.Run("with org returns org/slug", func(t *testing.T) {
		key := makeRefKey("my-org", "my-skill")
		assert.Equal(t, "my-org/my-skill", key)
	})

	t.Run("without org returns slug only", func(t *testing.T) {
		key := makeRefKey("", "my-skill")
		assert.Equal(t, "my-skill", key)
	})
}

func TestContainsString(t *testing.T) {
	t.Run("returns true if string exists", func(t *testing.T) {
		slice := []string{"a", "b", "c"}
		assert.True(t, containsString(slice, "b"))
	})

	t.Run("returns false if string does not exist", func(t *testing.T) {
		slice := []string{"a", "b", "c"}
		assert.False(t, containsString(slice, "d"))
	})

	t.Run("returns false for empty slice", func(t *testing.T) {
		var slice []string
		assert.False(t, containsString(slice, "a"))
	})
}

// =============================================================================
// VerifyExternalSkills Tests
// =============================================================================

func TestVerifyExternalSkills_NilConnection(t *testing.T) {
	refs := []ExternalSkillRef{{Org: "org", Slug: "skill"}}

	result, err := VerifyExternalSkills(nil, "org", refs)

	require.Error(t, err)
	assert.Nil(t, result)
	assert.Contains(t, err.Error(), "connection is required")
}

func TestVerifyExternalSkills_EmptyRefs(t *testing.T) {
	// Mock connection not needed for empty refs
	result, err := VerifyExternalSkills(&mockConn{}, "org", []ExternalSkillRef{})

	require.NoError(t, err)
	assert.Empty(t, result.Found)
	assert.Empty(t, result.Missing)
}

// =============================================================================
// Real-World Scenario Tests
// =============================================================================

func TestExtractExternalSkillRefs_DataPipelineScenario(t *testing.T) {
	// Simulates a data pipeline project with:
	// - One inline skill (data-validation defined in SDK)
	// - Two external skills (platform-security, ml-tools)
	// - Two agents referencing different skills

	result := &synthesis.Result{
		Skills: []*skillv1.Skill{
			{
				Metadata: &apiresource.ApiResourceMetadata{
					Name: "data-validation",
					Slug: "data-validation",
				},
			},
		},
		Agents: []*agentv1.Agent{
			{
				Metadata: &apiresource.ApiResourceMetadata{Name: "etl-agent"},
				Spec: &agentv1.AgentSpec{
					SkillRefs: []*apiresource.ApiResourceReference{
						{Slug: "data-validation"},           // Inline - should be excluded
						{Org: "platform", Slug: "security"}, // External
					},
				},
			},
			{
				Metadata: &apiresource.ApiResourceMetadata{Name: "ml-agent"},
				Spec: &agentv1.AgentSpec{
					SkillRefs: []*apiresource.ApiResourceReference{
						{Org: "platform", Slug: "security"}, // External - same as etl-agent
						{Org: "ml-team", Slug: "tools"},     // External
					},
				},
			},
		},
	}

	refs := ExtractExternalSkillRefs(result)

	// Should have 2 external skills (deduplicated)
	require.Len(t, refs, 2)

	// Build map for easier assertion
	refMap := make(map[string]ExternalSkillRef)
	for _, r := range refs {
		refMap[r.String()] = r
	}

	// Verify platform/security is referenced by both agents
	platformSecurity := refMap["platform/security"]
	assert.Equal(t, "platform", platformSecurity.Org)
	assert.Equal(t, "security", platformSecurity.Slug)
	assert.Len(t, platformSecurity.ReferencedBy, 2)

	// Verify ml-team/tools is referenced by ml-agent only
	mlTools := refMap["ml-team/tools"]
	assert.Equal(t, "ml-team", mlTools.Org)
	assert.Equal(t, "tools", mlTools.Slug)
	assert.Len(t, mlTools.ReferencedBy, 1)
}

func TestExtractExternalSkillRefs_MultiAgentMicroservice(t *testing.T) {
	// Simulates a microservice architecture with:
	// - Main orchestrator agent
	// - Multiple sub-agents with specialized skills

	result := &synthesis.Result{
		Agents: []*agentv1.Agent{
			{
				Metadata: &apiresource.ApiResourceMetadata{Name: "orchestrator"},
				Spec: &agentv1.AgentSpec{
					SkillRefs: []*apiresource.ApiResourceReference{
						{Org: "platform", Slug: "workflow-management"},
					},
					SubAgents: []*agentv1.SubAgent{
						{
							Name: "validator",
							SkillRefs: []*apiresource.ApiResourceReference{
								{Org: "platform", Slug: "schema-validation"},
							},
						},
						{
							Name: "transformer",
							SkillRefs: []*apiresource.ApiResourceReference{
								{Org: "platform", Slug: "data-transform"},
							},
						},
					},
				},
			},
		},
	}

	refs := ExtractExternalSkillRefs(result)

	require.Len(t, refs, 3)

	// Verify all skills are extracted with correct referencing info
	refMap := make(map[string]ExternalSkillRef)
	for _, r := range refs {
		refMap[r.Slug] = r
	}

	assert.Contains(t, refMap["workflow-management"].ReferencedBy, "agent:orchestrator")
	assert.Contains(t, refMap["schema-validation"].ReferencedBy, "agent:orchestrator/validator")
	assert.Contains(t, refMap["data-transform"].ReferencedBy, "agent:orchestrator/transformer")
}

// =============================================================================
// Mock Connection for Tests
// =============================================================================

type mockConn struct{}

func (m *mockConn) Invoke(ctx context.Context, method string, args any, reply any, opts ...grpc.CallOption) error {
	return nil
}

func (m *mockConn) NewStream(ctx context.Context, desc *grpc.StreamDesc, method string, opts ...grpc.CallOption) (grpc.ClientStream, error) {
	return nil, nil
}
