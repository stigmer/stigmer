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

package converter

import (
	"fmt"

	workflowv1 "github.com/leftbin/stigmer-cloud/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	tasksv1 "github.com/leftbin/stigmer-cloud/apis/stubs/go/ai/stigmer/agentic/workflow/v1/tasks"
	apiresourcev1 "github.com/leftbin/stigmer-cloud/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/leftbin/stigmer-cloud/backend/services/workflow-runner/pkg/validation"
	"gopkg.in/yaml.v3"
)

// ProtoToYAML converts WorkflowSpec proto to Zigflow YAML format.
//
// This is the "Phase 2" converter that transforms structured proto definitions
// to the YAML format expected by the Zigflow interpreter.
//
// Workflow Definition Pattern:
// - Proto uses "kind + Struct" pattern (like CloudResource)
// - task_config is google.protobuf.Struct (dynamic JSON)
// - Converter unpacks task_config and formats as YAML
//
// Example transformation:
//
//	Input (proto):
//	  spec {
//	    document { dsl: "1.0.0", namespace: "stigmer", name: "hello", version: "1.0" }
//	    tasks [
//	      { name: "greet", kind: HTTP_CALL, task_config: {...}, export: {...} }
//	    ]
//	  }
//
//	Output (YAML):
//	  document:
//	    dsl: 1.0.0
//	    namespace: stigmer
//	    name: hello
//	    version: "1.0"
//	  do:
//	    - greet:
//	        call: http
//	        with:
//	          method: get
//	          endpoint: ...
//	        export:
//	          as: ${.}
//
// Usage:
//
//	yaml, err := ProtoToYAML(workflow.Spec)
//	if err != nil {
//	    return fmt.Errorf("failed to convert workflow: %w", err)
//	}
type Converter struct{}

// NewConverter creates a new proto-to-YAML converter.
func NewConverter() *Converter {
	return &Converter{}
}

// ProtoToYAML converts WorkflowSpec proto to Zigflow YAML string.
func (c *Converter) ProtoToYAML(spec *workflowv1.WorkflowSpec) (string, error) {
	if spec == nil {
		return "", fmt.Errorf("workflow spec cannot be nil")
	}

	if spec.Document == nil {
		return "", fmt.Errorf("workflow document cannot be nil")
	}

	if len(spec.Tasks) == 0 {
		return "", fmt.Errorf("workflow must have at least one task")
	}

	// Build YAML structure
	workflow := map[string]interface{}{
		"document": map[string]interface{}{
			"dsl":       spec.Document.Dsl,
			"namespace": spec.Document.Namespace,
			"name":      spec.Document.Name,
			"version":   spec.Document.Version,
		},
	}

	// Add description if present
	if spec.Document.Description != "" {
		workflow["document"].(map[string]interface{})["description"] = spec.Document.Description
	}

	// Convert tasks to "do" array
	doTasks := make([]map[string]interface{}, 0, len(spec.Tasks))
	for _, task := range spec.Tasks {
		yamlTask, err := c.convertTask(task)
		if err != nil {
			return "", fmt.Errorf("failed to convert task '%s': %w", task.Name, err)
		}
		doTasks = append(doTasks, yamlTask)
	}

	workflow["do"] = doTasks

	// Marshal to YAML
	yamlBytes, err := yaml.Marshal(workflow)
	if err != nil {
		return "", fmt.Errorf("failed to marshal YAML: %w", err)
	}

	return string(yamlBytes), nil
}

