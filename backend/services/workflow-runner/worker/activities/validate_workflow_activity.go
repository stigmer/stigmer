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

package activities

import (
	"context"
	"fmt"

	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	serverlessv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1/serverless"
	"github.com/stigmer/stigmer/backend/services/workflow-runner/pkg/converter"
	"github.com/stigmer/stigmer/backend/services/workflow-runner/pkg/zigflow"
	"github.com/stigmer/stigmer/backend/services/workflow-runner/pkg/zigflow/tasks"
	"github.com/serverlessworkflow/sdk-go/v3/model"
	"go.temporal.io/sdk/activity"
)

// ValidateWorkflowActivities contains activities for serverless workflow validation.
// These activities are used during workflow creation to validate structure and generate YAML.
type ValidateWorkflowActivities struct {
	converter *converter.Converter
}

// NewValidateWorkflowActivities creates a new ValidateWorkflowActivities instance.
func NewValidateWorkflowActivities() *ValidateWorkflowActivities {
	return &ValidateWorkflowActivities{
		converter: converter.NewConverter(),
	}
}

// ValidateWorkflowInput is the input for the ValidateServerlessWorkflow Temporal workflow.
type ValidateWorkflowInput struct {
	// WorkflowSpec to validate
	Spec *workflowv1.WorkflowSpec
}

// ValidateWorkflowOutput is the output of the ValidateServerlessWorkflow Temporal workflow.
type ValidateWorkflowOutput struct {
	// Validation result
	Validation *serverlessv1.ServerlessWorkflowValidation
}

// GenerateYAMLInput is the input for GenerateYAMLActivity.
type GenerateYAMLInput struct {
	// WorkflowSpec to convert to YAML
	Spec *workflowv1.WorkflowSpec
}

// GenerateYAMLOutput is the output of GenerateYAMLActivity.
type GenerateYAMLOutput struct {
	// Generated Serverless Workflow YAML
	YAML string
	// Error message if YAML generation failed
	Error string
}

// GenerateYAMLActivity converts WorkflowSpec proto to Serverless Workflow YAML.
//
// This activity uses the existing converter.ProtoToYAML() function.
// It's a thin wrapper to make it a Temporal activity.
//
// Flow:
//  1. Receive WorkflowSpec proto
//  2. Call converter.ProtoToYAML(spec)
//  3. Return generated YAML or error
//
// This activity should complete in <100ms for typical workflows.
func (a *ValidateWorkflowActivities) GenerateYAMLActivity(ctx context.Context, input GenerateYAMLInput) (*GenerateYAMLOutput, error) {
	logger := activity.GetLogger(ctx)
	logger.Info("Starting YAML generation from WorkflowSpec proto")

	if input.Spec == nil {
		return &GenerateYAMLOutput{
			Error: "WorkflowSpec cannot be nil",
		}, nil
	}

	// Convert proto to YAML using existing converter
	yaml, err := a.converter.ProtoToYAML(input.Spec)
	if err != nil {
		logger.Error("Failed to generate YAML", "error", err)
		return &GenerateYAMLOutput{
			Error: fmt.Sprintf("Failed to generate YAML: %v", err),
		}, nil
	}

	logger.Info("Successfully generated YAML", "yaml_length", len(yaml))

	return &GenerateYAMLOutput{
		YAML: yaml,
	}, nil
}

// ValidateStructureInput is the input for ValidateStructureActivity.
type ValidateStructureInput struct {
	// Serverless Workflow YAML to validate
	YAML string
}

// ValidateStructureOutput is the output of ValidateStructureActivity.
type ValidateStructureOutput struct {
	// Whether the workflow structure is valid
	IsValid bool
	// Validation errors (empty if valid)
	Errors []string
	// Non-fatal warnings
	Warnings []string
}

