package workflows

import (
	"testing"

	geninput "github.com/stigmer/stigmer/mcp-server/gen/agentic/workflow"
	workflowv1 "github.com/stigmer/stigmer/mcp-server/proto/ai/stigmer/agentic/workflow/v1"
	"github.com/stigmer/stigmer/mcp-server/proto/ai/stigmer/commons/apiresource"
)

func mustToProto(t *testing.T, input *geninput.WorkflowInput) *workflowv1.Workflow {
	t.Helper()
	result, err := input.ToProto()
	if err != nil {
		t.Fatalf("ToProto() unexpected error: %v", err)
	}
	return result
}

func TestToProto_minimal(t *testing.T) {
	input := &geninput.WorkflowInput{
		Document: &geninput.WorkflowDocumentInput{
			Dsl:       "1.0.0",
			Namespace: "acme",
			Name:      "deploy",
			Version:   "0.1.0",
		},
	}
	input.Name = "Deploy Workflow"
	input.Org = "acme"

	wf := mustToProto(t, input)

	if wf.ApiVersion != "agentic.stigmer.ai/v1" {
		t.Errorf("ApiVersion = %q, want %q", wf.ApiVersion, "agentic.stigmer.ai/v1")
	}
	if wf.Kind != "Workflow" {
		t.Errorf("Kind = %q, want %q", wf.Kind, "Workflow")
	}

	meta := wf.GetMetadata()
	if meta.GetName() != "Deploy Workflow" {
		t.Errorf("Name = %q, want %q", meta.GetName(), "Deploy Workflow")
	}
	if meta.GetOrg() != "acme" {
		t.Errorf("Org = %q, want %q", meta.GetOrg(), "acme")
	}
	if meta.GetSlug() != "deploy-workflow" {
		t.Errorf("Slug = %q, want %q (auto-generated)", meta.GetSlug(), "deploy-workflow")
	}
	if meta.GetVisibility() != apiresource.ApiResourceVisibility_api_resource_visibility_unspecified {
		t.Errorf("Visibility = %v, want api_resource_visibility_unspecified (empty input)", meta.GetVisibility())
	}

	doc := wf.GetSpec().GetDocument()
	if doc == nil {
		t.Fatal("Document is nil")
	}
	if doc.GetDsl() != "1.0.0" {
		t.Errorf("Dsl = %q, want %q", doc.GetDsl(), "1.0.0")
	}
	if doc.GetNamespace() != "acme" {
		t.Errorf("Namespace = %q, want %q", doc.GetNamespace(), "acme")
	}
	if doc.GetName() != "deploy" {
		t.Errorf("Document.Name = %q, want %q", doc.GetName(), "deploy")
	}
	if doc.GetVersion() != "0.1.0" {
		t.Errorf("Version = %q, want %q", doc.GetVersion(), "0.1.0")
	}
}

func TestToProto_slugProvided(t *testing.T) {
	input := &geninput.WorkflowInput{
		Document: &geninput.WorkflowDocumentInput{
			Namespace: "ns", Name: "w", Version: "1.0.0",
		},
	}
	input.Name = "My Workflow"
	input.Slug = "custom-slug"
	input.Org = "acme"

	wf := mustToProto(t, input)
	if wf.GetMetadata().GetSlug() != "custom-slug" {
		t.Errorf("Slug = %q, want %q (user-provided)", wf.GetMetadata().GetSlug(), "custom-slug")
	}
}

func TestToProto_visibilityPublic(t *testing.T) {
	input := &geninput.WorkflowInput{
		Document: &geninput.WorkflowDocumentInput{
			Namespace: "ns", Name: "w", Version: "1.0.0",
		},
	}
	input.Name = "Public Workflow"
	input.Org = "acme"
	input.Visibility = "PUBLIC"

	wf := mustToProto(t, input)
	if wf.GetMetadata().GetVisibility() != apiresource.ApiResourceVisibility_visibility_public {
		t.Errorf("Visibility = %v, want visibility_public", wf.GetMetadata().GetVisibility())
	}
}

