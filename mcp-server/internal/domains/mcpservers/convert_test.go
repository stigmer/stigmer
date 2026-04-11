package mcpservers

import (
	"testing"

	geninput "github.com/stigmer/stigmer/mcp-server/gen/agentic/mcpserver"
	mcpserverv1 "github.com/stigmer/stigmer/mcp-server/proto/ai/stigmer/agentic/mcpserver/v1"
	"github.com/stigmer/stigmer/mcp-server/proto/ai/stigmer/commons/apiresource"
)

func mustToProto(t *testing.T, input *geninput.McpServerInput) *mcpserverv1.McpServer {
	t.Helper()
	result, err := input.ToProto()
	if err != nil {
		t.Fatalf("ToProto() unexpected error: %v", err)
	}
	return result
}

func TestToProto_minimal(t *testing.T) {
	input := &geninput.McpServerInput{
		Stdio: &geninput.StdioServerConfigInput{
			Command: "npx",
			Args:    []string{"-y", "@modelcontextprotocol/server-github"},
		},
	}
	input.Name = "GitHub"
	input.Org = "acme"

	mcp := mustToProto(t, input)

	if mcp.ApiVersion != "agentic.stigmer.ai/v1" {
		t.Errorf("ApiVersion = %q, want %q", mcp.ApiVersion, "agentic.stigmer.ai/v1")
	}
	if mcp.Kind != "McpServer" {
		t.Errorf("Kind = %q, want %q", mcp.Kind, "McpServer")
	}

	meta := mcp.GetMetadata()
	if meta.GetName() != "GitHub" {
		t.Errorf("Name = %q, want %q", meta.GetName(), "GitHub")
	}
	if meta.GetOrg() != "acme" {
		t.Errorf("Org = %q, want %q", meta.GetOrg(), "acme")
	}
	if meta.GetSlug() != "github" {
		t.Errorf("Slug = %q, want %q (auto-generated)", meta.GetSlug(), "github")
	}
	if meta.GetVisibility() != apiresource.ApiResourceVisibility_api_resource_visibility_unspecified {
		t.Errorf("Visibility = %v, want api_resource_visibility_unspecified (empty input)", meta.GetVisibility())
	}

	spec := mcp.GetSpec()
	stdio := spec.GetStdio()
	if stdio == nil {
		t.Fatal("Stdio is nil")
	}
	if stdio.GetCommand() != "npx" {
		t.Errorf("Command = %q, want %q", stdio.GetCommand(), "npx")
	}
	if len(stdio.GetArgs()) != 2 || stdio.GetArgs()[0] != "-y" {
		t.Errorf("Args = %v, want [-y @modelcontextprotocol/server-github]", stdio.GetArgs())
	}
}

func TestToProto_slugProvided(t *testing.T) {
	input := &geninput.McpServerInput{}
	input.Name = "GitHub MCP Server"
	input.Slug = "github"
	input.Org = "acme"

	mcp := mustToProto(t, input)

	if mcp.GetMetadata().GetSlug() != "github" {
		t.Errorf("Slug = %q, want %q (user-provided)", mcp.GetMetadata().GetSlug(), "github")
	}
}

func TestToProto_visibilityPublic(t *testing.T) {
	input := &geninput.McpServerInput{}
	input.Name = "Public Server"
	input.Org = "acme"
	input.Visibility = "PUBLIC"

	mcp := mustToProto(t, input)
	if mcp.GetMetadata().GetVisibility() != apiresource.ApiResourceVisibility_visibility_public {
		t.Errorf("Visibility = %v, want visibility_public", mcp.GetMetadata().GetVisibility())
	}
}

func TestToProto_stdioServerType(t *testing.T) {
	input := &geninput.McpServerInput{
		Stdio: &geninput.StdioServerConfigInput{
			Command:    "python",
			Args:       []string{"-m", "mcp_server_sqlite"},
			WorkingDir: "/data",
		},
	}
	input.Name = "SQLite"
	input.Org = "acme"

	mcp := mustToProto(t, input)
	spec := mcp.GetSpec()

	stdio := spec.GetStdio()
	if stdio == nil {
		t.Fatal("Stdio is nil")
	}
	if stdio.GetCommand() != "python" {
		t.Errorf("Command = %q, want %q", stdio.GetCommand(), "python")
	}
	if stdio.GetWorkingDir() != "/data" {
		t.Errorf("WorkingDir = %q, want %q", stdio.GetWorkingDir(), "/data")
	}

	if spec.GetHttp() != nil {
		t.Error("Http should be nil when Stdio is set")
	}
}