// ValidateStructureActivity validates Serverless Workflow YAML structure.
//
// This activity uses the Zigflow parser and TaskBuilder in validation-only mode.
// It validates structure without executing any activities.
//
// Flow:
//  1. Receive YAML string
//  2. Parse YAML using zigflow.LoadFromString()
//  3. Build TaskBuilder with nil worker (validation mode)
//  4. Call Build() to validate structure
//  5. Return validation result
//
// What gets validated:
//   - YAML syntax
//   - Task types (set, call http, call grpc, etc.)
//   - Task structure (required fields)
//   - DSL version compatibility
//   - Document required fields
//   - Runtime expression syntax
//
// What doesn't execute:
//   - HTTP calls (no network)
//   - gRPC calls (no activities)
//   - Temporal activities (no worker)
//
// This activity should complete in <100ms for typical workflows.
func (a *ValidateWorkflowActivities) ValidateStructureActivity(ctx context.Context, input ValidateStructureInput) (*ValidateStructureOutput, error) {
	logger := activity.GetLogger(ctx)
	logger.Info("Starting workflow structure validation", "yaml_length", len(input.YAML))

	output := &ValidateStructureOutput{
		IsValid:  true,
		Errors:   []string{},
		Warnings: []string{},
	}

	// Step 1: Parse YAML to workflow struct
	workflow, err := zigflow.LoadFromString(input.YAML)
	if err != nil {
		logger.Error("Failed to parse YAML", "error", err)
		output.IsValid = false
		output.Errors = append(output.Errors, fmt.Sprintf("Failed to parse YAML: %v", err))
		return output, nil
	}

	logger.Info("Successfully parsed YAML", "workflow_name", workflow.Document.Name)

	// Step 2: Validate document structure
	if workflow.Document.DSL == "" {
		output.IsValid = false
		output.Errors = append(output.Errors, "Missing required field: document.dsl")
	}

	if workflow.Document.Name == "" {
		output.IsValid = false
		output.Errors = append(output.Errors, "Missing required field: document.name")
	}

	if workflow.Document.Namespace == "" {
		output.IsValid = false
		output.Errors = append(output.Errors, "Missing required field: document.namespace")
	}

	if workflow.Document.Version == "" {
		output.IsValid = false
		output.Errors = append(output.Errors, "Missing required field: document.version")
	}

	// Step 3: Validate tasks exist
	if workflow.Do == nil || len(*workflow.Do) == 0 {
		output.IsValid = false
		output.Errors = append(output.Errors, "Workflow must have at least one task in 'do' section")
		return output, nil
	}

	logger.Info("Document structure valid, validating tasks", "task_count", len(*workflow.Do))

	// Step 4: Build TaskBuilder in validation mode (nil worker)
	taskBuilder, err := tasks.NewDoTaskBuilder(
		nil, // No worker - validation only!
		&model.DoTask{Do: workflow.Do},
		workflow.Document.Name,
		workflow,
		tasks.DoTaskOpts{
			DisableRegisterWorkflow: true,
			Envvars:                 map[string]any{},
		},
	)

	if err != nil {
		logger.Error("Failed to create task builder", "error", err)
		output.IsValid = false
		output.Errors = append(output.Errors, fmt.Sprintf("Failed to validate task structure: %v", err))
		return output, nil
	}

	// Step 5: Build to validate (doesn't execute)
	_, err = taskBuilder.Build()
	if err != nil {
		logger.Error("Task validation failed", "error", err)
		output.IsValid = false
		output.Errors = append(output.Errors, fmt.Sprintf("Task validation failed: %v", err))
		return output, nil
	}

	logger.Info("Workflow structure validation completed successfully")

	return output, nil
}

