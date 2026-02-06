package agent

import (
	"testing"
)

func TestAgentRequireSecret(t *testing.T) {
	agent, err := New(nil, "github-bot", &AgentArgs{
		Instructions: "Manage GitHub repositories",
	})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	// Add required secret using new convenience method
	agent.RequireSecret("GITHUB_TOKEN", "GitHub API token")

	if agent.Args.EnvSpec == nil {
		t.Fatal("Args.EnvSpec is nil")
	}

	if len(agent.Args.EnvSpec.Data) != 1 {
		t.Errorf("len(Args.EnvSpec.Data) = %d, want 1", len(agent.Args.EnvSpec.Data))
	}

	val, ok := agent.Args.EnvSpec.Data["GITHUB_TOKEN"]
	if !ok {
		t.Fatal("GITHUB_TOKEN not found in Args.EnvSpec.Data")
	}

	if !val.IsSecret {
		t.Error("GITHUB_TOKEN.IsSecret = false, want true")
	}

	if val.Description != "GitHub API token" {
		t.Errorf("GITHUB_TOKEN.Description = %q, want %q", val.Description, "GitHub API token")
	}

	if val.Value != "" {
		t.Errorf("GITHUB_TOKEN.Value = %q, want empty (required secret)", val.Value)
	}
}

func TestAgentRequireConfig(t *testing.T) {
	agent, err := New(nil, "cloud-deployer", &AgentArgs{
		Instructions: "Deploy applications to cloud",
	})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	// Add required config with default value
	agent.RequireConfig("AWS_REGION", "us-east-1", "AWS region for deployments")

	if agent.Args.EnvSpec == nil {
		t.Fatal("Args.EnvSpec is nil")
	}

	if len(agent.Args.EnvSpec.Data) != 1 {
		t.Errorf("len(Args.EnvSpec.Data) = %d, want 1", len(agent.Args.EnvSpec.Data))
	}

	val, ok := agent.Args.EnvSpec.Data["AWS_REGION"]
	if !ok {
		t.Fatal("AWS_REGION not found in Args.EnvSpec.Data")
	}

	if val.IsSecret {
		t.Error("AWS_REGION.IsSecret = true, want false")
	}

	if val.Value != "us-east-1" {
		t.Errorf("AWS_REGION.Value = %q, want %q", val.Value, "us-east-1")
	}

	if val.Description != "AWS region for deployments" {
		t.Errorf("AWS_REGION.Description = %q, want %q", val.Description, "AWS region for deployments")
	}
}

func TestAgentRequireMultipleEnvVars(t *testing.T) {
	agent, err := New(nil, "cloud-deployer", &AgentArgs{
		Instructions: "Deploy applications to cloud",
	})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	// Chain multiple RequireSecret and RequireConfig calls
	agent.
		RequireSecret("GITHUB_TOKEN", "GitHub API token").
		RequireSecret("AWS_SECRET_KEY", "AWS secret access key").
		RequireConfig("AWS_REGION", "us-east-1", "AWS region").
		RequireConfig("LOG_LEVEL", "info", "Logging verbosity")

	if agent.Args.EnvSpec == nil {
		t.Fatal("Args.EnvSpec is nil")
	}

	if len(agent.Args.EnvSpec.Data) != 4 {
		t.Errorf("len(Args.EnvSpec.Data) = %d, want 4", len(agent.Args.EnvSpec.Data))
	}

	// Verify each variable
	testCases := []struct {
		name       string
		wantSecret bool
		wantValue  string
		wantDesc   string
	}{
		{"GITHUB_TOKEN", true, "", "GitHub API token"},
		{"AWS_SECRET_KEY", true, "", "AWS secret access key"},
		{"AWS_REGION", false, "us-east-1", "AWS region"},
		{"LOG_LEVEL", false, "info", "Logging verbosity"},
	}

	for _, tc := range testCases {
		val, ok := agent.Args.EnvSpec.Data[tc.name]
		if !ok {
			t.Errorf("%s not found in Args.EnvSpec.Data", tc.name)
			continue
		}

		if val.IsSecret != tc.wantSecret {
			t.Errorf("%s.IsSecret = %v, want %v", tc.name, val.IsSecret, tc.wantSecret)
		}

		if val.Value != tc.wantValue {
			t.Errorf("%s.Value = %q, want %q", tc.name, val.Value, tc.wantValue)
		}

		if val.Description != tc.wantDesc {
			t.Errorf("%s.Description = %q, want %q", tc.name, val.Description, tc.wantDesc)
		}
	}
}

func TestAgentRequireEnvVar_ThreadSafety(t *testing.T) {
	agent, err := New(nil, "concurrent-agent", &AgentArgs{
		Instructions: "Test concurrent env var additions",
	})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	// Run concurrent RequireSecret calls
	done := make(chan bool)
	for i := 0; i < 10; i++ {
		go func(i int) {
			name := "VAR_" + string(rune('A'+i))
			agent.RequireSecret(name, "description")
			done <- true
		}(i)
	}

	// Wait for all goroutines
	for i := 0; i < 10; i++ {
		<-done
	}

	// Should have 10 variables
	if len(agent.Args.EnvSpec.Data) != 10 {
		t.Errorf("len(Args.EnvSpec.Data) = %d, want 10", len(agent.Args.EnvSpec.Data))
	}
}