func TestToProto_taskWithEnumKind(t *testing.T) {
	input := &geninput.WorkflowInput{
		Document: &geninput.WorkflowDocumentInput{
			Namespace: "acme", Name: "deploy", Version: "1.0.0",
		},
		Tasks: []geninput.WorkflowTaskInput{
			{
				Name: "fetchData",
				Kind: "http_call",
				HttpCall: &geninput.HttpCallTaskConfigInput{
					Method:   "GET",
					Endpoint: &geninput.HttpEndpointInput{Uri: "https://api.example.com"},
				},
			},
		},
	}
	input.Name = "Deploy"
	input.Org = "acme"

	wf := mustToProto(t, input)
	tasks := wf.GetSpec().GetTasks()
	if len(tasks) != 1 {
		t.Fatalf("Tasks length = %d, want 1", len(tasks))
	}

	task := tasks[0]
	if task.GetName() != "fetchData" {
		t.Errorf("Task.Name = %q, want %q", task.GetName(), "fetchData")
	}
	if task.GetKind() != workflowv1.WorkflowTaskKind_http_call {
		t.Errorf("Task.Kind = %v, want http_call (%d)", task.GetKind(), workflowv1.WorkflowTaskKind_http_call)
	}

	tc := task.GetTaskConfig()
	if tc == nil {
		t.Fatal("TaskConfig is nil")
	}
	fields := tc.GetFields()
	if fields["method"].GetStringValue() != "GET" {
		t.Errorf("TaskConfig.method = %q, want %q", fields["method"].GetStringValue(), "GET")
	}
}

func TestToProto_taskWithExportAndFlow(t *testing.T) {
	input := &geninput.WorkflowInput{
		Document: &geninput.WorkflowDocumentInput{
			Namespace: "acme", Name: "pipeline", Version: "1.0.0",
		},
		Tasks: []geninput.WorkflowTaskInput{
			{
				Name:    "setVars",
				Kind:    "set_vars",
				SetVars: &geninput.SetTaskConfigInput{Variables: map[string]string{"key": "value"}},
				Export:  &geninput.ExportInput{As: "${.}"},
				Flow:    &geninput.FlowControlInput{Then: "nextStep"},
			},
			{
				Name: "nextStep",
				Kind: "http_call",
				HttpCall: &geninput.HttpCallTaskConfigInput{
					Endpoint: &geninput.HttpEndpointInput{Uri: "https://example.com"},
				},
				Flow: &geninput.FlowControlInput{Then: "end"},
			},
		},
	}
	input.Name = "Pipeline"
	input.Org = "acme"

	wf := mustToProto(t, input)
	tasks := wf.GetSpec().GetTasks()
	if len(tasks) != 2 {
		t.Fatalf("Tasks length = %d, want 2", len(tasks))
	}

	if tasks[0].GetExport().GetAs() != "${.}" {
		t.Errorf("Task[0].Export.As = %q, want %q", tasks[0].GetExport().GetAs(), "${.}")
	}
	if tasks[0].GetFlow().GetThen() != "nextStep" {
		t.Errorf("Task[0].Flow.Then = %q, want %q", tasks[0].GetFlow().GetThen(), "nextStep")
	}
	if tasks[1].GetFlow().GetThen() != "end" {
		t.Errorf("Task[1].Flow.Then = %q, want %q", tasks[1].GetFlow().GetThen(), "end")
	}
}

func TestToProto_taskConfigEmpty(t *testing.T) {
	input := &geninput.WorkflowInput{
		Document: &geninput.WorkflowDocumentInput{
			Namespace: "acme", Name: "w", Version: "1.0.0",
		},
		Tasks: []geninput.WorkflowTaskInput{
			{
				Name:    "setEmpty",
				Kind:    "set_vars",
				SetVars: &geninput.SetTaskConfigInput{Variables: map[string]string{}},
			},
		},
	}
	input.Name = "Workflow"
	input.Org = "acme"

	wf := mustToProto(t, input)
	task := wf.GetSpec().GetTasks()[0]
	if task.GetTaskConfig() == nil {
		t.Error("TaskConfig should not be nil when typed config is provided")
	}
}

