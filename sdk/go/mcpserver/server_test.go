package mcpserver

import (
	"errors"
	"sync"
	"testing"

	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
)

// mockContext implements the Context interface for testing.
type mockContext struct {
	registeredServers []*MCPServer
}

func (m *mockContext) RegisterMCPServer(s *MCPServer) {
	m.registeredServers = append(m.registeredServers, s)
}

func TestStdio_Success(t *testing.T) {
	ctx := &mockContext{}

	server, err := Stdio(ctx, "GitHub MCP Server", &McpServerArgs{
		Description: "GitHub MCP server for repository operations",
		Stdio: &mcpserverv1.StdioServerConfig{
			Command: "npx",
			Args:    []string{"-y", "@modelcontextprotocol/server-github"},
		},
		Tags: []string{"git", "vcs"},
	})

	if err != nil {
		t.Fatalf("Stdio() returned error: %v", err)
	}

	if server == nil {
		t.Fatal("Stdio() returned nil server")
	}

	// Verify name
	if server.Name != "GitHub MCP Server" {
		t.Errorf("Name = %q, want %q", server.Name, "GitHub MCP Server")
	}

	// Verify slug is auto-generated
	if server.Slug != "github-mcp-server" {
		t.Errorf("Slug = %q, want %q", server.Slug, "github-mcp-server")
	}

	// Verify Args is set (composition pattern)
	if server.Args == nil {
		t.Fatal("Args is nil, should be set")
	}

	if server.Args.Description != "GitHub MCP server for repository operations" {
		t.Errorf("Args.Description = %q, want %q", server.Args.Description, "GitHub MCP server for repository operations")
	}

	if server.Args.Stdio == nil {
		t.Fatal("Args.Stdio is nil")
	}

	if server.Args.Stdio.Command != "npx" {
		t.Errorf("Args.Stdio.Command = %q, want %q", server.Args.Stdio.Command, "npx")
	}

	// Verify registration
	if len(ctx.registeredServers) != 1 {
		t.Errorf("len(registeredServers) = %d, want 1", len(ctx.registeredServers))
	}

	if ctx.registeredServers[0] != server {
		t.Error("Registered server is not the same as returned server")
	}
}

func TestStdio_EmptyName(t *testing.T) {
	ctx := &mockContext{}

	_, err := Stdio(ctx, "", &McpServerArgs{
		Stdio: &mcpserverv1.StdioServerConfig{
			Command: "npx",
		},
	})

	if err == nil {
		t.Fatal("Stdio() should return error for empty name")
	}
}

func TestStdio_NilArgs(t *testing.T) {
	ctx := &mockContext{}

	_, err := Stdio(ctx, "test-server", nil)

	if err == nil {
		t.Fatal("Stdio() should return error for nil args (no Stdio config)")
	}
}

func TestStdio_MissingStdioConfig(t *testing.T) {
	ctx := &mockContext{}

	_, err := Stdio(ctx, "test-server", &McpServerArgs{
		Description: "Test server",
		// Stdio is nil
	})

	if err == nil {
		t.Fatal("Stdio() should return error when Stdio config is missing")
	}
}

func TestStdio_MissingCommand(t *testing.T) {
	ctx := &mockContext{}

	_, err := Stdio(ctx, "test-server", &McpServerArgs{
		Stdio: &mcpserverv1.StdioServerConfig{
			// Command is empty
		},
	})

	if err == nil {
		t.Fatal("Stdio() should return error when Command is empty")
	}
}

func TestStdio_NilContext(t *testing.T) {
	// Should work even without context
	server, err := Stdio(nil, "test-server", &McpServerArgs{
		Stdio: &mcpserverv1.StdioServerConfig{
			Command: "npx",
			Args:    []string{"-y", "test-package"},
		},
	})

	if err != nil {
		t.Fatalf("Stdio() with nil context returned error: %v", err)
	}

	if server == nil {
		t.Fatal("Stdio() returned nil server")
	}
}

