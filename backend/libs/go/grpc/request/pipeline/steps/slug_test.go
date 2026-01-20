package steps

import (
	"context"
	"testing"

	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
)

func TestResolveSlugStep_Execute(t *testing.T) {
	tests := []struct {
		name          string
		inputName     string
		existingSlug  string
		expectedSlug  string
		shouldSucceed bool
	}{
		{
			name:          "simple name",
			inputName:     "My Agent",
			existingSlug:  "",
			expectedSlug:  "my-agent",
			shouldSucceed: true,
		},
		{
			name:          "name with special characters",
			inputName:     "Agent@123!",
			existingSlug:  "",
			expectedSlug:  "agent123",
			shouldSucceed: true,
		},
		{
			name:          "name with multiple spaces",
			inputName:     "My   Cool   Agent",
			existingSlug:  "",
			expectedSlug:  "my-cool-agent",
			shouldSucceed: true,
		},
		{
			name:          "name with hyphens",
			inputName:     "My-Cool-Agent",
			existingSlug:  "",
			expectedSlug:  "my-cool-agent",
			shouldSucceed: true,
		},
		{
			name:          "name with leading/trailing spaces",
			inputName:     "  My Agent  ",
			existingSlug:  "",
			expectedSlug:  "my-agent",
			shouldSucceed: true,
		},
		{
			name:          "name with unicode characters",
			inputName:     "Agent 你好",
			existingSlug:  "",
			expectedSlug:  "agent",
			shouldSucceed: true,
		},
		{
			name:          "existing slug - should skip",
			inputName:     "My Agent",
			existingSlug:  "existing-slug",
			expectedSlug:  "existing-slug",
			shouldSucceed: true,
		},
		{
			name:          "long name - should preserve full length",
			inputName:     "This is a very long agent name that exceeds the maximum allowed length for kubernetes dns labels",
			existingSlug:  "",
			expectedSlug:  "this-is-a-very-long-agent-name-that-exceeds-the-maximum-allowed-length-for-kubernetes-dns-labels",
			shouldSucceed: true,
		},
		{
			name:          "name with underscores",
			inputName:     "my_test_agent",
			existingSlug:  "",
			expectedSlug:  "mytestagent",
			shouldSucceed: true,
		},
		{
			name:          "name with dots",
			inputName:     "my.test.agent",
			existingSlug:  "",
			expectedSlug:  "mytestagent",
			shouldSucceed: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Create test agent
			agent := &agentv1.Agent{
				Metadata: &apiresource.ApiResourceMetadata{
					Name: tt.inputName,
					Slug: tt.existingSlug,
				},
			}

		// Create step
		step := NewResolveSlugStep[*agentv1.Agent]()

		// Create context
		ctx := pipeline.NewRequestContext(context.Background(), agent)
		ctx.SetNewState(agent)

		// Execute
		err := step.Execute(ctx)

		// Verify
		if tt.shouldSucceed {
			if err != nil {
				t.Errorf("Expected success, got error: %v", err)
			}
			if agent.Metadata.Slug != tt.expectedSlug {
				t.Errorf("Expected slug=%q, got %q", tt.expectedSlug, agent.Metadata.Slug)
			}
		} else {
			if err == nil {
				t.Errorf("Expected error, got success")
			}
		}
		})
	}
}

func TestResolveSlugStep_EmptyName(t *testing.T) {
	agent := &agentv1.Agent{
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "",
		},
	}

	step := NewResolveSlugStep[*agentv1.Agent]()
	ctx := pipeline.NewRequestContext(context.Background(), agent)
	ctx.SetNewState(agent)

	err := step.Execute(ctx)

	if err == nil {
		t.Errorf("Expected error for empty name, got success")
	}
}

func TestResolveSlugStep_NilMetadata(t *testing.T) {
	agent := &agentv1.Agent{
		Metadata: nil,
	}

	step := NewResolveSlugStep[*agentv1.Agent]()
	ctx := pipeline.NewRequestContext(context.Background(), agent)
	ctx.SetNewState(agent)

	err := step.Execute(ctx)

	if err == nil {
		t.Errorf("Expected error for nil metadata, got success")
	}
}

func TestGenerateSlug(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"My Agent", "my-agent"},
		{"Agent@123!", "agent123"},
		{"my   cool   agent", "my-cool-agent"},
		{"MY-COOL-AGENT", "my-cool-agent"},
		{"  spaces  ", "spaces"},
		{"Agent_Test", "agenttest"},
		{"Agent.Test", "agenttest"},
		{"---hyphens---", "hyphens"},
		{"multiple---hyphens", "multiple-hyphens"},
		{"Agent123", "agent123"},
		{"123Agent", "123agent"},
		{"", ""},
		{"This is a very long agent name that exceeds the maximum allowed length for kubernetes dns labels", "this-is-a-very-long-agent-name-that-exceeds-the-maximum-allowed-length-for-kubernetes-dns-labels"},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			result := generateSlug(tt.input)
			if result != tt.expected {
				t.Errorf("generateSlug(%q) = %q, expected %q", tt.input, result, tt.expected)
			}
		})
	}
}

// TestGenerateSlug_NoCollisions verifies that different names generate different slugs
// This test documents why we removed truncation - to prevent silent collisions
func TestGenerateSlug_NoCollisions(t *testing.T) {
	// These names would collide if truncated to 59 characters
	name1 := "This is a very long agent name that exceeds the maximum allowed AAAA"
	name2 := "This is a very long agent name that exceeds the maximum allowed BBBB"

	slug1 := generateSlug(name1)
	slug2 := generateSlug(name2)

	// Without truncation, these should be different
	if slug1 == slug2 {
		t.Errorf("Expected different slugs for different names, but both generated: %q", slug1)
	}

	// Verify they are indeed different
	expectedSlug1 := "this-is-a-very-long-agent-name-that-exceeds-the-maximum-allowed-aaaa"
	expectedSlug2 := "this-is-a-very-long-agent-name-that-exceeds-the-maximum-allowed-bbbb"

	if slug1 != expectedSlug1 {
		t.Errorf("Slug1: got %q, expected %q", slug1, expectedSlug1)
	}
	if slug2 != expectedSlug2 {
		t.Errorf("Slug2: got %q, expected %q", slug2, expectedSlug2)
	}
}

func TestRemoveNonAlphanumeric(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"hello-world", "hello-world"},
		{"hello_world", "helloworld"},
		{"hello@world!", "helloworld"},
		{"hello.world", "helloworld"},
		{"hello world", "hello world"},
		{"123-abc", "123-abc"},
		{"", ""},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			result := removeNonAlphanumeric(tt.input)
			if result != tt.expected {
				t.Errorf("removeNonAlphanumeric(%q) = %q, expected %q", tt.input, result, tt.expected)
			}
		})
	}
}

func TestCollapseHyphens(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"hello-world", "hello-world"},
		{"hello--world", "hello-world"},
		{"hello---world", "hello-world"},
		{"hello----world", "hello-world"},
		{"--hello--", "-hello-"},
		{"", ""},
		{"no-hyphens-here", "no-hyphens-here"},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			result := collapseHyphens(tt.input)
			if result != tt.expected {
				t.Errorf("collapseHyphens(%q) = %q, expected %q", tt.input, result, tt.expected)
			}
		})
	}
}

func TestResolveSlugStep_Name(t *testing.T) {
	step := NewResolveSlugStep[*agentv1.Agent]()
	if step.Name() != "ResolveSlug" {
		t.Errorf("Expected Name()=ResolveSlug, got %q", step.Name())
	}
}
