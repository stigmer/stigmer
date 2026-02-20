package agents

import (
	"testing"

	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/mcp-server/internal/domains"
)

func TestToProto_minimal(t *testing.T) {
	input := &ApplyAgentInput{
		ResourceIdentity: domains.ResourceIdentity{
			Name: "Code Reviewer",
			Org:  "acme",
		},
		Instructions: "You review code for quality and security.",
	}

	agent := input.toProto()

	if agent.ApiVersion != agentAPIVersion {
		t.Errorf("ApiVersion = %q, want %q", agent.ApiVersion, agentAPIVersion)
	}
	if agent.Kind != agentKind {
		t.Errorf("Kind = %q, want %q", agent.Kind, agentKind)
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
	if meta.GetVisibility() != apiresource.ApiResourceVisibility_visibility_private {
		t.Errorf("Visibility = %v, want visibility_private", meta.GetVisibility())
	}

	spec := agent.GetSpec()
	if spec.GetInstructions() != "You review code for quality and security." {
		t.Errorf("Instructions = %q, want input value", spec.GetInstructions())
	}
}

func TestToProto_slugProvided(t *testing.T) {
	input := &ApplyAgentInput{
		ResourceIdentity: domains.ResourceIdentity{
			Name: "Code Reviewer",
			Slug: "my-custom-slug",
			Org:  "acme",
		},
		Instructions: "You review code.",
	}

	agent := input.toProto()

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
			input := &ApplyAgentInput{
				ResourceIdentity: domains.ResourceIdentity{Name: tt.name, Org: "x"},
				Instructions:     "placeholder",
			}
			got := input.toProto().GetMetadata().GetSlug()
			if got != tt.wantSlug {
				t.Errorf("slug for %q = %q, want %q", tt.name, got, tt.wantSlug)
			}
		})
	}
}

func TestToProto_visibilityPublic(t *testing.T) {
	input := &ApplyAgentInput{
		ResourceIdentity: domains.ResourceIdentity{
			Name:       "Public Agent",
			Org:        "acme",
			Visibility: "PUBLIC",
		},
		Instructions: "placeholder",
	}

	agent := input.toProto()
	if agent.GetMetadata().GetVisibility() != apiresource.ApiResourceVisibility_visibility_public {
		t.Errorf("Visibility = %v, want visibility_public", agent.GetMetadata().GetVisibility())
	}
}

func TestToProto_visibilityCaseInsensitive(t *testing.T) {
	input := &ApplyAgentInput{
		ResourceIdentity: domains.ResourceIdentity{
			Name:       "Agent",
			Org:        "acme",
			Visibility: "public",
		},
		Instructions: "placeholder",
	}

	agent := input.toProto()
	if agent.GetMetadata().GetVisibility() != apiresource.ApiResourceVisibility_visibility_public {
		t.Errorf("Visibility = %v, want visibility_public (case insensitive)", agent.GetMetadata().GetVisibility())
	}
}