func TestToProto_httpServerType(t *testing.T) {
	input := &geninput.McpServerInput{
		Http: &geninput.HttpServerConfigInput{
			Url:            "https://mcp.example.com/v1",
			Headers:        map[string]string{"Authorization": "Bearer ${API_TOKEN}"},
			QueryParams:    map[string]string{"region": "us-west-2"},
			TimeoutSeconds: 60,
		},
	}
	input.Name = "Remote MCP"
	input.Org = "acme"

	mcp := mustToProto(t, input)
	spec := mcp.GetSpec()

	http := spec.GetHttp()
	if http == nil {
		t.Fatal("Http is nil")
	}
	if http.GetUrl() != "https://mcp.example.com/v1" {
		t.Errorf("Url = %q, want %q", http.GetUrl(), "https://mcp.example.com/v1")
	}
	if http.GetHeaders()["Authorization"] != "Bearer ${API_TOKEN}" {
		t.Errorf("Headers[Authorization] = %q", http.GetHeaders()["Authorization"])
	}
	if http.GetQueryParams()["region"] != "us-west-2" {
		t.Errorf("QueryParams[region] = %q", http.GetQueryParams()["region"])
	}
	if http.GetTimeoutSeconds() != 60 {
		t.Errorf("TimeoutSeconds = %d, want 60", http.GetTimeoutSeconds())
	}

	if spec.GetStdio() != nil {
		t.Error("Stdio should be nil when Http is set")
	}
}

func TestToProto_defaultEnabledTools(t *testing.T) {
	input := &geninput.McpServerInput{
		DefaultEnabledTools: []string{"search_code", "create_pr", "get_file"},
	}
	input.Name = "GitHub"
	input.Org = "acme"

	mcp := mustToProto(t, input)
	tools := mcp.GetSpec().GetDefaultEnabledTools()
	if len(tools) != 3 {
		t.Fatalf("DefaultEnabledTools length = %d, want 3", len(tools))
	}
	if tools[0] != "search_code" || tools[1] != "create_pr" || tools[2] != "get_file" {
		t.Errorf("DefaultEnabledTools = %v", tools)
	}
}

func TestToProto_pinnedToolApprovals(t *testing.T) {
	input := &geninput.McpServerInput{
		PinnedToolApprovals: []geninput.ToolApprovalPolicyInput{
			{ToolName: "delete_repository", Message: "Delete repo: {{args.repo}}"},
			{ToolName: "force_push", Message: "Force push to {{args.branch}}"},
		},
	}
	input.Name = "GitHub"
	input.Org = "acme"

	mcp := mustToProto(t, input)
	approvals := mcp.GetSpec().GetPinnedToolApprovals()
	if len(approvals) != 2 {
		t.Fatalf("PinnedToolApprovals length = %d, want 2", len(approvals))
	}
	if approvals[0].GetToolName() != "delete_repository" {
		t.Errorf("ToolName[0] = %q, want %q", approvals[0].GetToolName(), "delete_repository")
	}
	if approvals[0].GetMessage() != "Delete repo: {{args.repo}}" {
		t.Errorf("Message[0] = %q", approvals[0].GetMessage())
	}
	if approvals[1].GetToolName() != "force_push" {
		t.Errorf("ToolName[1] = %q, want %q", approvals[1].GetToolName(), "force_push")
	}
}

