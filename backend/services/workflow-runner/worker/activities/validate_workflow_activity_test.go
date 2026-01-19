/*
 * Copyright 2026 Leftbin/Stigmer
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

package activities_test

import (
	"testing"

	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	"github.com/stigmer/stigmer/backend/services/workflow-runner/worker/activities"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.temporal.io/sdk/testsuite"
	"google.golang.org/protobuf/types/known/structpb"
)

// TestGenerateYAMLActivity_Success tests successful YAML generation from WorkflowSpec proto.
func TestGenerateYAMLActivity_Success(t *testing.T) {
	// Create test workflow spec
	spec := &workflowv1.WorkflowSpec{
		Document: &workflowv1.WorkflowDocument{
			Dsl:       "1.0.0",
			Name:      "test-workflow",
			Namespace: "test",
			Version:   "1.0.0",
		},
		Tasks: []*workflowv1.WorkflowTask{
			{
				Name: "greet",
				Kind: apiresource.WorkflowTaskKind_WORKFLOW_TASK_KIND_SET,
				TaskConfig: &structpb.Struct{
					Fields: map[string]*structpb.Value{
						"variables": structpb.NewStructValue(&structpb.Struct{
							Fields: map[string]*structpb.Value{
								"message": structpb.NewStringValue("Hello, World!"),
								"status":  structpb.NewStringValue("success"),
							},
						}),
					},
				},
			},
		},
	}

	// Create Temporal test environment for activities
	testSuite := &testsuite.WorkflowTestSuite{}
	env := testSuite.NewTestActivityEnvironment()

	// Create activities instance and register
	act := activities.NewValidateWorkflowActivities()
	env.RegisterActivity(act.GenerateYAMLActivity)

	// Execute activity
	val, err := env.ExecuteActivity(act.GenerateYAMLActivity, activities.GenerateYAMLInput{
		Spec: spec,
	})

	// Assert
	require.NoError(t, err)

	var output activities.GenerateYAMLOutput
	require.NoError(t, val.Get(&output))

	assert.Empty(t, output.Error, "Expected no error in output")
	assert.NotEmpty(t, output.YAML, "Expected YAML to be generated")
	assert.Contains(t, output.YAML, "test-workflow", "YAML should contain workflow name")
	assert.Contains(t, output.YAML, "document:", "YAML should contain document section")
	assert.Contains(t, output.YAML, "do:", "YAML should contain do section")
}

// TestGenerateYAMLActivity_NilSpec tests error handling for nil WorkflowSpec.
func TestGenerateYAMLActivity_NilSpec(t *testing.T) {
	// Create Temporal test environment for activities
	testSuite := &testsuite.WorkflowTestSuite{}
	env := testSuite.NewTestActivityEnvironment()

	// Create activities instance and register
	act := activities.NewValidateWorkflowActivities()
	env.RegisterActivity(act.GenerateYAMLActivity)

	// Execute activity
	val, err := env.ExecuteActivity(act.GenerateYAMLActivity, activities.GenerateYAMLInput{
		Spec: nil,
	})

	require.NoError(t, err, "Activity should not fail")

	var output activities.GenerateYAMLOutput
	require.NoError(t, val.Get(&output))

	assert.NotEmpty(t, output.Error, "Expected error in output for nil spec")
	assert.Contains(t, output.Error, "cannot be nil")
}

// TestGenerateYAMLActivity_InvalidSpec tests error handling for invalid WorkflowSpec.
func TestGenerateYAMLActivity_InvalidSpec(t *testing.T) {
	// Create invalid spec (missing document)
	spec := &workflowv1.WorkflowSpec{
		Document: nil, // Invalid - document is required
		Tasks: []*workflowv1.WorkflowTask{
			{
				Name: "task1",
				Kind: apiresource.WorkflowTaskKind_WORKFLOW_TASK_KIND_SET,
			},
		},
	}

	// Create Temporal test environment for activities
	testSuite := &testsuite.WorkflowTestSuite{}
	env := testSuite.NewTestActivityEnvironment()

	// Create activities instance and register
	act := activities.NewValidateWorkflowActivities()
	env.RegisterActivity(act.GenerateYAMLActivity)

	// Execute activity
	val, err := env.ExecuteActivity(act.GenerateYAMLActivity, activities.GenerateYAMLInput{
		Spec: spec,
	})

	require.NoError(t, err, "Activity should not fail")

	var output activities.GenerateYAMLOutput
	require.NoError(t, val.Get(&output))

	assert.NotEmpty(t, output.Error, "Expected error in output for invalid spec")
}

// TestValidateStructureActivity_ValidWorkflow tests validation of a valid workflow.
func TestValidateStructureActivity_ValidWorkflow(t *testing.T) {
	// Valid workflow YAML
	yaml := `
document:
  dsl: '1.0.0'
  name: test-workflow
  namespace: test
  version: '1.0.0'
do:
  - greet:
      set:
        message: Hello, World!
        status: success
`

	// Create Temporal test environment for activities
	testSuite := &testsuite.WorkflowTestSuite{}
	env := testSuite.NewTestActivityEnvironment()

	// Create activities instance and register
	act := activities.NewValidateWorkflowActivities()
	env.RegisterActivity(act.ValidateStructureActivity)

	// Execute activity
	val, err := env.ExecuteActivity(act.ValidateStructureActivity, activities.ValidateStructureInput{
		YAML: yaml,
	})

	require.NoError(t, err)

	var output activities.ValidateStructureOutput
	require.NoError(t, val.Get(&output))

	assert.True(t, output.IsValid, "Workflow should be valid")
	assert.Empty(t, output.Errors, "Should have no errors")
}

// TestValidateStructureActivity_InvalidYAML tests validation of invalid YAML syntax.
func TestValidateStructureActivity_InvalidYAML(t *testing.T) {
	// Invalid YAML syntax
	yaml := `
document:
  dsl: '1.0.0'
  name: test-workflow
  namespace: test
  version: '1.0.0'
do:
  - greet:
      set:
        message: Hello, World!
      invalid_indentation:  # Invalid YAML
`

	// Create Temporal test environment for activities
	testSuite := &testsuite.WorkflowTestSuite{}
	env := testSuite.NewTestActivityEnvironment()

	// Create activities instance and register
	act := activities.NewValidateWorkflowActivities()
	env.RegisterActivity(act.ValidateStructureActivity)

	// Execute activity
	val, err := env.ExecuteActivity(act.ValidateStructureActivity, activities.ValidateStructureInput{
		YAML: yaml,
	})

	require.NoError(t, err, "Activity should not fail")

	var output activities.ValidateStructureOutput
	require.NoError(t, val.Get(&output))

	assert.False(t, output.IsValid, "Workflow should be invalid")
	assert.NotEmpty(t, output.Errors, "Should have validation errors")
}

// TestValidateStructureActivity_MissingRequiredFields tests validation with missing fields.
func TestValidateStructureActivity_MissingRequiredFields(t *testing.T) {
	// Missing document.name
	yaml := `
document:
  dsl: '1.0.0'
  namespace: test
  version: '1.0.0'
do:
  - task1:
      set:
        value: 123
`

	// Create Temporal test environment for activities
	testSuite := &testsuite.WorkflowTestSuite{}
	env := testSuite.NewTestActivityEnvironment()

	// Create activities instance and register
	act := activities.NewValidateWorkflowActivities()
	env.RegisterActivity(act.ValidateStructureActivity)

	// Execute activity
	val, err := env.ExecuteActivity(act.ValidateStructureActivity, activities.ValidateStructureInput{
		YAML: yaml,
	})

	require.NoError(t, err, "Activity should not fail")

	var output activities.ValidateStructureOutput
	require.NoError(t, val.Get(&output))

	assert.False(t, output.IsValid, "Workflow should be invalid")
	assert.NotEmpty(t, output.Errors, "Should have validation errors")
	assert.Contains(t, output.Errors[0], "document.name", "Error should mention missing field")
}

// TestValidateStructureActivity_NoTasks tests validation of workflow with no tasks.
func TestValidateStructureActivity_NoTasks(t *testing.T) {
	yaml := `
document:
  dsl: '1.0.0'
  name: test-workflow
  namespace: test
  version: '1.0.0'
do: []
`

	// Create Temporal test environment for activities
	testSuite := &testsuite.WorkflowTestSuite{}
	env := testSuite.NewTestActivityEnvironment()

	// Create activities instance and register
	act := activities.NewValidateWorkflowActivities()
	env.RegisterActivity(act.ValidateStructureActivity)

	// Execute activity
	val, err := env.ExecuteActivity(act.ValidateStructureActivity, activities.ValidateStructureInput{
		YAML: yaml,
	})

	require.NoError(t, err, "Activity should not fail")

	var output activities.ValidateStructureOutput
	require.NoError(t, val.Get(&output))

	assert.False(t, output.IsValid, "Workflow should be invalid")
	assert.NotEmpty(t, output.Errors, "Should have validation errors")
	assert.Contains(t, output.Errors[0], "at least one task", "Error should mention missing tasks")
}

// TestValidateStructureActivity_WithRuntimeExpressions tests validation preserves runtime expressions.
func TestValidateStructureActivity_WithRuntimeExpressions(t *testing.T) {
	// Workflow with runtime expressions (environment variables)
	yaml := `
document:
  dsl: '1.0.0'
  name: api-workflow
  namespace: test
  version: '1.0.0'
do:
  - fetchData:
      call: http
      with:
        method: get
        endpoint:
          uri: ${ .env.API_BASE_URL + "/data" }
`

	// Create Temporal test environment for activities
	testSuite := &testsuite.WorkflowTestSuite{}
	env := testSuite.NewTestActivityEnvironment()

	// Create activities instance and register
	act := activities.NewValidateWorkflowActivities()
	env.RegisterActivity(act.ValidateStructureActivity)

	// Execute activity
	val, err := env.ExecuteActivity(act.ValidateStructureActivity, activities.ValidateStructureInput{
		YAML: yaml,
	})

	require.NoError(t, err, "Activity should not fail")

	var output activities.ValidateStructureOutput
	require.NoError(t, val.Get(&output))

	assert.True(t, output.IsValid, "Workflow with runtime expressions should be valid")
	assert.Empty(t, output.Errors, "Should have no errors")
}
