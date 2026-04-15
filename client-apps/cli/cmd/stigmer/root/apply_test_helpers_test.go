package root

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"

	agentv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/agent/v1"
	mcpserverv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/mcpserver/v1"
	workflowv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/workflow/v1"
	"github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/commons/apiresource/apiresourcekind"
	organizationv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/tenancy/organization/v1"
	projectv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/tenancy/project/v1"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/agent"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/mcpserver"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/organization"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/project"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/workflow"
)

const (
	testApplyOrgID       = "test-org"
	testApplyProjectName = "my-project"
	testApplyProjectSlug = "my-project"
	testApplyProjectID   = "prj-abc123"
)

func newTestProject(name string) *projectv1.Project {
	return &projectv1.Project{
		ApiVersion: "tenancy.stigmer.ai/v1",
		Kind:       "Project",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: name,
			Slug: name,
			Org:  testApplyOrgID,
		},
		Spec: &projectv1.ProjectSpec{
			Description: "Test project",
		},
	}
}

func newTestProjectApplyResult(name, slug string, created bool) *project.ApplyResult {
	return &project.ApplyResult{
		Project: &projectv1.Project{
			ApiVersion: "tenancy.stigmer.ai/v1",
			Kind:       "Project",
			Metadata: &apiresource.ApiResourceMetadata{
				Name: name,
				Slug: slug,
				Id:   testApplyProjectID,
				Org:  testApplyOrgID,
			},
			Spec:   &projectv1.ProjectSpec{},
			Status: &projectv1.ProjectStatus{},
		},
		Created: created,
	}
}

func newTestMembers(kinds ...apiresourcekind.ApiResourceKind) []*apiresource.ApiResourceReference {
	refs := make([]*apiresource.ApiResourceReference, len(kinds))
	for i, kind := range kinds {
		refs[i] = &apiresource.ApiResourceReference{
			Org:  testApplyOrgID,
			Kind: kind,
			Slug: fmt.Sprintf("%s-%d", kind.String(), i+1),
		}
	}
	return refs
}

func newTestOrganizationApplyResult(created bool) *organization.ApplyResult {
	return &organization.ApplyResult{
		Organization: &organizationv1.Organization{
			Metadata: &apiresource.ApiResourceMetadata{
				Id:   "org-001",
				Name: "Acme Corp",
				Slug: "acme-corp",
				Org:  testApplyOrgID,
			},
			Spec: &organizationv1.OrganizationSpec{
				Description: "Acme Corporation",
			},
		},
		Created: created,
	}
}

func newTestAgentApplyResult(created bool) *agent.ApplyResult {
	return &agent.ApplyResult{
		Agent: &agentv1.Agent{
			Metadata: &apiresource.ApiResourceMetadata{
				Id:   "agt-001",
				Name: "code-reviewer",
				Slug: "code-reviewer",
				Org:  testApplyOrgID,
			},
			Spec: &agentv1.AgentSpec{
				Description:  "Reviews code for quality",
				Instructions: "You are a code reviewer. Analyze code for correctness, style, and performance.",
			},
		},
		Created: created,
	}
}

func newTestWorkflowApplyResult(created bool) *workflow.ApplyResult {
	return &workflow.ApplyResult{
		Workflow: &workflowv1.Workflow{
			Metadata: &apiresource.ApiResourceMetadata{
				Id:   "wfl-001",
				Name: "deploy-pipeline",
				Slug: "deploy-pipeline",
				Org:  testApplyOrgID,
			},
			Spec: &workflowv1.WorkflowSpec{
				Description: "Multi-stage deployment pipeline",
				Tasks: []*workflowv1.WorkflowTask{
					{Name: "build"},
					{Name: "test"},
					{Name: "deploy"},
				},
				Document: &workflowv1.WorkflowDocument{
					Version: "1.0.0",
				},
			},
		},
		Created: created,
	}
}

func newTestMcpServerApplyResult(created bool) *mcpserver.ApplyResult {
	return &mcpserver.ApplyResult{
		McpServer: &mcpserverv1.McpServer{
			Metadata: &apiresource.ApiResourceMetadata{
				Id:   "mcp-001",
				Name: "github-server",
				Slug: "github-server",
				Org:  testApplyOrgID,
			},
			Spec: &mcpserverv1.McpServerSpec{
				Description: "GitHub MCP server",
				Tags:        []string{"git", "vcs"},
				ServerType: &mcpserverv1.McpServerSpec_Stdio{
					Stdio: &mcpserverv1.StdioServerConfig{
						Command: "npx",
						Args:    []string{"-y", "@modelcontextprotocol/server-github"},
					},
				},
			},
		},
		Created: created,
	}
}

// writeResourceYAML creates a minimal valid YAML resource file.
func writeResourceYAML(t *testing.T, dir, filename, kind, name string) string {
	t.Helper()
	content := fmt.Sprintf(`apiVersion: tenancy.stigmer.ai/v1
kind: %s
metadata:
  name: %s
spec:
  description: "Test %s"
`, kind, name, kind)
	path := filepath.Join(dir, filename)
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		t.Fatalf("failed to write %s: %v", path, err)
	}
	return path
}