// convertTask converts a WorkflowTask proto to YAML map.
//
// Phase 3 refactoring: Now uses typed proto messages instead of generic maps.
//
// Process:
// 1. Unmarshal task_config Struct → Typed Proto (using validation package)
// 2. Convert Typed Proto → YAML structure (using type-safe converters)
// 3. Add export and flow control metadata
//
// This provides type safety, better error messages, and contract adherence.
//
// Maps WorkflowTaskKind enum to Zigflow task types:
// - SET → set
// - HTTP_CALL → call: http
// - GRPC_CALL → call: grpc
// - SWITCH → switch
// - FOR → for
// - FORK → fork
// - TRY → try
// - LISTEN → listen
// - WAIT → wait
// - CALL_ACTIVITY → callActivity (future)
// - RAISE → raise
// - RUN → run
func (c *Converter) convertTask(task *workflowv1.WorkflowTask) (map[string]interface{}, error) {
	if task.Name == "" {
		return nil, fmt.Errorf("task name is required")
	}

	// Phase 3: Unmarshal Struct to typed proto (contract-aware)
	typedProto, err := validation.UnmarshalTaskConfig(task.Kind, task.TaskConfig)
	if err != nil {
		return nil, fmt.Errorf("failed to unmarshal task '%s' config: %w", task.Name, err)
	}

	// Phase 3: Convert typed proto to YAML structure (type-safe)
	yamlTask := make(map[string]interface{})

	// Use type-safe converters for each task kind
	switch task.Kind {
	case apiresourcev1.WorkflowTaskKind_WORKFLOW_TASK_KIND_SET:
		yamlTask[task.Name] = c.convertSetTask(typedProto.(*tasksv1.SetTaskConfig))

	case apiresourcev1.WorkflowTaskKind_WORKFLOW_TASK_KIND_HTTP_CALL:
		yamlTask[task.Name] = c.convertHttpCallTask(typedProto.(*tasksv1.HttpCallTaskConfig))

	case apiresourcev1.WorkflowTaskKind_WORKFLOW_TASK_KIND_GRPC_CALL:
		yamlTask[task.Name] = c.convertGrpcCallTask(typedProto.(*tasksv1.GrpcCallTaskConfig))

	case apiresourcev1.WorkflowTaskKind_WORKFLOW_TASK_KIND_SWITCH:
		yamlTask[task.Name] = c.convertSwitchTask(typedProto.(*tasksv1.SwitchTaskConfig))

	case apiresourcev1.WorkflowTaskKind_WORKFLOW_TASK_KIND_FOR:
		yamlTask[task.Name] = c.convertForTask(typedProto.(*tasksv1.ForTaskConfig))

	case apiresourcev1.WorkflowTaskKind_WORKFLOW_TASK_KIND_FORK:
		yamlTask[task.Name] = c.convertForkTask(typedProto.(*tasksv1.ForkTaskConfig))

	case apiresourcev1.WorkflowTaskKind_WORKFLOW_TASK_KIND_TRY:
		yamlTask[task.Name] = c.convertTryTask(typedProto.(*tasksv1.TryTaskConfig))

	case apiresourcev1.WorkflowTaskKind_WORKFLOW_TASK_KIND_LISTEN:
		yamlTask[task.Name] = c.convertListenTask(typedProto.(*tasksv1.ListenTaskConfig))

	case apiresourcev1.WorkflowTaskKind_WORKFLOW_TASK_KIND_WAIT:
		yamlTask[task.Name] = c.convertWaitTask(typedProto.(*tasksv1.WaitTaskConfig))

	case apiresourcev1.WorkflowTaskKind_WORKFLOW_TASK_KIND_RAISE:
		yamlTask[task.Name] = c.convertRaiseTask(typedProto.(*tasksv1.RaiseTaskConfig))

	case apiresourcev1.WorkflowTaskKind_WORKFLOW_TASK_KIND_RUN:
		yamlTask[task.Name] = c.convertRunTask(typedProto.(*tasksv1.RunTaskConfig))

	case apiresourcev1.WorkflowTaskKind_WORKFLOW_TASK_KIND_CALL_ACTIVITY:
		// CALL_ACTIVITY: Future implementation for Temporal activities
		return nil, fmt.Errorf("CALL_ACTIVITY not yet implemented")

	default:
		return nil, fmt.Errorf("unsupported task kind: %v", task.Kind)
	}

	// Add export if present
	if task.Export != nil && task.Export.As != "" {
		taskMap := yamlTask[task.Name].(map[string]interface{})
		taskMap["export"] = map[string]interface{}{
			"as": task.Export.As,
		}
	}

	// Add flow control if present
	if task.Flow != nil && task.Flow.Then != "" {
		taskMap := yamlTask[task.Name].(map[string]interface{})
		taskMap["then"] = task.Flow.Then
	}

	return yamlTask, nil
}