func TestHTTP_Success(t *testing.T) {
	ctx := &mockContext{}

	server, err := HTTP(ctx, "External API", &McpServerArgs{
		Description: "External API MCP server",
		Http: &mcpserverv1.HttpServerConfig{
			Url: "https://mcp.example.com/v1",
			Headers: map[string]string{
				"Authorization": "Bearer ${API_TOKEN}",
			},
			TimeoutSeconds: 60,
		},
	})

	if err != nil {
		t.Fatalf("HTTP() returned error: %v", err)
	}

	if server == nil {
		t.Fatal("HTTP() returned nil server")
	}

	// Verify name
	if server.Name != "External API" {
		t.Errorf("Name = %q, want %q", server.Name, "External API")
	}

	// Verify slug is auto-generated
	if server.Slug != "external-api" {
		t.Errorf("Slug = %q, want %q", server.Slug, "external-api")
	}

	// Verify Args is set (composition pattern)
	if server.Args == nil {
		t.Fatal("Args is nil, should be set")
	}

	if server.Args.Http == nil {
		t.Fatal("Args.Http is nil")
	}

	if server.Args.Http.Url != "https://mcp.example.com/v1" {
		t.Errorf("Args.Http.Url = %q, want %q", server.Args.Http.Url, "https://mcp.example.com/v1")
	}

	if server.Args.Http.TimeoutSeconds != 60 {
		t.Errorf("Args.Http.TimeoutSeconds = %d, want %d", server.Args.Http.TimeoutSeconds, 60)
	}

	// Verify registration
	if len(ctx.registeredServers) != 1 {
		t.Errorf("len(registeredServers) = %d, want 1", len(ctx.registeredServers))
	}
}

func TestHTTP_EmptyName(t *testing.T) {
	ctx := &mockContext{}

	_, err := HTTP(ctx, "", &McpServerArgs{
		Http: &mcpserverv1.HttpServerConfig{
			Url: "https://example.com",
		},
	})

	if err == nil {
		t.Fatal("HTTP() should return error for empty name")
	}
}

func TestHTTP_MissingHttpConfig(t *testing.T) {
	ctx := &mockContext{}

	_, err := HTTP(ctx, "test-server", &McpServerArgs{
		Description: "Test server",
		// Http is nil
	})

	if err == nil {
		t.Fatal("HTTP() should return error when Http config is missing")
	}
}

func TestHTTP_MissingUrl(t *testing.T) {
	ctx := &mockContext{}

	_, err := HTTP(ctx, "test-server", &McpServerArgs{
		Http: &mcpserverv1.HttpServerConfig{
			// Url is empty
		},
	})

	if err == nil {
		t.Fatal("HTTP() should return error when Url is empty")
	}
}

func TestServerType(t *testing.T) {
	tests := []struct {
		name     string
		server   *MCPServer
		expected string
	}{
		{
			name: "stdio server",
			server: &MCPServer{
				Args: &McpServerArgs{
					Stdio: &mcpserverv1.StdioServerConfig{Command: "npx"},
				},
			},
			expected: "stdio",
		},
		{
			name: "http server",
			server: &MCPServer{
				Args: &McpServerArgs{
					Http: &mcpserverv1.HttpServerConfig{Url: "https://example.com"},
				},
			},
			expected: "http",
		},
		{
			name: "nil args",
			server: &MCPServer{
				Args: nil,
			},
			expected: "unknown",
		},
		{
			name: "empty args",
			server: &MCPServer{
				Args: &McpServerArgs{},
			},
			expected: "unknown",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := tt.server.ServerType()
			if got != tt.expected {
				t.Errorf("ServerType() = %q, want %q", got, tt.expected)
			}
		})
	}
}

func TestString(t *testing.T) {
	server := &MCPServer{
		Name: "test-server",
		Args: &McpServerArgs{
			Stdio: &mcpserverv1.StdioServerConfig{Command: "npx"},
		},
	}

	str := server.String()
	expected := "MCPServer(name=test-server, type=stdio)"
	if str != expected {
		t.Errorf("String() = %q, want %q", str, expected)
	}
}

