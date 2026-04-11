package agents

import (
	"testing"

	geninput "github.com/stigmer/stigmer/mcp-server/gen/agentic/agent"
	"github.com/stigmer/stigmer/mcp-server/internal/convert"
	agentv1 "github.com/stigmer/stigmer/mcp-server/proto/ai/stigmer/agentic/agent/v1"
	"github.com/stigmer/stigmer/mcp-server/proto/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/mcp-server/proto/ai/stigmer/commons/apiresource/apiresourcekind"
)

func mustToProto(t *testing.T, input *geninput.AgentInput) *agentv1.Agent {
	t.Helper()
	agent, err := input.ToProto()
	if err != nil {
		t.Fatalf("ToProto() unexpected error: %v", err)
	}
	return agent
}

func TestToProto_minimal(t *testing.T) {
	input := &geninput.AgentInput{
		Instructions: "You review code for quality and security.",
	}
	input.Name = "Code Reviewer"
	input.Org = "acme"

	agent := mustToProto(t, input)

	if agent.ApiVersion != "agentic.stigmer.ai/v1" {
		t.Errorf("ApiVersion = %q, want %q", agent.ApiVersion, "agentic.stigmer.ai/v1")
	}
	if agent.Kind != "Agent" {
		t.Errorf("Kind = %q, want %q", agent.Kind, "Agent")
	}

	meta := agent.GetMetadata()
	if meta.GetName() != "Code Reviewer" {
		t.Errorf("Name = %q, want %q", meta.GetName(), "Code Reviewer")
	}
	if meta.GetOrg() != "acme" {
		t.Errorf("Org = %q, want %q", meta.GetOrg(), "acme")
	}
	if meta.GetSlug() != "code-reviewer" {
		t.Errorf("Slug = %q, want %q (auto-generated)", meta.GetSlug(), "code-reviewer")
	}
	if meta.GetVisibility() != apiresource.ApiResourceVisibility_api_resource_visibility_unspecified {
		t.Errorf("Visibility = %v, want api_resource_visibility_unspecified (empty input)", meta.GetVisibility())
	}

	spec := agent.GetSpec()
	if spec.GetInstructions() != "You review code for quality and security." {
		t.Errorf("Instructions = %q, want input value", spec.GetInstructions())
	}
}

func TestToProto_slugProvided(t *testing.T) {
	input := &geninput.AgentInput{
		Instructions: "You review code.",
	}
	input.Name = "Code Reviewer"
	input.Slug = "my-custom-slug"
	input.Org = "acme"

	agent := mustToProto(t, input)

	if agent.GetMetadata().GetSlug() != "my-custom-slug" {
		t.Errorf("Slug = %q, want %q (user-provided)", agent.GetMetadata().GetSlug(), "my-custom-slug")
	}
}

func TestToProto_slugAutoGeneration(t *testing.T) {
	tests := []struct {
		name     string
		wantSlug string
	}{
		{"My Cool Agent", "my-cool-agent"},
		{"Code Analysis & Review", "code-analysis-review"},
		{"Data Processing (v2)", "data-processing-v2"},
		{"simple", "simple"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			input := &geninput.AgentInput{Instructions: "placeholder"}
			input.Name = tt.name
			input.Org = "x"

			got := mustToProto(t, input).GetMetadata().GetSlug()
			if got != tt.wantSlug {
				t.Errorf("slug for %q = %q, want %q", tt.name, got, tt.wantSlug)
			}
		})
	}
}

func TestToProto_visibilityPublic(t *testing.T) {
	input := &geninput.AgentInput{Instructions: "placeholder"}
	input.Name = "Public Agent"
	input.Org = "acme"
	input.Visibility = "PUBLIC"

	agent := mustToProto(t, input)
	if agent.GetMetadata().GetVisibility() != apiresource.ApiResourceVisibility_visibility_public {
		t.Errorf("Visibility = %v, want visibility_public", agent.GetMetadata().GetVisibility())
	}
}

