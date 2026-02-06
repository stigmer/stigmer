package mcpserver

import (
	"testing"

	environmentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/environment/v1"
	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	"github.com/stigmer/stigmer/sdk/go/metadata"
)

func TestToProto_StdioServer(t *testing.T) {
	server := &MCPServer{
		Name: "github-mcp",
		Slug: "github-mcp",
		Args: &McpServerArgs{
			Description: "GitHub MCP server for repository operations",
			IconUrl:     "https://github.com/favicon.ico",
			Tags:        []string{"git", "vcs", "code-analysis"},
			Stdio: &mcpserverv1.StdioServerConfig{
				Command:    "npx",
				Args:       []string{"-y", "@modelcontextprotocol/server-github"},
				WorkingDir: "/tmp",
			},
			DefaultEnabledTools: []string{"search_code", "create_pr"},
		},
	}

	proto, err := server.ToProto()
	if err != nil {
		t.Fatalf("ToProto() returned error: %v", err)
	}

	// Verify API version and kind
	if proto.ApiVersion != "agentic.stigmer.ai/v1" {
		t.Errorf("ApiVersion = %q, want %q", proto.ApiVersion, "agentic.stigmer.ai/v1")
	}
	if proto.Kind != "McpServer" {
		t.Errorf("Kind = %q, want %q", proto.Kind, "McpServer")
	}

	// Verify metadata
	if proto.Metadata == nil {
		t.Fatal("Metadata is nil")
	}
	if proto.Metadata.Name != "github-mcp" {
		t.Errorf("Metadata.Name = %q, want %q", proto.Metadata.Name, "github-mcp")
	}
	if proto.Metadata.Slug != "github-mcp" {
		t.Errorf("Metadata.Slug = %q, want %q", proto.Metadata.Slug, "github-mcp")
	}

	// Verify SDK annotations
	if proto.Metadata.Annotations == nil {
		t.Fatal("Metadata.Annotations is nil")
	}
	if proto.Metadata.Annotations[metadata.AnnotationSDKLanguage] != "go" {
		t.Errorf("Annotation %s = %q, want %q", metadata.AnnotationSDKLanguage, proto.Metadata.Annotations[metadata.AnnotationSDKLanguage], "go")
	}
	if proto.Metadata.Annotations[metadata.AnnotationSDKVersion] != metadata.SDKVersion {
		t.Errorf("Annotation %s = %q, want %q", metadata.AnnotationSDKVersion, proto.Metadata.Annotations[metadata.AnnotationSDKVersion], metadata.SDKVersion)
	}

	// Verify spec
	if proto.Spec == nil {
		t.Fatal("Spec is nil")
	}
	if proto.Spec.Description != "GitHub MCP server for repository operations" {
		t.Errorf("Spec.Description = %q, want %q", proto.Spec.Description, "GitHub MCP server for repository operations")
	}
	if proto.Spec.IconUrl != "https://github.com/favicon.ico" {
		t.Errorf("Spec.IconUrl = %q, want %q", proto.Spec.IconUrl, "https://github.com/favicon.ico")
	}

	// Verify tags
	if len(proto.Spec.Tags) != 3 {
		t.Errorf("len(Spec.Tags) = %d, want 3", len(proto.Spec.Tags))
	}

	// Verify default enabled tools
	if len(proto.Spec.DefaultEnabledTools) != 2 {
		t.Errorf("len(Spec.DefaultEnabledTools) = %d, want 2", len(proto.Spec.DefaultEnabledTools))
	}

	// Verify stdio config
	stdio := proto.Spec.GetStdio()
	if stdio == nil {
		t.Fatal("Stdio config is nil")
	}
	if stdio.Command != "npx" {
		t.Errorf("Stdio.Command = %q, want %q", stdio.Command, "npx")
	}
	if len(stdio.Args) != 2 {
		t.Errorf("len(Stdio.Args) = %d, want 2", len(stdio.Args))
	}
	if stdio.WorkingDir != "/tmp" {
		t.Errorf("Stdio.WorkingDir = %q, want %q", stdio.WorkingDir, "/tmp")
	}
}

