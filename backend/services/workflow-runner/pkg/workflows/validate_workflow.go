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

package workflows

import (
	"fmt"
	"time"

	serverlessv1 "github.com/leftbin/stigmer-cloud/apis/stubs/go/ai/stigmer/agentic/workflow/v1/serverless"
	"github.com/leftbin/stigmer-cloud/backend/services/workflow-runner/worker/activities"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// ValidateServerlessWorkflow validates a Serverless Workflow during creation.
//
// This workflow is called synchronously by the workflow creation handler in stigmer-service.
// It generates YAML and validates structure before the workflow is persisted to DB.
//
// Flow:
//  1. Generate YAML from WorkflowSpec proto
//  2. Validate YAML structure
//  3. Return validation result
//
// The workflow creation handler uses this result to decide whether to persist the workflow.
//
// Design Decision: Synchronous Validation
//
// This workflow executes synchronously (not fire-and-forget) because:
//   - Workflow creation is infrequent (not a hot path)
//   - Users expect to wait for creation
//   - Validation is fast (<200ms)
//   - Immediate feedback > eventual consistency
//   - Simpler architecture (no PENDING state, no polling)
//
// Error Handling:
//   - YAML generation errors → INVALID state
//   - Structure validation errors → INVALID state
//   - Activity failures → FAILED state
//
// The workflow itself should never fail - it always returns a validation result.
func ValidateServerlessWorkflow(ctx workflow.Context, input activities.ValidateWorkflowInput) (*activities.ValidateWorkflowOutput, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("Starting serverless workflow validation")

	// Initialize validation result
	validation := &serverlessv1.ServerlessWorkflowValidation{
		State:                serverlessv1.ValidationState_PENDING,
		Yaml:                 "",
		Errors:               []string{},
		Warnings:             []string{},
		ValidatedAt:          nil,
		ValidationWorkflowId: workflow.GetInfo(ctx).WorkflowExecution.ID,
	}

	// Activity options: short timeout for fast feedback
	activityOptions := workflow.ActivityOptions{
		StartToCloseTimeout: 30 * time.Second, // Generous timeout
		RetryPolicy: &temporal.RetryPolicy{
			MaximumAttempts: 3,
			InitialInterval: 1 * time.Second,
		},
	}
	ctx = workflow.WithActivityOptions(ctx, activityOptions)

	// ========================================
	// Activity 1: Generate YAML
	// ========================================
	logger.Info("Executing GenerateYAMLActivity")

	var generateYAMLOutput activities.GenerateYAMLOutput
	err := workflow.ExecuteActivity(ctx, "GenerateYAMLActivity", activities.GenerateYAMLInput{
		Spec: input.Spec,
	}).Get(ctx, &generateYAMLOutput)

	if err != nil {
		// Activity execution failed (timeout, panic, etc.)
		logger.Error("GenerateYAMLActivity execution failed", "error", err)
		validation.State = serverlessv1.ValidationState_FAILED
		validation.Errors = append(validation.Errors, fmt.Sprintf("YAML generation failed: %v", err))
		validation.ValidatedAt = timestamppb.Now()
		return &activities.ValidateWorkflowOutput{Validation: validation}, nil
	}

	// Activity succeeded, check output
	if generateYAMLOutput.Error != "" {
		// YAML generation had errors (user error, not system error)
		logger.Warn("YAML generation returned errors", "error", generateYAMLOutput.Error)
		validation.State = serverlessv1.ValidationState_INVALID
		validation.Errors = append(validation.Errors, generateYAMLOutput.Error)
		validation.ValidatedAt = timestamppb.Now()
		return &activities.ValidateWorkflowOutput{Validation: validation}, nil
	}

	// Store generated YAML (even if validation fails later)
	validation.Yaml = generateYAMLOutput.YAML
	logger.Info("YAML generated successfully", "yaml_length", len(validation.Yaml))

	// ========================================
	// Activity 2: Validate Structure
	// ========================================
	logger.Info("Executing ValidateStructureActivity")

	var validateStructureOutput activities.ValidateStructureOutput
	err = workflow.ExecuteActivity(ctx, "ValidateStructureActivity", activities.ValidateStructureInput{
		YAML: generateYAMLOutput.YAML,
	}).Get(ctx, &validateStructureOutput)

	if err != nil {
		// Activity execution failed (timeout, panic, etc.)
		logger.Error("ValidateStructureActivity execution failed", "error", err)
		validation.State = serverlessv1.ValidationState_FAILED
		validation.Errors = append(validation.Errors, fmt.Sprintf("Structure validation failed: %v", err))
		validation.ValidatedAt = timestamppb.Now()
		return &activities.ValidateWorkflowOutput{Validation: validation}, nil
	}

	// Activity succeeded, check validation result
	if !validateStructureOutput.IsValid {
		// Workflow structure is invalid (user error)
		logger.Warn("Workflow structure validation failed", "error_count", len(validateStructureOutput.Errors))
		validation.State = serverlessv1.ValidationState_INVALID
		validation.Errors = append(validation.Errors, validateStructureOutput.Errors...)
		validation.Warnings = append(validation.Warnings, validateStructureOutput.Warnings...)
		validation.ValidatedAt = timestamppb.Now()
		return &activities.ValidateWorkflowOutput{Validation: validation}, nil
	}

	// ========================================
	// Success!
	// ========================================
	logger.Info("Workflow validation completed successfully")
	validation.State = serverlessv1.ValidationState_VALID
	validation.Warnings = append(validation.Warnings, validateStructureOutput.Warnings...)
	validation.ValidatedAt = timestamppb.Now()

	return &activities.ValidateWorkflowOutput{Validation: validation}, nil
}