func TestToProto_visibilityCaseInsensitive(t *testing.T) {
	input := &geninput.AgentInput{Instructions: "placeholder"}
	input.Name = "Agent"
	input.Org = "acme"
	input.Visibility = "public"

	agent := mustToProto(t, input)
	if agent.GetMetadata().GetVisibility() != apiresource.ApiResourceVisibility_visibility_public {
		t.Errorf("Visibility = %v, want visibility_public (case insensitive)", agent.GetMetadata().GetVisibility())
	}
}

func TestToProto_mcpServerRefKind(t *testing.T) {
	input := &geninput.AgentInput{
		Instructions: "placeholder",
		McpServerUsages: []geninput.McpServerUsageInput{
			{
				McpServerRef: geninput.McpServerRefInput{Org: "stigmer", Slug: "github"},
				EnabledTools: []string{"search_code", "create_pr"},
			},
		},
	}
	input.Name = "Agent"
	input.Org = "acme"

	agent := mustToProto(t, input)
	usages := agent.GetSpec().GetMcpServerUsages()
	if len(usages) != 1 {
		t.Fatalf("McpServerUsages length = %d, want 1", len(usages))
	}

	ref := usages[0].GetMcpServerRef()
	if ref.GetKind() != apiresourcekind.ApiResourceKind_mcp_server {
		t.Errorf("McpServerRef.Kind = %v, want mcp_server (44)", ref.GetKind())
	}
	if ref.GetOrg() != "stigmer" {
		t.Errorf("McpServerRef.Org = %q, want %q", ref.GetOrg(), "stigmer")
	}
	if ref.GetSlug() != "github" {
		t.Errorf("McpServerRef.Slug = %q, want %q", ref.GetSlug(), "github")
	}

	tools := usages[0].GetEnabledTools()
	if len(tools) != 2 || tools[0] != "search_code" || tools[1] != "create_pr" {
		t.Errorf("EnabledTools = %v, want [search_code, create_pr]", tools)
	}
}

func TestToProto_skillRefKind(t *testing.T) {
	input := &geninput.AgentInput{
		Instructions: "placeholder",
		SkillRefs: []geninput.SkillRefInput{
			{Org: "stigmer", Slug: "coding-best-practices"},
			{Org: "stigmer", Slug: "security-guidelines", Version: "v1.0"},
		},
	}
	input.Name = "Agent"
	input.Org = "acme"

	agent := mustToProto(t, input)
	refs := agent.GetSpec().GetSkillRefs()
	if len(refs) != 2 {
		t.Fatalf("SkillRefs length = %d, want 2", len(refs))
	}

	for i, ref := range refs {
		if ref.GetKind() != apiresourcekind.ApiResourceKind_skill {
			t.Errorf("SkillRef[%d].Kind = %v, want skill (43)", i, ref.GetKind())
		}
	}

	if refs[0].GetVersion() != "" {
		t.Errorf("SkillRef[0].Version = %q, want empty", refs[0].GetVersion())
	}
	if refs[1].GetVersion() != "v1.0" {
		t.Errorf("SkillRef[1].Version = %q, want %q", refs[1].GetVersion(), "v1.0")
	}
}

func TestToProto_subAgentSkillRefKind(t *testing.T) {
	input := &geninput.AgentInput{
		Instructions: "placeholder",
		SubAgents: []geninput.SubAgentInput{
			{
				Name:         "reviewer",
				Instructions: "Review code changes",
				SkillRefs: []geninput.SkillRefInput{
					{Org: "stigmer", Slug: "code-review"},
				},
				McpAccess: []geninput.McpAccessInput{
					{McpServer: "github", EnabledTools: []string{"search_code"}},
				},
			},
		},
	}
	input.Name = "Agent"
	input.Org = "acme"

	agent := mustToProto(t, input)
	subs := agent.GetSpec().GetSubAgents()
	if len(subs) != 1 {
		t.Fatalf("SubAgents length = %d, want 1", len(subs))
	}

	sub := subs[0]
	if sub.GetName() != "reviewer" {
		t.Errorf("SubAgent.Name = %q, want %q", sub.GetName(), "reviewer")
	}
	if sub.GetInstructions() != "Review code changes" {
		t.Errorf("SubAgent.Instructions = %q, want input value", sub.GetInstructions())
	}

	subRefs := sub.GetSkillRefs()
	if len(subRefs) != 1 {
		t.Fatalf("SubAgent.SkillRefs length = %d, want 1", len(subRefs))
	}
	if subRefs[0].GetKind() != apiresourcekind.ApiResourceKind_skill {
		t.Errorf("SubAgent.SkillRef.Kind = %v, want skill (43)", subRefs[0].GetKind())
	}

	access := sub.GetMcpAccess()
	if len(access) != 1 {
		t.Fatalf("SubAgent.McpAccess length = %d, want 1", len(access))
	}
	if access[0].GetMcpServer() != "github" {
		t.Errorf("McpAccess.McpServer = %q, want %q", access[0].GetMcpServer(), "github")
	}
}

