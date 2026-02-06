package mcpserver

import (
	"testing"

	"github.com/stigmer/stigmer/sdk/go/gen/types"
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
		Stdio: &types.StdioServerConfig{
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
		Stdio: &types.StdioServerConfig{
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
		Stdio: &types.StdioServerConfig{
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
		Stdio: &types.StdioServerConfig{
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
		Http: &types.HttpServerConfig{
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
		Http: &types.HttpServerConfig{
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
		Http: &types.HttpServerConfig{
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
					Stdio: &types.StdioServerConfig{Command: "npx"},
				},
			},
			expected: "stdio",
		},
		{
			name: "http server",
			server: &MCPServer{
				Args: &McpServerArgs{
					Http: &types.HttpServerConfig{Url: "https://example.com"},
				},
			},
			expected: "http",
		},
		{
			name: "docker server",
			server: &MCPServer{
				Args: &McpServerArgs{
					Docker: &types.DockerServerConfig{Image: "test:latest"},
				},
			},
			expected: "docker",
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
			Stdio: &types.StdioServerConfig{Command: "npx"},
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
				Stdio: &types.StdioServerConfig{Command: "test"},
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
