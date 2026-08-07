package agentexecution

import (
	"testing"

	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	"google.golang.org/protobuf/types/known/structpb"
)

// agentCallTaskEnvironmentRefs is the seam between the workflow row and the
// environment-resolution branch: given the workflow the provenance labels
// name, it must return exactly the named agent_call task's refs — and
// degrade to nil for every "binding no longer exists" shape (renamed task,
// re-kinded task, unparsable config), because a stale binding must never
// fail a run that would have succeeded before the binding existed.
func TestAgentCallTaskEnvironmentRefs(t *testing.T) {
	makeWorkflow := func(taskName string, kind workflowv1.WorkflowTaskKind, config map[string]interface{}) *workflowv1.Workflow {
		cfg, err := structpb.NewStruct(config)
		if err != nil {
			t.Fatalf("bad fixture: %v", err)
		}
		return &workflowv1.Workflow{
			Spec: &workflowv1.WorkflowSpec{
				Tasks: []*workflowv1.WorkflowTask{
					{Name: taskName, Kind: kind, TaskConfig: cfg},
				},
			},
		}
	}

	agentCallConfig := map[string]interface{}{
		"agent":   "triage",
		"message": "classify",
		"environment_refs": []interface{}{
			map[string]interface{}{"slug": "shared-secrets"},
			map[string]interface{}{"org": "acme", "slug": "other"},
		},
	}

	t.Run("returns the named task's refs with kind defaulted", func(t *testing.T) {
		workflow := makeWorkflow("review", workflowv1.WorkflowTaskKind_agent_call, agentCallConfig)
		refs := agentCallTaskEnvironmentRefs(workflow, "review")
		if len(refs) != 2 {
			t.Fatalf("expected 2 refs, got %d", len(refs))
		}
		if refs[0].GetSlug() != "shared-secrets" || refs[1].GetOrg() != "acme" {
			t.Errorf("unexpected refs: %v", refs)
		}
	})

	t.Run("renamed task answers nil", func(t *testing.T) {
		workflow := makeWorkflow("review", workflowv1.WorkflowTaskKind_agent_call, agentCallConfig)
		if refs := agentCallTaskEnvironmentRefs(workflow, "old_name"); refs != nil {
			t.Errorf("expected nil for a task name no longer in the workflow, got %v", refs)
		}
	})

	t.Run("same-named non-agent_call task answers nil", func(t *testing.T) {
		workflow := makeWorkflow("review", workflowv1.WorkflowTaskKind_llm_call, map[string]interface{}{
			"model":  "some-model",
			"prompt": "classify",
		})
		if refs := agentCallTaskEnvironmentRefs(workflow, "review"); refs != nil {
			t.Errorf("expected nil for a re-kinded task, got %v", refs)
		}
	})

	t.Run("unparsable config answers nil", func(t *testing.T) {
		// A config with a key the current proto does not declare no longer
		// parses (protojson is strict) — the binding degrades rather than
		// failing the run.
		workflow := makeWorkflow("review", workflowv1.WorkflowTaskKind_agent_call, map[string]interface{}{
			"agent":       "triage",
			"message":     "classify",
			"legacy_knob": true,
		})
		if refs := agentCallTaskEnvironmentRefs(workflow, "review"); refs != nil {
			t.Errorf("expected nil for an unparsable config, got %v", refs)
		}
	})

	t.Run("task without refs answers nil", func(t *testing.T) {
		workflow := makeWorkflow("review", workflowv1.WorkflowTaskKind_agent_call, map[string]interface{}{
			"agent":   "triage",
			"message": "classify",
		})
		if refs := agentCallTaskEnvironmentRefs(workflow, "review"); len(refs) != 0 {
			t.Errorf("expected no refs, got %v", refs)
		}
	})
}