func TestSlugGeneration(t *testing.T) {
	tests := []struct {
		name         string
		inputName    string
		expectedSlug string
	}{
		{"simple lowercase", "github", "github"},
		{"with spaces", "GitHub MCP Server", "github-mcp-server"},
		{"with special chars", "My Server (v2)", "my-server-v2"},
		{"mixed case", "MyServer", "myserver"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			server, err := Stdio(nil, tt.inputName, &McpServerArgs{
				Stdio: &mcpserverv1.StdioServerConfig{Command: "test"},
			})
			if err != nil {
				t.Fatalf("Stdio() returned error: %v", err)
			}
			if server.Slug != tt.expectedSlug {
				t.Errorf("Slug = %q, want %q", server.Slug, tt.expectedSlug)
			}
		})
	}
}

// =============================================================================
// Org Field Tests
// =============================================================================

func TestOrgField(t *testing.T) {
	server, err := Stdio(nil, "test-server", &McpServerArgs{
		Stdio: &mcpserverv1.StdioServerConfig{Command: "npx"},
	})
	if err != nil {
		t.Fatalf("Stdio() returned error: %v", err)
	}

	// Org should be empty by default
	if server.Org != "" {
		t.Errorf("Org should be empty by default, got %q", server.Org)
	}

	// Set Org
	server.Org = "my-org"
	if server.Org != "my-org" {
		t.Errorf("Org = %q, want %q", server.Org, "my-org")
	}
}

// =============================================================================
// Sentinel Error Tests
// =============================================================================

func TestSentinelErrors_Stdio(t *testing.T) {
	tests := []struct {
		name        string
		serverName  string
		args        *McpServerArgs
		expectedErr error
	}{
		{
			name:        "empty name returns ErrNameRequired",
			serverName:  "",
			args:        &McpServerArgs{Stdio: &mcpserverv1.StdioServerConfig{Command: "npx"}},
			expectedErr: ErrNameRequired,
		},
		{
			name:        "nil Stdio returns ErrStdioRequired",
			serverName:  "test",
			args:        &McpServerArgs{},
			expectedErr: ErrStdioRequired,
		},
		{
			name:        "empty command returns ErrCommandRequired",
			serverName:  "test",
			args:        &McpServerArgs{Stdio: &mcpserverv1.StdioServerConfig{}},
			expectedErr: ErrCommandRequired,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := Stdio(nil, tt.serverName, tt.args)
			if !errors.Is(err, tt.expectedErr) {
				t.Errorf("Stdio() error = %v, want %v", err, tt.expectedErr)
			}
		})
	}
}

func TestSentinelErrors_HTTP(t *testing.T) {
	tests := []struct {
		name        string
		serverName  string
		args        *McpServerArgs
		expectedErr error
	}{
		{
			name:        "empty name returns ErrNameRequired",
			serverName:  "",
			args:        &McpServerArgs{Http: &mcpserverv1.HttpServerConfig{Url: "https://example.com"}},
			expectedErr: ErrNameRequired,
		},
		{
			name:        "nil Http returns ErrHttpRequired",
			serverName:  "test",
			args:        &McpServerArgs{},
			expectedErr: ErrHttpRequired,
		},
		{
			name:        "empty url returns ErrUrlRequired",
			serverName:  "test",
			args:        &McpServerArgs{Http: &mcpserverv1.HttpServerConfig{}},
			expectedErr: ErrUrlRequired,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := HTTP(nil, tt.serverName, tt.args)
			if !errors.Is(err, tt.expectedErr) {
				t.Errorf("HTTP() error = %v, want %v", err, tt.expectedErr)
			}
		})
	}
}

// =============================================================================
// Builder Method Tests
// =============================================================================

func TestSetDescription(t *testing.T) {
	server, _ := Stdio(nil, "test", &McpServerArgs{
		Stdio: &mcpserverv1.StdioServerConfig{Command: "npx"},
	})

	result := server.SetDescription("New description")

	// Verify chaining returns same server
	if result != server {
		t.Error("SetDescription should return same server for chaining")
	}

	// Verify description is set
	if server.Args.Description != "New description" {
		t.Errorf("Description = %q, want %q", server.Args.Description, "New description")
	}
}