// ValidateWorkflow is the single activity that performs complete workflow validation.
//
// This activity combines YAML generation and structure validation into one call.
// It matches the Java activity interface: ServerlessWorkflowValidation validateWorkflow(WorkflowSpec spec)
//
// Flow:
//  1. Generate YAML from WorkflowSpec proto
//  2. Validate YAML structure using Zigflow
//  3. Build and return ServerlessWorkflowValidation result
//
// The activity always returns a ServerlessWorkflowValidation with one of three states:
//   - VALID: Workflow structure passed all validations
//   - INVALID: User error (bad structure, missing fields, etc.)
//   - FAILED: System error (converter crash, parser failure, etc.)
//
// This matches the polyglot pattern where Java workflows call Go activities.
func (a *ValidateWorkflowActivities) ValidateWorkflow(ctx context.Context, spec *workflowv1.WorkflowSpec) (*serverlessv1.ServerlessWorkflowValidation, error) {
	logger := activity.GetLogger(ctx)
	logger.Info("Starting complete workflow validation (YAML generation + structure validation)")

	if spec == nil {
		return &serverlessv1.ServerlessWorkflowValidation{
			State:  serverlessv1.ValidationState_FAILED,
			Yaml:   "",
			Errors: []string{"WorkflowSpec cannot be nil"},
		}, nil
	}

	// Step 1: Generate YAML from proto
	logger.Info("Step 1: Generating YAML from WorkflowSpec proto")
	yaml, err := a.converter.ProtoToYAML(spec)
	if err != nil {
		logger.Error("YAML generation failed", "error", err)
		return &serverlessv1.ServerlessWorkflowValidation{
			State:  serverlessv1.ValidationState_INVALID,
			Yaml:   "",
			Errors: []string{fmt.Sprintf("Failed to generate YAML: %v", err)},
		}, nil
	}

	logger.Info("YAML generation succeeded", "yaml_length", len(yaml))

	// Step 2: Validate structure using Zigflow
	logger.Info("Step 2: Validating workflow structure using Zigflow")

	// Parse YAML
	workflow, err := zigflow.LoadFromString(yaml)
	if err != nil {
		logger.Error("Failed to parse YAML", "error", err)
		return &serverlessv1.ServerlessWorkflowValidation{
			State:  serverlessv1.ValidationState_INVALID,
			Yaml:   yaml,
			Errors: []string{fmt.Sprintf("Failed to parse YAML: %v", err)},
		}, nil
	}

	logger.Info("YAML parsed successfully", "workflow_name", workflow.Document.Name)

	// Validate document structure
	errors := []string{}
	warnings := []string{}

	if workflow.Document.DSL == "" {
		errors = append(errors, "Missing required field: document.dsl")
	}
	if workflow.Document.Name == "" {
		errors = append(errors, "Missing required field: document.name")
	}
	if workflow.Document.Namespace == "" {
		errors = append(errors, "Missing required field: document.namespace")
	}
	if workflow.Document.Version == "" {
		errors = append(errors, "Missing required field: document.version")
	}

	// Validate tasks exist
	if workflow.Do == nil || len(*workflow.Do) == 0 {
		errors = append(errors, "Workflow must have at least one task in 'do' section")
		return &serverlessv1.ServerlessWorkflowValidation{
			State:  serverlessv1.ValidationState_INVALID,
			Yaml:   yaml,
			Errors: errors,
		}, nil
	}

	logger.Info("Document structure valid, validating tasks", "task_count", len(*workflow.Do))

	// Build TaskBuilder in validation mode (nil worker)
	taskBuilder, err := tasks.NewDoTaskBuilder(
		nil, // No worker - validation only!
		&model.DoTask{Do: workflow.Do},
		workflow.Document.Name,
		workflow,
		tasks.DoTaskOpts{
			DisableRegisterWorkflow: true,
			Envvars:                 map[string]any{},
		},
	)

	if err != nil {
		logger.Error("Failed to create task builder", "error", err)
		errors = append(errors, fmt.Sprintf("Failed to validate task structure: %v", err))
		return &serverlessv1.ServerlessWorkflowValidation{
			State:  serverlessv1.ValidationState_INVALID,
			Yaml:   yaml,
			Errors: errors,
		}, nil
	}

	// Build to validate (doesn't execute)
	_, err = taskBuilder.Build()
	if err != nil {
		logger.Error("Task validation failed", "error", err)
		errors = append(errors, fmt.Sprintf("Task validation failed: %v", err))
		return &serverlessv1.ServerlessWorkflowValidation{
			State:  serverlessv1.ValidationState_INVALID,
			Yaml:   yaml,
			Errors: errors,
		}, nil
	}

	logger.Info("Workflow validation completed successfully")

	// Return VALID state
	return &serverlessv1.ServerlessWorkflowValidation{
		State:    serverlessv1.ValidationState_VALID,
		Yaml:     yaml,
		Errors:   errors,
		Warnings: warnings,
	}, nil
}
