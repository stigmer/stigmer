package converter

import (
	"fmt"

	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	"gopkg.in/yaml.v3"
)

// Converter converts WorkflowSpec proto to CNCF Serverless Workflow DSL YAML.
//
// The Stigmer proto uses a "kind + Struct" pattern where each task has a
// WorkflowTaskKind enum and a google.protobuf.Struct task_config. This
// converter transforms that representation into the CNCF Serverless Workflow
// DSL 1.0.0 format (document/do with task-type keywords like set:, call:, etc.)
// that the TS workflow engine (loader.ts) can parse and execute.
type Converter struct{}

func NewConverter() *Converter {
	return &Converter{}
}

// ProtoToYAML converts WorkflowSpec proto to CNCF Serverless Workflow DSL YAML string.
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

	workflow := map[string]interface{}{
		"document": buildDocument(spec.Document),
	}

	doTasks := make([]map[string]interface{}, 0, len(spec.Tasks))
	for _, task := range spec.Tasks {
		yamlTask, err := c.convertTask(task)
		if err != nil {
			return "", fmt.Errorf("failed to convert task '%s': %w", task.Name, err)
		}
		doTasks = append(doTasks, yamlTask)
	}

	workflow["do"] = doTasks

	yamlBytes, err := yaml.Marshal(workflow)
	if err != nil {
		return "", fmt.Errorf("failed to marshal YAML: %w", err)
	}

	return string(yamlBytes), nil
}

func buildDocument(doc *workflowv1.WorkflowDocument) map[string]interface{} {
	result := map[string]interface{}{
		"dsl":       doc.Dsl,
		"namespace": doc.Namespace,
		"name":      doc.Name,
		"version":   doc.Version,
	}

	if doc.Description != "" {
		result["description"] = doc.Description
	}

	return result
}

// convertTask converts a WorkflowTask proto to a CNCF DSL YAML map entry.
// Each entry is a single-key map: { taskName: taskDefinition }.
func (c *Converter) convertTask(task *workflowv1.WorkflowTask) (map[string]interface{}, error) {
	if task.Name == "" {
		return nil, fmt.Errorf("task name is required")
	}

	taskConfig, err := unmarshalTaskConfig(task.Kind, task.TaskConfig)
	if err != nil {
		return nil, fmt.Errorf("failed to unmarshal task '%s' config: %w", task.Name, err)
	}

	taskDef, err := c.convertTaskByKind(task.Kind, taskConfig)
	if err != nil {
		return nil, fmt.Errorf("task '%s': %w", task.Name, err)
	}

	if task.Export != nil && task.Export.As != "" {
		taskDef["export"] = map[string]interface{}{
			"as": task.Export.As,
		}
	}

	if task.Flow != nil && task.Flow.Then != "" {
		taskDef["then"] = task.Flow.Then
	}

	if len(task.Compensate) > 0 {
		compTasks, err := c.convertTaskList(task.Compensate)
		if err != nil {
			return nil, fmt.Errorf("task '%s' compensate: %w", task.Name, err)
		}
		metadata, _ := taskDef["metadata"].(map[string]interface{})
		if metadata == nil {
			metadata = map[string]interface{}{}
		}
		metadata["__stigmer_compensate"] = compTasks
		taskDef["metadata"] = metadata
	}

	return map[string]interface{}{task.Name: taskDef}, nil
}

func (c *Converter) convertTaskList(tasks []*workflowv1.WorkflowTask) ([]map[string]interface{}, error) {
	result := make([]map[string]interface{}, 0, len(tasks))
	for _, task := range tasks {
		yamlTask, err := c.convertTask(task)
		if err != nil {
			return nil, err
		}
		result = append(result, yamlTask)
	}
	return result, nil
}
