package agent

import (
	"testing"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stretchr/testify/assert"
)

// =============================================================================
// truncateString Tests
// =============================================================================

func TestTruncateString_ShortString(t *testing.T) {
	result := truncateString("hello", 10)
	assert.Equal(t, "hello", result)
}

func TestTruncateString_ExactLength(t *testing.T) {
	result := truncateString("hello", 5)
	assert.Equal(t, "hello", result)
}

func TestTruncateString_LongString(t *testing.T) {
	result := truncateString("hello world", 8)
	assert.Equal(t, "hello...", result)
}

func TestTruncateString_VeryShortMaxLen(t *testing.T) {
	// When maxLen <= 3, just return "..."
	result := truncateString("hello", 3)
	assert.Equal(t, "...", result)

	result = truncateString("hello", 2)
	assert.Equal(t, "...", result)

	result = truncateString("hello", 1)
	assert.Equal(t, "...", result)
}

func TestTruncateString_EmptyString(t *testing.T) {
	result := truncateString("", 10)
	assert.Equal(t, "", result)
}

func TestTruncateString_ZeroMaxLen(t *testing.T) {
	result := truncateString("hello", 0)
	assert.Equal(t, "...", result)
}

func TestTruncateString_ExactTruncationBoundary(t *testing.T) {
	// String of length 6, maxLen of 6 - should not truncate
	result := truncateString("abcdef", 6)
	assert.Equal(t, "abcdef", result)

	// String of length 7, maxLen of 6 - should truncate
	result = truncateString("abcdefg", 6)
	assert.Equal(t, "abc...", result)
}

// =============================================================================
// DisplayApplyResult Tests - No Panic Verification
// =============================================================================

func TestDisplayApplyResult_Created_NoPanic(t *testing.T) {
	result := &ApplyResult{
		Agent: &agentv1.Agent{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Agent",
			Metadata: &apiresource.ApiResourceMetadata{
				Id:   testAgentID,
				Name: testAgentName,
				Slug: testAgentSlug,
			},
		},
		Created: true,
	}

	// Should not panic
	assert.NotPanics(t, func() {
		DisplayApplyResult(result)
	})
}

func TestDisplayApplyResult_Updated_NoPanic(t *testing.T) {
	result := &ApplyResult{
		Agent: &agentv1.Agent{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Agent",
			Metadata: &apiresource.ApiResourceMetadata{
				Id:   testAgentID,
				Name: testAgentName,
				Slug: testAgentSlug,
			},
		},
		Created: false,
	}

	// Should not panic
	assert.NotPanics(t, func() {
		DisplayApplyResult(result)
	})
}

// =============================================================================
// DisplayDeleteResult Tests - No Panic Verification
// =============================================================================

func TestDisplayDeleteResult_NoPanic(t *testing.T) {
	result := &DeleteResult{
		Agent: &agentv1.Agent{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Agent",
			Metadata: &apiresource.ApiResourceMetadata{
				Id:   testAgentID,
				Name: testAgentName,
				Slug: testAgentSlug,
			},
		},
	}

	// Should not panic
	assert.NotPanics(t, func() {
		DisplayDeleteResult(result)
	})
}

// =============================================================================
// DisplayDeleteConfirmation Tests - No Panic Verification
// =============================================================================

func TestDisplayDeleteConfirmation_NoPanic(t *testing.T) {
	agent := &agentv1.Agent{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Agent",
		Metadata: &apiresource.ApiResourceMetadata{
			Id:   testAgentID,
			Name: testAgentName,
			Slug: testAgentSlug,
			Org:  testOrgID,
		},
	}

	// Should not panic
	assert.NotPanics(t, func() {
		DisplayDeleteConfirmation(agent)
	})
}

// =============================================================================
// DisplayAgentPreview Tests - No Panic Verification
// =============================================================================

func TestDisplayAgentPreview_NoPanic(t *testing.T) {
	agent := &agentv1.Agent{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Agent",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: testAgentName,
		},
		Spec: &agentv1.AgentSpec{
			Description:  testDescription,
			Instructions: "Test instructions",
		},
	}

	// Should not panic
	assert.NotPanics(t, func() {
		DisplayAgentPreview(agent)
	})
}

func TestDisplayAgentPreview_WithMcpServers_NoPanic(t *testing.T) {
	agent := &agentv1.Agent{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Agent",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: testAgentName,
		},
		Spec: &agentv1.AgentSpec{
			Description:  testDescription,
			Instructions: "Test instructions",
			McpServerUsages: []*agentv1.McpServerUsage{
				{McpServerRef: &apiresource.ApiResourceReference{Slug: "server1"}},
				{McpServerRef: &apiresource.ApiResourceReference{Slug: "server2"}},
			},
		},
	}

	// Should not panic
	assert.NotPanics(t, func() {
		DisplayAgentPreview(agent)
	})
}

func TestDisplayAgentPreview_WithSkills_NoPanic(t *testing.T) {
	agent := &agentv1.Agent{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Agent",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: testAgentName,
		},
		Spec: &agentv1.AgentSpec{
			Description:  testDescription,
			Instructions: "Test instructions",
			SkillRefs: []*apiresource.ApiResourceReference{
				{Slug: "skill1"},
				{Slug: "skill2"},
			},
		},
	}

	// Should not panic
	assert.NotPanics(t, func() {
		DisplayAgentPreview(agent)
	})
}