func TestToProto_toolApprovalOverrides(t *testing.T) {
	input := &geninput.AgentInput{
		Instructions: "placeholder",
		McpServerUsages: []geninput.McpServerUsageInput{
			{
				McpServerRef: geninput.McpServerRefInput{Org: "stigmer", Slug: "github"},
				ToolApprovalOverrides: []geninput.ToolApprovalOverrideInput{
					{ToolName: "delete_repo", RequiresApproval: true, Message: "Delete {{args.repo}}"},
				},
			},
		},
	}
	input.Name = "Agent"
	input.Org = "acme"

	agent := mustToProto(t, input)
	overrides := agent.GetSpec().GetMcpServerUsages()[0].GetToolApprovalOverrides()
	if len(overrides) != 1 {
		t.Fatalf("ToolApprovalOverrides length = %d, want 1", len(overrides))
	}
	if overrides[0].GetToolName() != "delete_repo" {
		t.Errorf("ToolName = %q, want %q", overrides[0].GetToolName(), "delete_repo")
	}
	if !overrides[0].GetRequiresApproval() {
		t.Error("RequiresApproval = false, want true")
	}
	if overrides[0].GetMessage() != "Delete {{args.repo}}" {
		t.Errorf("Message = %q, want %q", overrides[0].GetMessage(), "Delete {{args.repo}}")
	}
}

func TestToProto_environment(t *testing.T) {
	input := &geninput.AgentInput{
		Instructions: "placeholder",
		Env: map[string]*geninput.EnvVarDeclarationInput{
			"AWS_REGION": {IsSecret: false, Description: "AWS region", Optional: true},
			"API_KEY":    {IsSecret: true, Description: "API key for external service"},
		},
	}
	input.Name = "Agent"
	input.Org = "acme"

	agent := mustToProto(t, input)
	env := agent.GetSpec().GetEnv()
	if len(env) != 2 {
		t.Fatalf("Env length = %d, want 2", len(env))
	}

	region := env["AWS_REGION"]
	if region.GetIsSecret() {
		t.Error("AWS_REGION.IsSecret = true, want false")
	}
	if region.GetDescription() != "AWS region" {
		t.Errorf("AWS_REGION.Description = %q, want %q", region.GetDescription(), "AWS region")
	}
	if !region.GetOptional() {
		t.Error("AWS_REGION.Optional = false, want true")
	}

	key := env["API_KEY"]
	if !key.GetIsSecret() {
		t.Error("API_KEY.IsSecret = false, want true")
	}
	if key.GetDescription() != "API key for external service" {
		t.Errorf("API_KEY.Description = %q, want %q", key.GetDescription(), "API key for external service")
	}
	if key.GetOptional() {
		t.Error("API_KEY.Optional = true, want false")
	}
}

func TestToProto_labelsAndTags(t *testing.T) {
	input := &geninput.AgentInput{Instructions: "placeholder"}
	input.Name = "Agent"
	input.Org = "acme"
	input.Labels = map[string]string{"team": "platform", "env": "prod"}
	input.Tags = []string{"ai", "code-review"}

	agent := mustToProto(t, input)
	meta := agent.GetMetadata()

	if len(meta.GetLabels()) != 2 {
		t.Fatalf("Labels length = %d, want 2", len(meta.GetLabels()))
	}
	if meta.GetLabels()["team"] != "platform" {
		t.Errorf("Labels[team] = %q, want %q", meta.GetLabels()["team"], "platform")
	}

	if len(meta.GetTags()) != 2 || meta.GetTags()[0] != "ai" {
		t.Errorf("Tags = %v, want [ai, code-review]", meta.GetTags())
	}
}

