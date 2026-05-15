package workflows

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"google.golang.org/protobuf/encoding/protojson"

	"github.com/stigmer/stigmer/mcp-server/internal/domains"
	workflowv1 "github.com/stigmer/stigmer/mcp-server/proto/ai/stigmer/agentic/workflow/v1"
	"github.com/stigmer/stigmer/mcp-server/internal/auth"
	stigmergrpc "github.com/stigmer/stigmer/mcp-server/internal/grpc"

	"gopkg.in/yaml.v3"
)

// --- validate_workflow_yaml ---

// ValidateWorkflowYamlInput defines the parameters for the "validate_workflow_yaml" tool.
type ValidateWorkflowYamlInput struct {
	YAML string `json:"yaml" jsonschema:"Complete Stigmer workflow YAML content to validate (apiVersion, kind, metadata, spec)."`
}

// ValidateWorkflowYamlTool returns the MCP tool definition for registration.
func ValidateWorkflowYamlTool() *mcp.Tool {
	return &mcp.Tool{
		Name: "validate_workflow_yaml",
		Description: "Validate a Stigmer workflow YAML for structural and semantic correctness. " +
			"Uses the same Temporal-based validation pipeline as workflow create/update. " +
			"Returns validation state (VALID/INVALID/FAILED), errors, warnings, and the generated internal YAML.",
	}
}

// ValidateWorkflowYamlHandler returns the typed tool handler.
func ValidateWorkflowYamlHandler(serverAddress string) func(context.Context, *mcp.CallToolRequest, *ValidateWorkflowYamlInput) (*mcp.CallToolResult, any, error) {
	return func(ctx context.Context, _ *mcp.CallToolRequest, input *ValidateWorkflowYamlInput) (*mcp.CallToolResult, any, error) {
		if strings.TrimSpace(input.YAML) == "" {
			return nil, nil, fmt.Errorf("yaml is required")
		}

		workflow, err := parseWorkflowYAML(input.YAML)
		if err != nil {
			return nil, nil, fmt.Errorf("failed to parse workflow YAML: %w", err)
		}

		conn, err := stigmergrpc.NewConnection(serverAddress, auth.APIKey(ctx))
		if err != nil {
			return nil, nil, fmt.Errorf("validate_workflow_yaml: %w", err)
		}
		defer conn.Close()

		rpcCtx, cancel := context.WithTimeout(ctx, stigmergrpc.DefaultRPCTimeout)
		defer cancel()

		client := workflowv1.NewWorkflowCommandControllerClient(conn)
		validation, err := client.ValidateSpec(rpcCtx, workflow)
		if err != nil {
			return nil, nil, domains.RPCError(err, "workflow validation")
		}

		text, err := domains.MarshalJSON(validation)
		if err != nil {
			return nil, nil, err
		}
		return domains.TextResult(text)
	}
}

// taskKindNameToEnum maps YAML task kind string names to their proto enum string
// representations accepted by protojson.
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
}

// parseWorkflowYAML converts a Stigmer workflow YAML string to a Workflow proto.
//
// The YAML format has apiVersion/kind/metadata/spec structure. The spec contains
// tasks with string kind names that need to be mapped to proto enum values.
// task_config is a google.protobuf.Struct which round-trips through JSON naturally.
func parseWorkflowYAML(yamlContent string) (*workflowv1.Workflow, error) {
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
		for i, t := range tasks {
			task, ok := t.(map[string]interface{})
			if !ok {
				continue
			}
			kindStr, _ := task["kind"].(string)
			if kindStr != "" {
				enumName, valid := taskKindNameToEnum[kindStr]
				if !valid {
					return nil, fmt.Errorf("unknown task kind %q at tasks[%d]", kindStr, i)
				}
				task["kind"] = enumName
			}
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
