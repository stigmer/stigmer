package main

import "testing"

func TestDocDisplayName(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"Agent", "Agent"},
		{"AgentExecution", "Agent Execution"},
		{"McpServer", "MCP Server"},
		{"ApiKey", "API Key"},
		{"IamPolicy", "IAM Policy"},
		{"OAuthApp", "OAuth App"},
		{"Organization", "Organization"},
		{"IdentityProvider", "Identity Provider"},
		{"WorkflowExecution", "Workflow Execution"},
	}
	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := docDisplayName(tt.input)
			if got != tt.want {
				t.Errorf("docDisplayName(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

func TestDocSlug(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"Agent", "agent"},
		{"AgentExecution", "agent-execution"},
		{"McpServer", "mcp-server"},
		{"ApiKey", "api-key"},
		{"IamPolicy", "iam-policy"},
		{"OAuthApp", "oauth-app"},
		{"IdentityProvider", "identity-provider"},
	}
	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := docSlug(tt.input)
			if got != tt.want {
				t.Errorf("docSlug(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}