func TestToProto_mcpServerRefKind(t *testing.T) {
	input := &ApplyAgentInput{
		ResourceIdentity: domains.ResourceIdentity{Name: "Agent", Org: "acme"},
		Instructions:     "placeholder",
		McpServerUsages: []McpServerUsageInput{
			{
				McpServerRef: McpServerRefInput{Org: "stigmer", Slug: "github"},
				EnabledTools: []string{"search_code", "create_pr"},
			},
		},
	}

	agent := input.toProto()
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
	input := &ApplyAgentInput{
		ResourceIdentity: domains.ResourceIdentity{Name: "Agent", Org: "acme"},
		Instructions:     "placeholder",
		SkillRefs: []SkillRefInput{
			{Org: "stigmer", Slug: "coding-best-practices"},
			{Org: "stigmer", Slug: "security-guidelines", Version: "v1.0"},
		},
	}

	agent := input.toProto()
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
	input := &ApplyAgentInput{
		ResourceIdentity: domains.ResourceIdentity{Name: "Agent", Org: "acme"},
		Instructions:     "placeholder",
		SubAgents: []SubAgentInput{
			{
				Name:         "reviewer",
				Instructions: "Review code changes",
				SkillRefs: []SkillRefInput{
					{Org: "stigmer", Slug: "code-review"},
				},
				McpAccess: []McpAccessInput{
					{McpServer: "github", EnabledTools: []string{"search_code"}},
				},
			},
		},
	}

	agent := input.toProto()
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
	input := &ApplyAgentInput{
		ResourceIdentity: domains.ResourceIdentity{Name: "Agent", Org: "acme"},
		Instructions:     "placeholder",
		McpServerUsages: []McpServerUsageInput{
			{
				McpServerRef: McpServerRefInput{Org: "stigmer", Slug: "github"},
				ToolApprovalOverrides: []ToolApprovalOverrideInput{
					{ToolName: "delete_repo", RequiresApproval: true, Message: "Delete {{args.repo}}"},
				},
			},
		},
	}

	agent := input.toProto()
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
	input := &ApplyAgentInput{
		ResourceIdentity: domains.ResourceIdentity{Name: "Agent", Org: "acme"},
		Instructions:     "placeholder",
		EnvSpec: &EnvironmentInput{
			Description: "Production credentials",
			Data: map[string]EnvironmentValue{
				"AWS_REGION": {Value: "us-west-2", IsSecret: false, Description: "AWS region"},
				"API_KEY":    {Value: "", IsSecret: true, Description: "API key for external service"},
			},
		},
	}

	agent := input.toProto()
	env := agent.GetSpec().GetEnvSpec()
	if env == nil {
		t.Fatal("EnvSpec is nil")
	}
	if env.GetDescription() != "Production credentials" {
		t.Errorf("EnvSpec.Description = %q, want %q", env.GetDescription(), "Production credentials")
	}
	if len(env.GetData()) != 2 {
		t.Fatalf("EnvSpec.Data length = %d, want 2", len(env.GetData()))
	}

	region := env.GetData()["AWS_REGION"]
	if region.GetValue() != "us-west-2" {
		t.Errorf("AWS_REGION.Value = %q, want %q", region.GetValue(), "us-west-2")
	}
	if region.GetIsSecret() {
		t.Error("AWS_REGION.IsSecret = true, want false")
	}

	key := env.GetData()["API_KEY"]
	if !key.GetIsSecret() {
		t.Error("API_KEY.IsSecret = false, want true")
	}
}

func TestToProto_labelsAndTags(t *testing.T) {
	input := &ApplyAgentInput{
		ResourceIdentity: domains.ResourceIdentity{
			Name:   "Agent",
			Org:    "acme",
			Labels: map[string]string{"team": "platform", "env": "prod"},
			Tags:   []string{"ai", "code-review"},
		},
		Instructions: "placeholder",
	}

	agent := input.toProto()
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
	input := &ApplyAgentInput{
		ResourceIdentity: domains.ResourceIdentity{
			Name:       "Engineering Assistant",
			Slug:       "eng-assistant",
			Org:        "acme",
			Visibility: "PUBLIC",
			Labels:     map[string]string{"team": "engineering"},
			Tags:       []string{"code-review", "security"},
		},
		Description:  "Helps engineering teams",
		IconUrl:      "https://example.com/icon.svg",
		Instructions: "You are an engineering assistant focused on code quality.",
		McpServerUsages: []McpServerUsageInput{
			{
				McpServerRef: McpServerRefInput{Org: "stigmer", Slug: "github"},
				EnabledTools: []string{"search_code", "create_pr"},
			},
		},
		SkillRefs: []SkillRefInput{
			{Org: "stigmer", Slug: "coding-best-practices", Version: "stable"},
		},
		SubAgents: []SubAgentInput{
			{
				Name:         "security-scanner",
				Description:  "Scans for security issues",
				Instructions: "Analyze code for vulnerabilities",
				McpAccess:    []McpAccessInput{{McpServer: "github", EnabledTools: []string{"search_code"}}},
				SkillRefs:    []SkillRefInput{{Org: "stigmer", Slug: "security-guidelines"}},
			},
		},
		EnvSpec: &EnvironmentInput{
			Description: "Required credentials",
			Data: map[string]EnvironmentValue{
				"GITHUB_TOKEN": {IsSecret: true, Description: "GitHub token"},
			},
		},
	}

	agent := input.toProto()

	if agent.ApiVersion != agentAPIVersion {
		t.Errorf("ApiVersion = %q", agent.ApiVersion)
	}
	if agent.Kind != agentKind {
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
	if spec.GetEnvSpec() == nil {
		t.Error("EnvSpec is nil")
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
			if got := generateSlug(tt.name); got != tt.wantSlug {
				t.Errorf("generateSlug(%q) = %q, want %q", tt.name, got, tt.wantSlug)
			}
		})
	}
}
