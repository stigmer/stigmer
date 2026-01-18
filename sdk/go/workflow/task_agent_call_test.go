package workflow_test

import (
	"testing"

	"github.com/stigmer/stigmer/sdk/go/workflow"
)

func TestAgentCallTask(t *testing.T) {
	tests := []struct {
		name     string
		taskName string
		opts     []workflow.AgentCallOption
		want     *workflow.Task
		wantErr  bool
	}{
		{
			name:     "basic agent call",
			taskName: "test-call",
			opts: []workflow.AgentCallOption{
				workflow.AgentOption(workflow.AgentBySlug("reviewer")),
				workflow.Message("Review code"),
			},
			want: &workflow.Task{
				Name: "test-call",
				Kind: workflow.TaskKindAgentCall,
			},
			wantErr: false,
		},
		{
			name:     "agent call with environment",
			taskName: "call-with-env",
			opts: []workflow.AgentCallOption{
				workflow.AgentOption(workflow.AgentBySlug("reviewer")),
				workflow.Message("Review code"),
				workflow.WithEnv(map[string]string{
					"GITHUB_TOKEN": "${.secrets.GH_TOKEN}",
					"PR_NUMBER":    "${.input.prNumber}",
				}),
			},
			want: &workflow.Task{
				Name: "call-with-env",
				Kind: workflow.TaskKindAgentCall,
			},
			wantErr: false,
		},
		{
			name:     "agent call with execution config",
			taskName: "call-with-config",
			opts: []workflow.AgentCallOption{
				workflow.AgentOption(workflow.AgentBySlug("reviewer")),
				workflow.Message("Review code"),
				workflow.AgentModel("claude-3-5-sonnet"),
				workflow.AgentTimeout(600),
				workflow.AgentTemperature(0.2),
			},
			want: &workflow.Task{
				Name: "call-with-config",
				Kind: workflow.TaskKindAgentCall,
			},
			wantErr: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			task := workflow.AgentCallTask(tt.taskName, tt.opts...)

			if task == nil {
				t.Fatal("expected task, got nil")
			}

			if task.Name != tt.want.Name {
				t.Errorf("task.Name = %v, want %v", task.Name, tt.want.Name)
			}

			if task.Kind != tt.want.Kind {
				t.Errorf("task.Kind = %v, want %v", task.Kind, tt.want.Kind)
			}

			// Verify config is not nil
			if task.Config == nil {
				t.Error("task.Config is nil")
			}

			// Verify config is of correct type
			cfg, ok := task.Config.(*workflow.AgentCallTaskConfig)
			if !ok {
				t.Errorf("task.Config type = %T, want *workflow.AgentCallTaskConfig", task.Config)
			}

			// Additional validations for specific test cases
			if tt.name == "basic agent call" {
				if cfg.Agent.Slug() != "reviewer" {
					t.Errorf("agent slug = %v, want %v", cfg.Agent.Slug(), "reviewer")
				}
				if cfg.Message != "Review code" {
					t.Errorf("message = %v, want %v", cfg.Message, "Review code")
				}
			}

			if tt.name == "agent call with environment" {
				if len(cfg.Env) != 2 {
					t.Errorf("env length = %v, want %v", len(cfg.Env), 2)
				}
			}

			if tt.name == "agent call with execution config" {
				if cfg.Config == nil {
					t.Error("execution config is nil")
				} else {
					if cfg.Config.Model != "claude-3-5-sonnet" {
						t.Errorf("model = %v, want %v", cfg.Config.Model, "claude-3-5-sonnet")
					}
					if cfg.Config.Timeout != 600 {
						t.Errorf("timeout = %v, want %v", cfg.Config.Timeout, 600)
					}
					if cfg.Config.Temperature != 0.2 {
						t.Errorf("temperature = %v, want %v", cfg.Config.Temperature, 0.2)
					}
				}
			}
		})
	}
}

func TestAgentBySlug(t *testing.T) {
	tests := []struct {
		name      string
		slug      string
		scope     []string
		wantSlug  string
		wantScope string
	}{
		{
			name:      "slug without scope",
			slug:      "code-reviewer",
			scope:     nil,
			wantSlug:  "code-reviewer",
			wantScope: "",
		},
		{
			name:      "slug with platform scope",
			slug:      "code-reviewer",
			scope:     []string{"platform"},
			wantSlug:  "code-reviewer",
			wantScope: "platform",
		},
		{
			name:      "slug with organization scope",
			slug:      "code-reviewer",
			scope:     []string{"organization"},
			wantSlug:  "code-reviewer",
			wantScope: "organization",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ref := workflow.AgentBySlug(tt.slug, tt.scope...)

			if ref.Slug() != tt.wantSlug {
				t.Errorf("Slug() = %v, want %v", ref.Slug(), tt.wantSlug)
			}

			if ref.Scope() != tt.wantScope {
				t.Errorf("Scope() = %v, want %v", ref.Scope(), tt.wantScope)
			}
		})
	}
}

func TestAgentCallOption_WithEnv(t *testing.T) {
	task := workflow.AgentCallTask(
		"test",
		workflow.AgentOption(workflow.AgentBySlug("reviewer")),
		workflow.Message("Review"),
		workflow.WithEnv(map[string]string{
			"KEY1": "value1",
		}),
		workflow.WithEnv(map[string]string{
			"KEY2": "value2",
		}),
	)

	cfg := task.Config.(*workflow.AgentCallTaskConfig)

	// Verify both env maps were merged
	if len(cfg.Env) != 2 {
		t.Errorf("env length = %v, want %v", len(cfg.Env), 2)
	}

	if cfg.Env["KEY1"] != "value1" {
		t.Errorf("Env[KEY1] = %v, want %v", cfg.Env["KEY1"], "value1")
	}

	if cfg.Env["KEY2"] != "value2" {
		t.Errorf("Env[KEY2] = %v, want %v", cfg.Env["KEY2"], "value2")
	}
}

func TestWorkflow_CallAgent(t *testing.T) {
	// Create a mock context that implements workflow.Context
	mockCtx := &mockWorkflowContext{}

	wf, err := workflow.New(mockCtx,
		workflow.WithNamespace("test"),
		workflow.WithName("test-workflow"),
	)
	if err != nil {
		t.Fatalf("failed to create workflow: %v", err)
	}

	// Use the CallAgent helper method
	task := wf.CallAgent(
		"review",
		workflow.AgentOption(workflow.AgentBySlug("code-reviewer")),
		workflow.Message("Review PR"),
	)

	if task == nil {
		t.Fatal("expected task, got nil")
	}

	if task.Name != "review" {
		t.Errorf("task.Name = %v, want %v", task.Name, "review")
	}

	if task.Kind != workflow.TaskKindAgentCall {
		t.Errorf("task.Kind = %v, want %v", task.Kind, workflow.TaskKindAgentCall)
	}

	// Verify task was added to workflow
	if len(wf.Tasks) != 1 {
		t.Errorf("workflow task count = %v, want %v", len(wf.Tasks), 1)
	}

	if wf.Tasks[0] != task {
		t.Error("task was not added to workflow")
	}
}

// Mock context for testing
type mockWorkflowContext struct{}

func (m *mockWorkflowContext) RegisterWorkflow(wf *workflow.Workflow) {}