func TestDisplayAgentPreview_WithSubAgents_NoPanic(t *testing.T) {
	agent := &agentv1.Agent{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Agent",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: testAgentName,
		},
		Spec: &agentv1.AgentSpec{
			Description:  testDescription,
			Instructions: "Test instructions",
			SubAgents: []*agentv1.SubAgent{
				{Name: "sub-agent-1"},
			},
		},
	}

	// Should not panic
	assert.NotPanics(t, func() {
		DisplayAgentPreview(agent)
	})
}

// =============================================================================
// DisplayGetResult Tests - No Panic Verification
// =============================================================================

func TestDisplayGetResult_TableFormat_NoPanic(t *testing.T) {
	agent := &agentv1.Agent{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Agent",
		Metadata: &apiresource.ApiResourceMetadata{
			Id:   testAgentID,
			Name: testAgentName,
			Slug: testAgentSlug,
			Org:  testOrgID,
		},
		Spec: &agentv1.AgentSpec{
			Description: testDescription,
		},
	}

	// Should not panic
	assert.NotPanics(t, func() {
		DisplayGetResult(agent, "table")
	})
}

func TestDisplayGetResult_YAMLFormat_NoPanic(t *testing.T) {
	agent := &agentv1.Agent{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Agent",
		Metadata: &apiresource.ApiResourceMetadata{
			Id:   testAgentID,
			Name: testAgentName,
			Slug: testAgentSlug,
			Org:  testOrgID,
		},
		Spec: &agentv1.AgentSpec{
			Description: testDescription,
		},
	}

	// Should not panic
	assert.NotPanics(t, func() {
		DisplayGetResult(agent, "yaml")
	})
}

func TestDisplayGetResult_JSONFormat_NoPanic(t *testing.T) {
	agent := &agentv1.Agent{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Agent",
		Metadata: &apiresource.ApiResourceMetadata{
			Id:   testAgentID,
			Name: testAgentName,
			Slug: testAgentSlug,
			Org:  testOrgID,
		},
		Spec: &agentv1.AgentSpec{
			Description: testDescription,
		},
	}

	// Should not panic
	assert.NotPanics(t, func() {
		DisplayGetResult(agent, "json")
	})
}

func TestDisplayGetResult_DefaultFormat_NoPanic(t *testing.T) {
	agent := &agentv1.Agent{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Agent",
		Metadata: &apiresource.ApiResourceMetadata{
			Id:   testAgentID,
			Name: testAgentName,
			Slug: testAgentSlug,
			Org:  testOrgID,
		},
		Spec: &agentv1.AgentSpec{
			Description: testDescription,
		},
	}

	// Empty format should default to table
	assert.NotPanics(t, func() {
		DisplayGetResult(agent, "")
	})
}

func TestDisplayGetResult_UnknownFormat_NoPanic(t *testing.T) {
	agent := &agentv1.Agent{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Agent",
		Metadata: &apiresource.ApiResourceMetadata{
			Id:   testAgentID,
			Name: testAgentName,
			Slug: testAgentSlug,
			Org:  testOrgID,
		},
		Spec: &agentv1.AgentSpec{
			Description: testDescription,
		},
	}

	// Unknown format should default to table
	assert.NotPanics(t, func() {
		DisplayGetResult(agent, "unknown")
	})
}

// =============================================================================
// displayAgentSummary Tests - No Panic Verification
// =============================================================================

func TestDisplayAgentSummary_NilSpec_NoPanic(t *testing.T) {
	agent := &agentv1.Agent{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Agent",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: testAgentName,
		},
		Spec: nil,
	}

	// Should not panic with nil spec
	assert.NotPanics(t, func() {
		displayAgentSummary(agent)
	})
}

func TestDisplayAgentSummary_EmptySpec_NoPanic(t *testing.T) {
	agent := &agentv1.Agent{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Agent",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: testAgentName,
		},
		Spec: &agentv1.AgentSpec{},
	}

	// Should not panic with empty spec
	assert.NotPanics(t, func() {
		displayAgentSummary(agent)
	})
}

func TestDisplayAgentSummary_LongInstructions_NoPanic(t *testing.T) {
	longInstructions := "This is a very long instructions string that should be truncated when displayed. " +
		"It contains more than 80 characters to test the truncation functionality."

	agent := &agentv1.Agent{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Agent",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: testAgentName,
		},
		Spec: &agentv1.AgentSpec{
			Instructions: longInstructions,
		},
	}

	// Should not panic and should truncate
	assert.NotPanics(t, func() {
		displayAgentSummary(agent)
	})
}

// =============================================================================
// Edge Cases
// =============================================================================

func TestDisplayAgentSummary_AllFields_NoPanic(t *testing.T) {
	agent := &agentv1.Agent{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Agent",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: testAgentName,
		},
		Spec: &agentv1.AgentSpec{
			Description:  testDescription,
			Instructions: "Test instructions",
			McpServerUsages: []*agentv1.McpServerUsage{
				{McpServerRef: &apiresource.ApiResourceReference{Slug: "server1"}},
			},
			SkillRefs: []*apiresource.ApiResourceReference{
				{Slug: "skill1"},
			},
			SubAgents: []*agentv1.SubAgent{
				{Name: "sub-agent"},
			},
		},
	}

	// Should not panic with all fields populated
	assert.NotPanics(t, func() {
		displayAgentSummary(agent)
	})
}