func TestToProto_environment(t *testing.T) {
	input := &geninput.McpServerInput{
		Env: map[string]*geninput.EnvVarDeclarationInput{
			"GITHUB_TOKEN": {IsSecret: true, Description: "Personal access token"},
			"GITHUB_OWNER": {IsSecret: false, Description: "Default org", Optional: true},
		},
	}
	input.Name = "GitHub"
	input.Org = "acme"

	mcp := mustToProto(t, input)
	env := mcp.GetSpec().GetEnv()
	if len(env) != 2 {
		t.Fatalf("Env length = %d, want 2", len(env))
	}

	token := env["GITHUB_TOKEN"]
	if !token.GetIsSecret() {
		t.Error("GITHUB_TOKEN.IsSecret = false, want true")
	}
	if token.GetDescription() != "Personal access token" {
		t.Errorf("GITHUB_TOKEN.Description = %q", token.GetDescription())
	}
	if token.GetOptional() {
		t.Error("GITHUB_TOKEN.Optional = true, want false")
	}

	owner := env["GITHUB_OWNER"]
	if owner.GetIsSecret() {
		t.Error("GITHUB_OWNER.IsSecret = true, want false")
	}
	if owner.GetDescription() != "Default org" {
		t.Errorf("GITHUB_OWNER.Description = %q, want %q", owner.GetDescription(), "Default org")
	}
	if !owner.GetOptional() {
		t.Error("GITHUB_OWNER.Optional = false, want true")
	}
}

func TestToProto_labelsAndTags(t *testing.T) {
	input := &geninput.McpServerInput{}
	input.Name = "GitHub"
	input.Org = "acme"
	input.Labels = map[string]string{"team": "platform", "tier": "shared"}
	input.Tags = []string{"vcs", "code-management"}

	mcp := mustToProto(t, input)
	meta := mcp.GetMetadata()

	if len(meta.GetLabels()) != 2 {
		t.Fatalf("Labels length = %d, want 2", len(meta.GetLabels()))
	}
	if meta.GetLabels()["team"] != "platform" {
		t.Errorf("Labels[team] = %q, want %q", meta.GetLabels()["team"], "platform")
	}
	if len(meta.GetTags()) != 2 || meta.GetTags()[0] != "vcs" {
		t.Errorf("Tags = %v, want [vcs code-management]", meta.GetTags())
	}
}

func TestToProto_fullInput(t *testing.T) {
	input := &geninput.McpServerInput{
		Description: "GitHub integration for repository operations",
		IconUrl:     "https://github.com/favicon.svg",
		Stdio: &geninput.StdioServerConfigInput{
			Command: "npx",
			Args:    []string{"-y", "@modelcontextprotocol/server-github"},
		},
		DefaultEnabledTools: []string{"search_code", "create_pr"},
		Env: map[string]*geninput.EnvVarDeclarationInput{
			"GITHUB_TOKEN": {IsSecret: true, Description: "PAT with repo scope"},
		},
		PinnedToolApprovals: []geninput.ToolApprovalPolicyInput{
			{ToolName: "delete_repository", Message: "Delete {{args.repo}}"},
		},
	}
	input.Name = "GitHub MCP Server"
	input.Slug = "github"
	input.Org = "stigmer"
	input.Visibility = "PUBLIC"
	input.Labels = map[string]string{"category": "vcs"}
	input.Tags = []string{"github", "code"}

	mcp := mustToProto(t, input)

	if mcp.ApiVersion != "agentic.stigmer.ai/v1" {
		t.Errorf("ApiVersion = %q", mcp.ApiVersion)
	}
	if mcp.Kind != "McpServer" {
		t.Errorf("Kind = %q", mcp.Kind)
	}
	if mcp.GetMetadata().GetSlug() != "github" {
		t.Errorf("Slug = %q", mcp.GetMetadata().GetSlug())
	}
	if mcp.GetMetadata().GetVisibility() != apiresource.ApiResourceVisibility_visibility_public {
		t.Errorf("Visibility = %v", mcp.GetMetadata().GetVisibility())
	}

	spec := mcp.GetSpec()
	if spec.GetDescription() != "GitHub integration for repository operations" {
		t.Errorf("Description = %q", spec.GetDescription())
	}
	if spec.GetIconUrl() != "https://github.com/favicon.svg" {
		t.Errorf("IconUrl = %q", spec.GetIconUrl())
	}
	if spec.GetStdio() == nil {
		t.Error("Stdio is nil")
	}
	if len(spec.GetDefaultEnabledTools()) != 2 {
		t.Errorf("DefaultEnabledTools length = %d", len(spec.GetDefaultEnabledTools()))
	}
	if len(spec.GetEnv()) != 1 {
		t.Errorf("Env length = %d, want 1", len(spec.GetEnv()))
	}
	if len(spec.GetPinnedToolApprovals()) != 1 {
		t.Errorf("PinnedToolApprovals length = %d", len(spec.GetPinnedToolApprovals()))
	}
}
