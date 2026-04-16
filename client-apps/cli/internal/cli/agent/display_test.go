package agent

import (
	"testing"

	agentv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/agent/v1"
	"github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/commons/apiresource"
	"github.com/stretchr/testify/assert"
)

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
