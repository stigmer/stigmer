package agent

import (
	"testing"

	"github.com/stigmer/stigmer/sdk/go/environment"
)

func TestAgentWithEnvironmentVariable(t *testing.T) {
	githubToken, err := environment.New(
		environment.WithName("GITHUB_TOKEN"),
		environment.WithSecret(true),
		environment.WithDescription("GitHub API token"),
	)
	if err != nil {
		t.Fatalf("failed to create environment variable: %v", err)
	}

	agent, err := New(nil, "github-bot", &AgentArgs{
		Instructions: "Manage GitHub repositories",
	})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	// Add environment variable using builder method
	agent.AddEnvironmentVariable(githubToken)

	if len(agent.EnvironmentVariables) != 1 {
		t.Errorf("len(agent.EnvironmentVariables) = %d, want 1", len(agent.EnvironmentVariables))
	}

	if agent.EnvironmentVariables[0].Name != "GITHUB_TOKEN" {
		t.Errorf("agent.EnvironmentVariables[0].Name = %s, want GITHUB_TOKEN", agent.EnvironmentVariables[0].Name)
	}

	if !agent.EnvironmentVariables[0].IsSecret {
		t.Error("agent.EnvironmentVariables[0].IsSecret = false, want true")
	}
}

func TestAgentWithMultipleEnvironmentVariables(t *testing.T) {
	githubToken, _ := environment.New(
		environment.WithName("GITHUB_TOKEN"),
		environment.WithSecret(true),
	)

	awsRegion, _ := environment.New(
		environment.WithName("AWS_REGION"),
		environment.WithDefaultValue("us-east-1"),
	)

	logLevel, _ := environment.New(
		environment.WithName("LOG_LEVEL"),
		environment.WithDefaultValue("info"),
	)

	agent, err := New(nil, "cloud-deployer", &AgentArgs{
		Instructions: "Deploy applications to cloud",
	})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	// Add environment variables using builder method
	agent.AddEnvironmentVariables(githubToken, awsRegion, logLevel)

	if len(agent.EnvironmentVariables) != 3 {
		t.Errorf("len(agent.EnvironmentVariables) = %d, want 3", len(agent.EnvironmentVariables))
	}

	// Verify variable names
	names := make(map[string]bool)
	for _, v := range agent.EnvironmentVariables {
		names[v.Name] = true
	}

	expected := []string{"GITHUB_TOKEN", "AWS_REGION", "LOG_LEVEL"}
	for _, name := range expected {
		if !names[name] {
			t.Errorf("environment variable %s not found", name)
		}
	}
}
