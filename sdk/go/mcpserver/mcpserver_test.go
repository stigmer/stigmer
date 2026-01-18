package mcpserver

import (
	"testing"
)

// Test Stdio Server

func TestStdioServer_Success(t *testing.T) {
	server, err := Stdio(
		WithName("github"),
		WithCommand("npx"),
		WithArgs("-y", "@modelcontextprotocol/server-github"),
		WithEnvPlaceholder("GITHUB_TOKEN", "${GITHUB_TOKEN}"),
		WithWorkingDir("/app"),
		WithEnabledTools("create_issue", "list_repos"),
	)

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

func TestStdioServer_MissingName(t *testing.T) {
	_, err := Stdio(
		WithCommand("npx"),
	)

	if err == nil {
		t.Fatal("expected error for missing name, got nil")
	}
}

func TestStdioServer_MissingCommand(t *testing.T) {
	_, err := Stdio(
		WithName("github"),
	)

	if err == nil {
		t.Fatal("expected error for missing command, got nil")
	}
}



// Test HTTP Server

func TestHTTPServer_Success(t *testing.T) {
	server, err := HTTP(
		WithName("api-service"),
		WithURL("https://mcp.example.com"),
		WithHeader("Authorization", "Bearer ${API_TOKEN}"),
		WithQueryParam("region", "${AWS_REGION}"),
		WithTimeout(60),
		WithEnabledTools("search", "fetch"),
	)

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

func TestHTTPServer_MissingName(t *testing.T) {
	_, err := HTTP(
		WithURL("https://mcp.example.com"),
	)

	if err == nil {
		t.Fatal("expected error for missing name, got nil")
	}
}

func TestHTTPServer_MissingURL(t *testing.T) {
	_, err := HTTP(
		WithName("api-service"),
	)

	if err == nil {
		t.Fatal("expected error for missing url, got nil")
	}
}

func TestHTTPServer_InvalidURL(t *testing.T) {
	_, err := HTTP(
		WithName("api-service"),
		WithURL("not a valid url"),
	)

	if err == nil {
		t.Fatal("expected error for invalid url, got nil")
	}
}

func TestHTTPServer_DefaultTimeout(t *testing.T) {
	server, err := HTTP(
		WithName("api-service"),
		WithURL("https://mcp.example.com"),
	)

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if server.TimeoutSeconds() != 30 {
		t.Errorf("expected default timeout 30, got %d", server.TimeoutSeconds())
	}
}



// Test Docker Server

func TestDockerServer_Success(t *testing.T) {
	server, err := Docker(
		WithName("custom-mcp"),
		WithImage("ghcr.io/org/mcp:latest"),
		WithArgs("--config", "/etc/mcp.yaml"),
		WithEnvPlaceholder("API_KEY", "${API_KEY}"),
		WithVolumeMount("/host/data", "/container/data", false),
		WithPortMapping(8080, 80, "tcp"),
		WithNetwork("mcp-network"),
		WithContainerName("my-mcp-server"),
		WithEnabledTools("tool1", "tool2"),
	)

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

func TestDockerServer_MissingName(t *testing.T) {
	_, err := Docker(
		WithImage("ghcr.io/org/mcp:latest"),
	)

	if err == nil {
		t.Fatal("expected error for missing name, got nil")
	}
}

func TestDockerServer_MissingImage(t *testing.T) {
	_, err := Docker(
		WithName("custom-mcp"),
	)

	if err == nil {
		t.Fatal("expected error for missing image, got nil")
	}
}

func TestDockerServer_InvalidVolumeMount(t *testing.T) {
	_, err := Docker(
		WithName("custom-mcp"),
		WithImage("ghcr.io/org/mcp:latest"),
		WithVolumeMount("", "/container/data", false),
	)

	if err == nil {
		t.Fatal("expected error for invalid volume mount, got nil")
	}
}

func TestDockerServer_InvalidPortMapping(t *testing.T) {
	_, err := Docker(
		WithName("custom-mcp"),
		WithImage("ghcr.io/org/mcp:latest"),
		WithPortMapping(-1, 80, "tcp"),
	)

	if err == nil {
		t.Fatal("expected error for invalid port mapping, got nil")
	}
}

func TestDockerServer_InvalidProtocol(t *testing.T) {
	_, err := Docker(
		WithName("custom-mcp"),
		WithImage("ghcr.io/org/mcp:latest"),
		WithPortMapping(8080, 80, "invalid"),
	)

	if err == nil {
		t.Fatal("expected error for invalid protocol, got nil")
	}
}



// Test VolumeMount and PortMapping







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

// Test option errors

func TestOption_WrongServerType(t *testing.T) {
	tests := []struct {
		name   string
		option Option
		server interface{}
	}{
		{
			name:   "WithCommand on HTTPServer",
			option: WithCommand("test"),
			server: &HTTPServer{},
		},
		{
			name:   "WithURL on StdioServer",
			option: WithURL("https://example.com"),
			server: &StdioServer{},
		},
		{
			name:   "WithImage on StdioServer",
			option: WithImage("test:latest"),
			server: &StdioServer{},
		},
		{
			name:   "WithWorkingDir on HTTPServer",
			option: WithWorkingDir("/app"),
			server: &HTTPServer{},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := tt.option(tt.server)
			if err == nil {
				t.Errorf("expected error for %s, got nil", tt.name)
			}
		})
	}
}

// Test multiple volumes and ports

func TestDockerServer_MultipleVolumesAndPorts(t *testing.T) {
	server, err := Docker(
		WithName("multi"),
		WithImage("test:latest"),
		WithVolumeMount("/host/data1", "/data1", false),
		WithVolumeMount("/host/data2", "/data2", true),
		WithPortMapping(8080, 80, "tcp"),
		WithPortMapping(8443, 443, "tcp"),
		WithPortMapping(5353, 53, "udp"),
	)

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

// Benchmark tests

func BenchmarkStdioServer_Create(b *testing.B) {
	for i := 0; i < b.N; i++ {
		_, _ = Stdio(
			WithName("github"),
			WithCommand("npx"),
			WithArgs("-y", "@modelcontextprotocol/server-github"),
			WithEnvPlaceholder("GITHUB_TOKEN", "${GITHUB_TOKEN}"),
		)
	}
}



func BenchmarkHTTPServer_Create(b *testing.B) {
	for i := 0; i < b.N; i++ {
		_, _ = HTTP(
			WithName("api-service"),
			WithURL("https://mcp.example.com"),
			WithHeader("Authorization", "Bearer ${API_TOKEN}"),
		)
	}
}

func BenchmarkDockerServer_Create(b *testing.B) {
	for i := 0; i < b.N; i++ {
		_, _ = Docker(
			WithName("custom-mcp"),
			WithImage("ghcr.io/org/mcp:latest"),
			WithEnvPlaceholder("API_KEY", "${API_KEY}"),
		)
	}
}
