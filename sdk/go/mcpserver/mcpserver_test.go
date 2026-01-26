package mcpserver

import (
	"testing"

	"github.com/stigmer/stigmer/sdk/go/gen/types"
)

// mockContext implements the Context interface for testing
type mockContext struct{}

// Test Stdio Server

func TestStdioServer_Success(t *testing.T) {
	ctx := &mockContext{}
	server, err := Stdio(ctx, "github", &StdioArgs{
		Command: "npx",
		Args:    []string{"-y", "@modelcontextprotocol/server-github"},
		EnvPlaceholders: map[string]string{
			"GITHUB_TOKEN": "${GITHUB_TOKEN}",
		},
		WorkingDir: "/app",
	})
	server.EnableTools("create_issue", "list_repos")

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	if server.Name() != "github" {
		t.Errorf("expected name 'github', got %q", server.Name())
	}

	if server.Command() != "npx" {
		t.Errorf("expected command 'npx', got %q", server.Command())
	}

	if len(server.Args()) != 2 {
		t.Errorf("expected 2 args, got %d", len(server.Args()))
	}

	if server.WorkingDir() != "/app" {
		t.Errorf("expected working dir '/app', got %q", server.WorkingDir())
	}

	if len(server.EnabledTools()) != 2 {
		t.Errorf("expected 2 enabled tools, got %d", len(server.EnabledTools()))
	}
}

func TestStdioServer_MinimalArgs(t *testing.T) {
	ctx := &mockContext{}
	server, err := Stdio(ctx, "github", &StdioArgs{
		Command: "npx",
	})

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	if server.Name() != "github" {
		t.Errorf("expected name 'github', got %q", server.Name())
	}

	if server.Command() != "npx" {
		t.Errorf("expected command 'npx', got %q", server.Command())
	}
}

func TestStdioServer_NilArgs(t *testing.T) {
	ctx := &mockContext{}
	server, err := Stdio(ctx, "github", nil)

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	if server.Name() != "github" {
		t.Errorf("expected name 'github', got %q", server.Name())
	}
}

func TestStdioServer_Type(t *testing.T) {
	ctx := &mockContext{}
	server, _ := Stdio(ctx, "test", &StdioArgs{Command: "echo"})

	if server.Type() != TypeStdio {
		t.Errorf("expected type TypeStdio, got %v", server.Type())
	}
}

// Test HTTP Server

func TestHTTPServer_Success(t *testing.T) {
	ctx := &mockContext{}
	server, err := HTTP(ctx, "api-service", &HTTPArgs{
		Url: "https://mcp.example.com",
		Headers: map[string]string{
			"Authorization": "Bearer ${API_TOKEN}",
		},
		QueryParams: map[string]string{
			"region": "${AWS_REGION}",
		},
		TimeoutSeconds: 60,
	})
	server.EnableTools("search", "fetch")

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	if server.Name() != "api-service" {
		t.Errorf("expected name 'api-service', got %q", server.Name())
	}

	if server.URL() != "https://mcp.example.com" {
		t.Errorf("expected url 'https://mcp.example.com', got %q", server.URL())
	}

	if server.TimeoutSeconds() != 60 {
		t.Errorf("expected timeout 60, got %d", server.TimeoutSeconds())
	}

	if len(server.Headers()) != 1 {
		t.Errorf("expected 1 header, got %d", len(server.Headers()))
	}

	if len(server.QueryParams()) != 1 {
		t.Errorf("expected 1 query param, got %d", len(server.QueryParams()))
	}

	if len(server.EnabledTools()) != 2 {
		t.Errorf("expected 2 enabled tools, got %d", len(server.EnabledTools()))
	}
}

func TestHTTPServer_DefaultTimeout(t *testing.T) {
	ctx := &mockContext{}
	server, err := HTTP(ctx, "api-service", &HTTPArgs{
		Url: "https://mcp.example.com",
	})

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if server.TimeoutSeconds() != 30 {
		t.Errorf("expected default timeout 30, got %d", server.TimeoutSeconds())
	}
}

func TestHTTPServer_NilArgs(t *testing.T) {
	ctx := &mockContext{}
	server, err := HTTP(ctx, "api-service", nil)

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	if server.Name() != "api-service" {
		t.Errorf("expected name 'api-service', got %q", server.Name())
	}

	// Default timeout should be applied
	if server.TimeoutSeconds() != 30 {
		t.Errorf("expected default timeout 30, got %d", server.TimeoutSeconds())
	}
}

func TestHTTPServer_Type(t *testing.T) {
	ctx := &mockContext{}
	server, _ := HTTP(ctx, "test", &HTTPArgs{Url: "https://example.com"})

	if server.Type() != TypeHTTP {
		t.Errorf("expected type TypeHTTP, got %v", server.Type())
	}
}

// Test Docker Server