func TestToProto_environment(t *testing.T) {
	input := &geninput.WorkflowInput{
		Document: &geninput.WorkflowDocumentInput{
			Namespace: "acme", Name: "deploy", Version: "1.0.0",
		},
		Env: map[string]*geninput.EnvVarDeclarationInput{
			"DEPLOY_KEY": {IsSecret: true, Description: "SSH deploy key"},
			"REGION":     {IsSecret: false, Description: "Target region", Optional: true},
		},
	}
	input.Name = "Deploy"
	input.Org = "acme"

	wf := mustToProto(t, input)
	env := wf.GetSpec().GetEnv()
	if len(env) != 2 {
		t.Fatalf("Env length = %d, want 2", len(env))
	}

	key := env["DEPLOY_KEY"]
	if !key.GetIsSecret() {
		t.Error("DEPLOY_KEY.IsSecret = false, want true")
	}
	if key.GetDescription() != "SSH deploy key" {
		t.Errorf("DEPLOY_KEY.Description = %q, want %q", key.GetDescription(), "SSH deploy key")
	}
	if key.GetOptional() {
		t.Error("DEPLOY_KEY.Optional = true, want false")
	}

	region := env["REGION"]
	if region.GetIsSecret() {
		t.Error("REGION.IsSecret = true, want false")
	}
	if region.GetDescription() != "Target region" {
		t.Errorf("REGION.Description = %q, want %q", region.GetDescription(), "Target region")
	}
	if !region.GetOptional() {
		t.Error("REGION.Optional = false, want true")
	}
}

func TestToProto_labelsAndTags(t *testing.T) {
	input := &geninput.WorkflowInput{
		Document: &geninput.WorkflowDocumentInput{
			Namespace: "acme", Name: "w", Version: "1.0.0",
		},
	}
	input.Name = "Tagged Workflow"
	input.Org = "acme"
	input.Labels = map[string]string{"env": "prod", "team": "infra"}
	input.Tags = []string{"deployment", "automation"}

	wf := mustToProto(t, input)
	meta := wf.GetMetadata()

	if len(meta.GetLabels()) != 2 {
		t.Fatalf("Labels length = %d, want 2", len(meta.GetLabels()))
	}
	if meta.GetLabels()["env"] != "prod" {
		t.Errorf("Labels[env] = %q, want %q", meta.GetLabels()["env"], "prod")
	}
	if len(meta.GetTags()) != 2 || meta.GetTags()[0] != "deployment" {
		t.Errorf("Tags = %v, want [deployment automation]", meta.GetTags())
	}
}

func TestToProto_documentDescription(t *testing.T) {
	input := &geninput.WorkflowInput{
		Document: &geninput.WorkflowDocumentInput{
			Dsl:         "1.0.0",
			Namespace:   "acme",
			Name:        "onboard",
			Version:     "2.0.0",
			Description: "Onboards new employees",
		},
	}
	input.Name = "Onboarding"
	input.Org = "acme"

	wf := mustToProto(t, input)
	doc := wf.GetSpec().GetDocument()
	if doc.GetDescription() != "Onboards new employees" {
		t.Errorf("Document.Description = %q", doc.GetDescription())
	}
}