func TestSetIconUrl(t *testing.T) {
	server, _ := Stdio(nil, "test", &McpServerArgs{
		Stdio: &mcpserverv1.StdioServerConfig{Command: "npx"},
	})

	result := server.SetIconUrl("https://example.com/icon.svg")

	if result != server {
		t.Error("SetIconUrl should return same server for chaining")
	}

	if server.Args.IconUrl != "https://example.com/icon.svg" {
		t.Errorf("IconUrl = %q, want %q", server.Args.IconUrl, "https://example.com/icon.svg")
	}
}

func TestAddTag(t *testing.T) {
	server, _ := Stdio(nil, "test", &McpServerArgs{
		Stdio: &mcpserverv1.StdioServerConfig{Command: "npx"},
	})

	server.AddTag("git").AddTag("vcs")

	if len(server.Args.Tags) != 2 {
		t.Errorf("len(Tags) = %d, want 2", len(server.Args.Tags))
	}

	if server.Args.Tags[0] != "git" || server.Args.Tags[1] != "vcs" {
		t.Errorf("Tags = %v, want [git, vcs]", server.Args.Tags)
	}
}

func TestAddTags(t *testing.T) {
	server, _ := Stdio(nil, "test", &McpServerArgs{
		Stdio: &mcpserverv1.StdioServerConfig{Command: "npx"},
	})

	server.AddTags("git", "vcs", "code-analysis")

	if len(server.Args.Tags) != 3 {
		t.Errorf("len(Tags) = %d, want 3", len(server.Args.Tags))
	}

	expected := []string{"git", "vcs", "code-analysis"}
	for i, tag := range expected {
		if server.Args.Tags[i] != tag {
			t.Errorf("Tags[%d] = %q, want %q", i, server.Args.Tags[i], tag)
		}
	}
}

func TestEnableTool(t *testing.T) {
	server, _ := Stdio(nil, "test", &McpServerArgs{
		Stdio: &mcpserverv1.StdioServerConfig{Command: "npx"},
	})

	server.EnableTool("create_pr").EnableTool("search_code")

	if len(server.Args.DefaultEnabledTools) != 2 {
		t.Errorf("len(DefaultEnabledTools) = %d, want 2", len(server.Args.DefaultEnabledTools))
	}

	if server.Args.DefaultEnabledTools[0] != "create_pr" {
		t.Errorf("DefaultEnabledTools[0] = %q, want %q", server.Args.DefaultEnabledTools[0], "create_pr")
	}
}

func TestEnableTools(t *testing.T) {
	server, _ := Stdio(nil, "test", &McpServerArgs{
		Stdio: &mcpserverv1.StdioServerConfig{Command: "npx"},
	})

	server.EnableTools("create_pr", "search_code", "get_file")

	if len(server.Args.DefaultEnabledTools) != 3 {
		t.Errorf("len(DefaultEnabledTools) = %d, want 3", len(server.Args.DefaultEnabledTools))
	}
}

func TestRequireApproval(t *testing.T) {
	server, _ := Stdio(nil, "test", &McpServerArgs{
		Stdio: &mcpserverv1.StdioServerConfig{Command: "npx"},
	})

	server.RequireApproval("delete_repo", "Delete repository: {{args.repo}}")

	if len(server.Args.DefaultToolApprovals) != 1 {
		t.Errorf("len(DefaultToolApprovals) = %d, want 1", len(server.Args.DefaultToolApprovals))
	}

	policy := server.Args.DefaultToolApprovals[0]
	if policy.ToolName != "delete_repo" {
		t.Errorf("ToolName = %q, want %q", policy.ToolName, "delete_repo")
	}
	if policy.Message != "Delete repository: {{args.repo}}" {
		t.Errorf("Message = %q, want %q", policy.Message, "Delete repository: {{args.repo}}")
	}
}