func TestDockerServer_Success(t *testing.T) {
	ctx := &mockContext{}
	server, err := Docker(ctx, "custom-mcp", &DockerArgs{
		Image: "ghcr.io/org/mcp:latest",
		Args:  []string{"--config", "/etc/mcp.yaml"},
		EnvPlaceholders: map[string]string{
			"API_KEY": "${API_KEY}",
		},
		Volumes: []*types.VolumeMount{
			{HostPath: "/host/data", ContainerPath: "/container/data", ReadOnly: false},
		},
		Ports: []*types.PortMapping{
			{HostPort: 8080, ContainerPort: 80, Protocol: "tcp"},
		},
		Network:       "mcp-network",
		ContainerName: "my-mcp-server",
	})
	server.EnableTools("tool1", "tool2")

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	if server.Name() != "custom-mcp" {
		t.Errorf("expected name 'custom-mcp', got %q", server.Name())
	}

	if server.Image() != "ghcr.io/org/mcp:latest" {
		t.Errorf("expected image 'ghcr.io/org/mcp:latest', got %q", server.Image())
	}

	if len(server.Args()) != 2 {
		t.Errorf("expected 2 args, got %d", len(server.Args()))
	}

	if len(server.Volumes()) != 1 {
		t.Errorf("expected 1 volume, got %d", len(server.Volumes()))
	}

	if len(server.Ports()) != 1 {
		t.Errorf("expected 1 port mapping, got %d", len(server.Ports()))
	}

	if server.Network() != "mcp-network" {
		t.Errorf("expected network 'mcp-network', got %q", server.Network())
	}

	if server.ContainerName() != "my-mcp-server" {
		t.Errorf("expected container name 'my-mcp-server', got %q", server.ContainerName())
	}

	if len(server.EnabledTools()) != 2 {
		t.Errorf("expected 2 enabled tools, got %d", len(server.EnabledTools()))
	}
}

func TestDockerServer_NilArgs(t *testing.T) {
	ctx := &mockContext{}
	server, err := Docker(ctx, "custom-mcp", nil)

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	if server.Name() != "custom-mcp" {
		t.Errorf("expected name 'custom-mcp', got %q", server.Name())
	}
}

func TestDockerServer_Type(t *testing.T) {
	ctx := &mockContext{}
	server, _ := Docker(ctx, "test", &DockerArgs{Image: "test:latest"})

	if server.Type() != TypeDocker {
		t.Errorf("expected type TypeDocker, got %v", server.Type())
	}
}

// Test multiple volumes and ports

func TestDockerServer_MultipleVolumesAndPorts(t *testing.T) {
	ctx := &mockContext{}
	server, err := Docker(ctx, "multi", &DockerArgs{
		Image: "test:latest",
		Volumes: []*types.VolumeMount{
			{HostPath: "/host/data1", ContainerPath: "/data1", ReadOnly: false},
			{HostPath: "/host/data2", ContainerPath: "/data2", ReadOnly: true},
		},
		Ports: []*types.PortMapping{
			{HostPort: 8080, ContainerPort: 80, Protocol: "tcp"},
			{HostPort: 8443, ContainerPort: 443, Protocol: "tcp"},
			{HostPort: 5353, ContainerPort: 53, Protocol: "udp"},
		},
	})

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(server.Volumes()) != 2 {
		t.Errorf("expected 2 volumes, got %d", len(server.Volumes()))
	}

	if len(server.Ports()) != 3 {
		t.Errorf("expected 3 ports, got %d", len(server.Ports()))
	}
}

// Test ServerType

func TestServerType_String(t *testing.T) {
	tests := []struct {
		serverType ServerType
		expected   string
	}{
		{TypeStdio, "stdio"},
		{TypeHTTP, "http"},
		{TypeDocker, "docker"},
		{ServerType(999), "unknown"},
	}

	for _, tt := range tests {
		if got := tt.serverType.String(); got != tt.expected {
			t.Errorf("ServerType(%d).String() = %q, want %q", tt.serverType, got, tt.expected)
		}
	}
}

// Test interface compliance

func TestMCPServer_Interface(t *testing.T) {
	var _ MCPServer = (*StdioServer)(nil)
	var _ MCPServer = (*HTTPServer)(nil)
	var _ MCPServer = (*DockerServer)(nil)
}

// Test EnableTools builder pattern

func TestEnableTools_Chaining(t *testing.T) {
	ctx := &mockContext{}

	// Test Stdio chaining
	stdioServer, _ := Stdio(ctx, "test", &StdioArgs{Command: "echo"})
	result := stdioServer.EnableTools("tool1", "tool2")
	if result != stdioServer {
		t.Error("EnableTools should return the same server for chaining")
	}

	// Test HTTP chaining
	httpServer, _ := HTTP(ctx, "test", &HTTPArgs{Url: "https://example.com"})
	httpResult := httpServer.EnableTools("search")
	if httpResult != httpServer {
		t.Error("EnableTools should return the same server for chaining")
	}

	// Test Docker chaining
	dockerServer, _ := Docker(ctx, "test", &DockerArgs{Image: "test:latest"})
	dockerResult := dockerServer.EnableTools("process")
	if dockerResult != dockerServer {
		t.Error("EnableTools should return the same server for chaining")
	}
}

// Benchmark tests

func BenchmarkStdioServer_Create(b *testing.B) {
	ctx := &mockContext{}
	for i := 0; i < b.N; i++ {
		server, _ := Stdio(ctx, "github", &StdioArgs{
			Command: "npx",
			Args:    []string{"-y", "@modelcontextprotocol/server-github"},
			EnvPlaceholders: map[string]string{
				"GITHUB_TOKEN": "${GITHUB_TOKEN}",
			},
		})
		server.EnableTools("create_issue", "list_repos")
	}
}

func BenchmarkHTTPServer_Create(b *testing.B) {
	ctx := &mockContext{}
	for i := 0; i < b.N; i++ {
		server, _ := HTTP(ctx, "api-service", &HTTPArgs{
			Url: "https://mcp.example.com",
			Headers: map[string]string{
				"Authorization": "Bearer ${API_TOKEN}",
			},
		})
		server.EnableTools("search", "fetch")
	}
}

func BenchmarkDockerServer_Create(b *testing.B) {
	ctx := &mockContext{}
	for i := 0; i < b.N; i++ {
		server, _ := Docker(ctx, "custom-mcp", &DockerArgs{
			Image: "ghcr.io/org/mcp:latest",
			EnvPlaceholders: map[string]string{
				"API_KEY": "${API_KEY}",
			},
		})
		server.EnableTools("tool1")
	}
}