func TestToProto_multipleTasks(t *testing.T) {
	input := &geninput.WorkflowInput{
		Document: &geninput.WorkflowDocumentInput{
			Namespace: "acme", Name: "multi", Version: "1.0.0",
		},
		Tasks: []geninput.WorkflowTaskInput{
			{Name: "step1", Kind: "set_vars", SetVars: &geninput.SetTaskConfigInput{Variables: map[string]string{"x": "1"}}},
			{Name: "step2", Kind: "http_call", HttpCall: &geninput.HttpCallTaskConfigInput{Endpoint: &geninput.HttpEndpointInput{Uri: "https://a.com"}}},
			{Name: "step3", Kind: "agent_call", AgentCall: &geninput.AgentCallTaskConfigInput{Agent: "reviewer", Message: "review"}},
		},
	}
	input.Name = "Multi-Step"
	input.Org = "acme"

	wf := mustToProto(t, input)
	tasks := wf.GetSpec().GetTasks()
	if len(tasks) != 3 {
		t.Fatalf("Tasks length = %d, want 3", len(tasks))
	}
	if tasks[0].GetKind() != workflowv1.WorkflowTaskKind_set_vars {
		t.Errorf("Task[0].Kind = %v, want set_vars", tasks[0].GetKind())
	}
	if tasks[1].GetKind() != workflowv1.WorkflowTaskKind_http_call {
		t.Errorf("Task[1].Kind = %v, want http_call", tasks[1].GetKind())
	}
	if tasks[2].GetKind() != workflowv1.WorkflowTaskKind_agent_call {
		t.Errorf("Task[2].Kind = %v, want agent_call", tasks[2].GetKind())
	}
}

func TestToProto_fullInput(t *testing.T) {
	input := &geninput.WorkflowInput{
		Description: "Full deploy pipeline",
		Document: &geninput.WorkflowDocumentInput{
			Dsl:         "1.0.0",
			Namespace:   "acme",
			Name:        "full-deploy",
			Version:     "1.0.0",
			Description: "Complete deployment workflow",
		},
		Tasks: []geninput.WorkflowTaskInput{
			{
				Name:    "prepare",
				Kind:    "set_vars",
				SetVars: &geninput.SetTaskConfigInput{Variables: map[string]string{"env": "prod"}},
				Export:  &geninput.ExportInput{As: "${.}"},
				Flow:    &geninput.FlowControlInput{Then: "deploy"},
			},
			{
				Name: "deploy",
				Kind: "http_call",
				HttpCall: &geninput.HttpCallTaskConfigInput{
					Method:   "POST",
					Endpoint: &geninput.HttpEndpointInput{Uri: "https://deploy.example.com"},
				},
			},
		},
		Env: map[string]*geninput.EnvVarDeclarationInput{
			"TOKEN": {IsSecret: true, Description: "Deploy token"},
		},
	}
	input.Name = "Full Deploy Pipeline"
	input.Slug = "full-deploy"
	input.Org = "acme"
	input.Visibility = "PUBLIC"
	input.Labels = map[string]string{"env": "prod"}
	input.Tags = []string{"deploy", "pipeline"}

	wf := mustToProto(t, input)

	if wf.ApiVersion != "agentic.stigmer.ai/v1" {
		t.Errorf("ApiVersion = %q", wf.ApiVersion)
	}
	if wf.Kind != "Workflow" {
		t.Errorf("Kind = %q", wf.Kind)
	}
	if wf.GetMetadata().GetSlug() != "full-deploy" {
		t.Errorf("Slug = %q", wf.GetMetadata().GetSlug())
	}
	if wf.GetMetadata().GetVisibility() != apiresource.ApiResourceVisibility_visibility_public {
		t.Errorf("Visibility = %v", wf.GetMetadata().GetVisibility())
	}

	spec := wf.GetSpec()
	if spec.GetDescription() != "Full deploy pipeline" {
		t.Errorf("Description = %q", spec.GetDescription())
	}
	if spec.GetDocument() == nil {
		t.Error("Document is nil")
	}
	if len(spec.GetTasks()) != 2 {
		t.Errorf("Tasks length = %d", len(spec.GetTasks()))
	}
	if len(spec.GetEnv()) != 1 {
		t.Errorf("Env length = %d, want 1", len(spec.GetEnv()))
	}
}
