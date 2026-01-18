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

package types

// TemporalWorkflowInput is the input to the generic Temporal workflow
type TemporalWorkflowInput struct {
	// WorkflowExecutionID is the unique ID for this execution
	WorkflowExecutionID string

	// WorkflowYaml is the complete CNCF Serverless Workflow YAML
	WorkflowYaml string

	// Metadata contains workflow identification information
	Metadata *WorkflowMetadata

	// InitialData is the initial data to pass to the workflow
	InitialData map[string]any

	// EnvVars are environment variables to make available to the workflow
	EnvVars map[string]any

	// OrgId is the organization ID this workflow execution belongs to.
	// Used by activities that need organization context (e.g., agent calls).
	// Extracted from WorkflowExecution.metadata.org.
	OrgId string
}

// WorkflowMetadata contains workflow identification information
type WorkflowMetadata struct {
	Name      string
	Namespace string
	Version   string
}

// TemporalWorkflowOutput is the output from the generic Temporal workflow
type TemporalWorkflowOutput struct {
	// Result is the final result from workflow execution
	Result any

	// FinalState is the complete state after workflow execution
	FinalState map[string]any

	// WorkflowName is the name of the executed workflow
	WorkflowName string

	// ExecutionID is the unique ID for this execution
	ExecutionID string

	// ExecutionTime is when the workflow completed
	ExecutionTime any
}