func TestToProto_fullInput(t *testing.T) {
	input := &geninput.AgentInput{
		Description:  "Helps engineering teams",
		IconUrl:      "https://example.com/icon.svg",
		Instructions: "You are an engineering assistant focused on code quality.",
		McpServerUsages: []geninput.McpServerUsageInput{
			{
				McpServerRef: geninput.McpServerRefInput{Org: "stigmer", Slug: "github"},
				EnabledTools: []string{"search_code", "create_pr"},
			},
		},
		SkillRefs: []geninput.SkillRefInput{
			{Org: "stigmer", Slug: "coding-best-practices", Version: "stable"},
		},
		SubAgents: []geninput.SubAgentInput{
			{
				Name:         "security-scanner",
				Description:  "Scans for security issues",
				Instructions: "Analyze code for vulnerabilities",
				McpAccess:    []geninput.McpAccessInput{{McpServer: "github", EnabledTools: []string{"search_code"}}},
				SkillRefs:    []geninput.SkillRefInput{{Org: "stigmer", Slug: "security-guidelines"}},
			},
		},
		Env: map[string]*geninput.EnvVarDeclarationInput{
			"GITHUB_TOKEN": {IsSecret: true, Description: "GitHub token"},
		},
	}
	input.Name = "Engineering Assistant"
	input.Slug = "eng-assistant"
	input.Org = "acme"
	input.Visibility = "PUBLIC"
	input.Labels = map[string]string{"team": "engineering"}
	input.Tags = []string{"code-review", "security"}

	agent := mustToProto(t, input)

	if agent.ApiVersion != "agentic.stigmer.ai/v1" {
		t.Errorf("ApiVersion = %q", agent.ApiVersion)
	}
	if agent.Kind != "Agent" {
		t.Errorf("Kind = %q", agent.Kind)
	}
	if agent.GetMetadata().GetSlug() != "eng-assistant" {
		t.Errorf("Slug = %q", agent.GetMetadata().GetSlug())
	}
	if agent.GetMetadata().GetVisibility() != apiresource.ApiResourceVisibility_visibility_public {
		t.Errorf("Visibility = %v", agent.GetMetadata().GetVisibility())
	}

	spec := agent.GetSpec()
	if spec.GetDescription() != "Helps engineering teams" {
		t.Errorf("Description = %q", spec.GetDescription())
	}
	if spec.GetIconUrl() != "https://example.com/icon.svg" {
		t.Errorf("IconUrl = %q", spec.GetIconUrl())
	}
	if len(spec.GetMcpServerUsages()) != 1 {
		t.Errorf("McpServerUsages length = %d", len(spec.GetMcpServerUsages()))
	}
	if len(spec.GetSkillRefs()) != 1 {
		t.Errorf("SkillRefs length = %d", len(spec.GetSkillRefs()))
	}
	if len(spec.GetSubAgents()) != 1 {
		t.Errorf("SubAgents length = %d", len(spec.GetSubAgents()))
	}
	if len(spec.GetEnv()) != 1 {
		t.Errorf("Env length = %d, want 1", len(spec.GetEnv()))
	}
}

func TestGenerateSlug(t *testing.T) {
	tests := []struct {
		name     string
		wantSlug string
	}{
		{"", ""},
		{"simple", "simple"},
		{"My Cool Agent", "my-cool-agent"},
		{"Code Analysis & Review", "code-analysis-review"},
		{"Special@#$Characters", "special-characters"},
		{"  leading-trailing  ", "leading-trailing"},
		{"UPPERCASE", "uppercase"},
		{"kebab-case", "kebab-case"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := convert.GenerateSlug(tt.name); got != tt.wantSlug {
				t.Errorf("GenerateSlug(%q) = %q, want %q", tt.name, got, tt.wantSlug)
			}
		})
	}
}
