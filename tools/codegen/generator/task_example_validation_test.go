package main

import (
	"strings"
	"testing"
)

func TestValidateSidecarExamples(t *testing.T) {
	waitSchema := &TaskConfigSchema{
		DiscriminatorValue: "wait",
		ProtoType:          "ai.stigmer.agentic.workflow.v1.tasks.WaitTaskConfig",
	}
	notificationSchema := &TaskConfigSchema{
		DiscriminatorValue: "notification",
		ProtoType:          "ai.stigmer.agentic.workflow.v1.tasks.NotificationTaskConfig",
	}

	cases := []struct {
		name    string
		schemas []*TaskConfigSchema
		example string
		wantErr string // substring the aggregated error must contain; "" means valid
	}{
		{
			name:    "valid authoring form",
			schemas: []*TaskConfigSchema{waitSchema},
			example: `- name: pause_before_retry
  kind: wait
  task_config:
    duration:
      seconds: 30
`,
		},
		{
			name:    "internal DSL form is rejected",
			schemas: []*TaskConfigSchema{waitSchema},
			example: `- pause_before_retry:
    wait:
      seconds: 30
`,
			wantErr: "does not parse as an authoring-form task",
		},
		{
			name:    "unknown task_config field is rejected",
			schemas: []*TaskConfigSchema{notificationSchema},
			example: `- name: notify_team
  kind: notification
  task_config:
    channel: slack
    message: "done"
`,
			wantErr: `unknown field "message"`,
		},
		{
			name:    "wrong scalar shape for message field is rejected",
			schemas: []*TaskConfigSchema{waitSchema},
			example: `- name: pause_before_retry
  kind: wait
  task_config:
    duration: "30s"
`,
			wantErr: "task_config is not a valid ai.stigmer.agentic.workflow.v1.tasks.WaitTaskConfig",
		},
		{
			name:    "kind mismatch is rejected",
			schemas: []*TaskConfigSchema{waitSchema},
			example: `- name: pause_before_retry
  kind: notification
  task_config:
    duration:
      seconds: 30
`,
			wantErr: `kind is "notification", want "wait"`,
		},
		{
			name:    "missing name is rejected",
			schemas: []*TaskConfigSchema{waitSchema},
			example: `- kind: wait
  task_config:
    duration:
      seconds: 30
`,
			wantErr: "task name is required",
		},
		{
			name:    "missing task_config is rejected",
			schemas: []*TaskConfigSchema{waitSchema},
			example: `- name: pause_before_retry
  kind: wait
`,
			wantErr: "task_config is required",
		},
		{
			name:    "empty example is rejected",
			schemas: []*TaskConfigSchema{waitSchema},
			example: "[]\n",
			wantErr: "contains no task entries",
		},
		{
			name:    "unresolvable proto type is reported",
			schemas: []*TaskConfigSchema{{DiscriminatorValue: "wait", ProtoType: "ai.stigmer.NoSuchConfig"}},
			example: `- name: x
  kind: wait
  task_config: {}
`,
			wantErr: "cannot resolve proto message",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			sidecars := make(map[string]*SidecarMeta)
			for _, schema := range tc.schemas {
				sidecars[schema.DiscriminatorValue] = &SidecarMeta{
					Kind:         schema.DiscriminatorValue,
					YamlExamples: []string{tc.example},
				}
			}

			err := validateSidecarExamples(tc.schemas, sidecars)
			if tc.wantErr == "" {
				if err != nil {
					t.Fatalf("expected valid, got: %v", err)
				}
				return
			}
			if err == nil {
				t.Fatalf("expected error containing %q, got nil", tc.wantErr)
			}
			if !strings.Contains(err.Error(), tc.wantErr) {
				t.Fatalf("error %q does not contain %q", err.Error(), tc.wantErr)
			}
		})
	}
}

func TestValidateSidecarExamplesSkipsKindsWithoutExamples(t *testing.T) {
	schemas := []*TaskConfigSchema{{
		DiscriminatorValue: "wait",
		ProtoType:          "ai.stigmer.agentic.workflow.v1.tasks.WaitTaskConfig",
	}}
	if err := validateSidecarExamples(schemas, map[string]*SidecarMeta{}); err != nil {
		t.Fatalf("kinds without sidecar examples must not fail validation: %v", err)
	}
}
