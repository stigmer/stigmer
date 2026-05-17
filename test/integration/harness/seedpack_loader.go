package harness

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"

	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	"google.golang.org/protobuf/encoding/protojson"
	"gopkg.in/yaml.v3"
)

// taskKindNameToEnum maps YAML task kind string names to their proto enum
// string representations accepted by protojson. Kept in sync with the
// canonical map in mcp-server/internal/domains/workflows/validate.go.
var taskKindNameToEnum = map[string]string{
	"set_vars":      "set_vars",
	"http_call":     "http_call",
	"grpc_call":     "grpc_call",
	"activity_call": "activity_call",
	"switch_case":   "switch_case",
	"for_each":      "for_each",
	"fork":          "fork",
	"try_catch":     "try_catch",
	"listen":        "listen",
	"wait":          "wait",
	"raise_error":   "raise_error",
	"run_workflow":  "run_workflow",
	"agent_call":    "agent_call",
	"llm_call":      "llm_call",
	"transform":     "transform",
	"human_input":   "human_input",
	"validate":      "validate",
	"emit_event":    "emit_event",
	"notification":  "notification",
	"eval":          "eval",
}

// seedpackRoot returns the absolute path to the seedpack directory,
// resolved relative to this source file's location.
func seedpackRoot() string {
	_, thisFile, _, _ := runtime.Caller(0)
	return filepath.Join(filepath.Dir(thisFile), "..", "..", "..", "seedpack")
}

// LoadSeedpackWorkflow reads a workflow YAML from the seedpack/workflows/
// directory and returns the parsed Workflow proto.
func LoadSeedpackWorkflow(filename string) (*workflowv1.Workflow, error) {
	path := filepath.Join(seedpackRoot(), "workflows", filename)
	return LoadWorkflowFromYAML(path)
}

// LoadWorkflowFromYAML reads a workflow YAML file from disk and parses it
// into a Workflow proto. Uses the same YAML->JSON->protojson approach as
// the MCP server's parseWorkflowYAML.
func LoadWorkflowFromYAML(path string) (*workflowv1.Workflow, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read workflow YAML %s: %w", path, err)
	}
	return ParseWorkflowYAML(string(data))
}

// ParseWorkflowYAML converts a Stigmer workflow YAML string to a Workflow
// proto. The YAML uses apiVersion/kind/metadata/spec structure with string
// task kind names that are mapped to proto enum values.
func ParseWorkflowYAML(yamlContent string) (*workflowv1.Workflow, error) {
	var raw map[string]interface{}
	if err := yaml.Unmarshal([]byte(yamlContent), &raw); err != nil {
		return nil, fmt.Errorf("invalid YAML syntax: %w", err)
	}

	spec, ok := raw["spec"].(map[string]interface{})
	if !ok {
		return nil, fmt.Errorf("missing or invalid 'spec' field")
	}

	tasks, ok := spec["tasks"].([]interface{})
	if ok {
		if err := mapTaskKinds(tasks); err != nil {
			return nil, err
		}
	}

	jsonBytes, err := json.Marshal(raw)
	if err != nil {
		return nil, fmt.Errorf("failed to convert to JSON: %w", err)
	}

	workflow := &workflowv1.Workflow{}
	unmarshaler := protojson.UnmarshalOptions{DiscardUnknown: true}
	if err := unmarshaler.Unmarshal(jsonBytes, workflow); err != nil {
		return nil, fmt.Errorf("failed to unmarshal into Workflow proto: %w", err)
	}

	return workflow, nil
}

// mapTaskKinds recursively converts string task kind names to proto enum
// values in a task list. Only top-level tasks need mapping since nested
// tasks within task_config (e.g., fork branches) are part of
// google.protobuf.Struct and pass through as raw strings.
func mapTaskKinds(tasks []interface{}) error {
	for i, t := range tasks {
		task, ok := t.(map[string]interface{})
		if !ok {
			continue
		}
		kindStr, _ := task["kind"].(string)
		if kindStr != "" {
			enumName, valid := taskKindNameToEnum[kindStr]
			if !valid {
				return fmt.Errorf("unknown task kind %q at tasks[%d]", kindStr, i)
			}
			task["kind"] = enumName
		}
	}
	return nil
}