func TestRequireSecret(t *testing.T) {
	server, _ := Stdio(nil, "test", &McpServerArgs{
		Stdio: &mcpserverv1.StdioServerConfig{Command: "npx"},
	})

	server.RequireSecret("GITHUB_TOKEN", "GitHub personal access token")

	if server.Args.EnvSpec == nil {
		t.Fatal("EnvSpec should not be nil")
	}

	if server.Args.EnvSpec.Data == nil {
		t.Fatal("EnvSpec.Data should not be nil")
	}

	val, ok := server.Args.EnvSpec.Data["GITHUB_TOKEN"]
	if !ok {
		t.Fatal("GITHUB_TOKEN should be in EnvSpec.Data")
	}

	if val.Value != "" {
		t.Errorf("Value should be empty, got %q", val.Value)
	}

	if !val.IsSecret {
		t.Error("IsSecret should be true")
	}

	if val.Description != "GitHub personal access token" {
		t.Errorf("Description = %q, want %q", val.Description, "GitHub personal access token")
	}
}

func TestRequireConfig(t *testing.T) {
	server, _ := Stdio(nil, "test", &McpServerArgs{
		Stdio: &mcpserverv1.StdioServerConfig{Command: "npx"},
	})

	server.RequireConfig("LOG_LEVEL", "info", "Logging verbosity")

	val, ok := server.Args.EnvSpec.Data["LOG_LEVEL"]
	if !ok {
		t.Fatal("LOG_LEVEL should be in EnvSpec.Data")
	}

	if val.Value != "info" {
		t.Errorf("Value = %q, want %q", val.Value, "info")
	}

	if val.IsSecret {
		t.Error("IsSecret should be false")
	}

	if val.Description != "Logging verbosity" {
		t.Errorf("Description = %q, want %q", val.Description, "Logging verbosity")
	}
}

func TestBuilderMethodChaining(t *testing.T) {
	server, _ := Stdio(nil, "github-mcp", &McpServerArgs{
		Stdio: &mcpserverv1.StdioServerConfig{Command: "npx", Args: []string{"-y", "@modelcontextprotocol/server-github"}},
	})

	// Test full method chaining
	server.
		SetDescription("GitHub MCP server").
		SetIconUrl("https://github.com/favicon.ico").
		AddTags("git", "vcs").
		EnableTools("create_pr", "search_code").
		RequireApproval("delete_repo", "Delete {{args.repo}}").
		RequireSecret("GITHUB_TOKEN", "GitHub token").
		RequireConfig("GITHUB_OWNER", "stigmer", "Default org")

	// Verify all values are set
	if server.Args.Description != "GitHub MCP server" {
		t.Error("Description not set correctly")
	}
	if server.Args.IconUrl != "https://github.com/favicon.ico" {
		t.Error("IconUrl not set correctly")
	}
	if len(server.Args.Tags) != 2 {
		t.Error("Tags not set correctly")
	}
	if len(server.Args.DefaultEnabledTools) != 2 {
		t.Error("DefaultEnabledTools not set correctly")
	}
	if len(server.Args.DefaultToolApprovals) != 1 {
		t.Error("DefaultToolApprovals not set correctly")
	}
	if len(server.Args.EnvSpec.Data) != 2 {
		t.Errorf("EnvSpec.Data should have 2 entries, got %d", len(server.Args.EnvSpec.Data))
	}
}

// =============================================================================
// Thread Safety Tests
// =============================================================================

func TestBuilderMethodsConcurrentAccess(t *testing.T) {
	server, _ := Stdio(nil, "test", &McpServerArgs{
		Stdio: &mcpserverv1.StdioServerConfig{Command: "npx"},
	})

	var wg sync.WaitGroup
	iterations := 100

	// Concurrent AddTag calls
	wg.Add(iterations)
	for i := 0; i < iterations; i++ {
		go func(i int) {
			defer wg.Done()
			server.AddTag("tag")
		}(i)
	}
	wg.Wait()

	// Should have exactly 'iterations' tags (no race condition)
	if len(server.Args.Tags) != iterations {
		t.Errorf("len(Tags) = %d, want %d (possible race condition)", len(server.Args.Tags), iterations)
	}
}

func TestBuilderMethodsOnNilArgs(t *testing.T) {
	// Create server with nil Args to test nil safety
	server := &MCPServer{
		Name: "test",
		Slug: "test",
		Args: nil, // Intentionally nil
	}

	// Should not panic
	server.SetDescription("test")
	if server.Args == nil {
		t.Fatal("Args should be initialized")
	}
	if server.Args.Description != "test" {
		t.Error("Description not set")
	}
}