func TestToProto_HttpServer(t *testing.T) {
	server := &MCPServer{
		Name: "external-api",
		Slug: "external-api",
		Args: &McpServerArgs{
			Description: "External API MCP server",
			Http: &mcpserverv1.HttpServerConfig{
				Url: "https://mcp.example.com/v1",
				Headers: map[string]string{
					"Authorization": "Bearer ${API_TOKEN}",
					"X-API-Version": "2024-01",
				},
				QueryParams: map[string]string{
					"region": "us-west-2",
				},
				TimeoutSeconds: 60,
			},
		},
	}

	proto, err := server.ToProto()
	if err != nil {
		t.Fatalf("ToProto() returned error: %v", err)
	}

	// Verify http config
	http := proto.Spec.GetHttp()
	if http == nil {
		t.Fatal("Http config is nil")
	}
	if http.Url != "https://mcp.example.com/v1" {
		t.Errorf("Http.Url = %q, want %q", http.Url, "https://mcp.example.com/v1")
	}
	if len(http.Headers) != 2 {
		t.Errorf("len(Http.Headers) = %d, want 2", len(http.Headers))
	}
	if http.Headers["Authorization"] != "Bearer ${API_TOKEN}" {
		t.Errorf("Http.Headers[Authorization] = %q, want %q", http.Headers["Authorization"], "Bearer ${API_TOKEN}")
	}
	if len(http.QueryParams) != 1 {
		t.Errorf("len(Http.QueryParams) = %d, want 1", len(http.QueryParams))
	}
	if http.TimeoutSeconds != 60 {
		t.Errorf("Http.TimeoutSeconds = %d, want 60", http.TimeoutSeconds)
	}
}

func TestToProto_NilArgs(t *testing.T) {
	server := &MCPServer{
		Name: "test",
		Slug: "test",
		Args: nil,
	}

	_, err := server.ToProto()
	if err == nil {
		t.Fatal("ToProto() should return error when Args is nil")
	}
}

func TestToProto_WithEnvSpec(t *testing.T) {
	server := &MCPServer{
		Name: "github-mcp",
		Slug: "github-mcp",
		Args: &McpServerArgs{
			Stdio: &mcpserverv1.StdioServerConfig{
				Command: "npx",
				Args:    []string{"-y", "@modelcontextprotocol/server-github"},
			},
			EnvSpec: &environmentv1.EnvironmentSpec{
				Description: "GitHub environment variables",
				Data: map[string]*environmentv1.EnvironmentValue{
					"GITHUB_TOKEN": {
						Value:       "",
						IsSecret:    true,
						Description: "GitHub personal access token",
					},
					"GITHUB_OWNER": {
						Value:       "default-org",
						IsSecret:    false,
						Description: "Default GitHub organization",
					},
				},
			},
		},
	}

	proto, err := server.ToProto()
	if err != nil {
		t.Fatalf("ToProto() returned error: %v", err)
	}

	// Verify env spec
	if proto.Spec.EnvSpec == nil {
		t.Fatal("EnvSpec is nil")
	}
	if proto.Spec.EnvSpec.Description != "GitHub environment variables" {
		t.Errorf("EnvSpec.Description = %q, want %q", proto.Spec.EnvSpec.Description, "GitHub environment variables")
	}
	if len(proto.Spec.EnvSpec.Data) != 2 {
		t.Errorf("len(EnvSpec.Data) = %d, want 2", len(proto.Spec.EnvSpec.Data))
	}

	// Verify GITHUB_TOKEN is marked as secret
	if token := proto.Spec.EnvSpec.Data["GITHUB_TOKEN"]; token != nil {
		if !token.IsSecret {
			t.Error("GITHUB_TOKEN.IsSecret = false, want true")
		}
	} else {
		t.Error("GITHUB_TOKEN not found in EnvSpec.Data")
	}
}

func TestToProto_WithOrg(t *testing.T) {
	server := &MCPServer{
		Name: "github-mcp",
		Slug: "github-mcp",
		Org:  "my-org",
		Args: &McpServerArgs{
			Description: "GitHub MCP server",
			Stdio: &mcpserverv1.StdioServerConfig{
				Command: "npx",
				Args:    []string{"-y", "@modelcontextprotocol/server-github"},
			},
		},
	}

	proto, err := server.ToProto()
	if err != nil {
		t.Fatalf("ToProto() returned error: %v", err)
	}

	// Verify Org is included in metadata
	if proto.Metadata.Org != "my-org" {
		t.Errorf("Metadata.Org = %q, want %q", proto.Metadata.Org, "my-org")
	}
}

func TestSDKAnnotations(t *testing.T) {
	annotations := metadata.SDKAnnotations()

	if annotations[metadata.AnnotationSDKLanguage] != "go" {
		t.Errorf("SDKAnnotations()[%s] = %q, want %q", metadata.AnnotationSDKLanguage, annotations[metadata.AnnotationSDKLanguage], "go")
	}

	if annotations[metadata.AnnotationSDKVersion] != metadata.SDKVersion {
		t.Errorf("SDKAnnotations()[%s] = %q, want %q", metadata.AnnotationSDKVersion, annotations[metadata.AnnotationSDKVersion], metadata.SDKVersion)
	}

	if _, ok := annotations[metadata.AnnotationSDKGeneratedAt]; !ok {
		t.Errorf("SDKAnnotations() missing %s", metadata.AnnotationSDKGeneratedAt)
	}
}
