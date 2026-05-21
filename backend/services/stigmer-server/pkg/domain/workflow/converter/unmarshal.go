package converter

import (
	"encoding/json"
	"fmt"
	"strings"

	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	tasksv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1/tasks"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

// UnmarshalTaskConfigPublic is the exported version of unmarshalTaskConfig for
// use by the validation package (budget warnings need typed task configs).
func UnmarshalTaskConfigPublic(
	kind workflowv1.WorkflowTaskKind,
	config *structpb.Struct,
) (proto.Message, error) {
	return unmarshalTaskConfig(kind, config)
}

// unmarshalTaskConfig converts google.protobuf.Struct to the typed proto message
// determined by WorkflowTaskKind. This allows type-safe access to task-specific
// fields during conversion.
func unmarshalTaskConfig(
	kind workflowv1.WorkflowTaskKind,
	config *structpb.Struct,
) (proto.Message, error) {
	if config == nil {
		return nil, fmt.Errorf("task_config cannot be nil")
	}

	jsonBytes, err := config.MarshalJSON()
	if err != nil {
		return nil, fmt.Errorf("failed to marshal Struct to JSON: %w", err)
	}

	var protoMsg proto.Message

	switch kind {
	case workflowv1.WorkflowTaskKind_set_vars:
		protoMsg = &tasksv1.SetTaskConfig{}
	case workflowv1.WorkflowTaskKind_http_call:
		protoMsg = &tasksv1.HttpCallTaskConfig{}
	case workflowv1.WorkflowTaskKind_grpc_call:
		protoMsg = &tasksv1.GrpcCallTaskConfig{}
	case workflowv1.WorkflowTaskKind_switch_case:
		protoMsg = &tasksv1.SwitchTaskConfig{}
	case workflowv1.WorkflowTaskKind_for_each:
		protoMsg = &tasksv1.ForTaskConfig{}
	case workflowv1.WorkflowTaskKind_fork:
		protoMsg = &tasksv1.ForkTaskConfig{}
	case workflowv1.WorkflowTaskKind_try_catch:
		protoMsg = &tasksv1.TryTaskConfig{}
	case workflowv1.WorkflowTaskKind_listen:
		protoMsg = &tasksv1.ListenTaskConfig{}
	case workflowv1.WorkflowTaskKind_wait:
		protoMsg = &tasksv1.WaitTaskConfig{}
	case workflowv1.WorkflowTaskKind_activity_call:
		protoMsg = &tasksv1.CallActivityTaskConfig{}
	case workflowv1.WorkflowTaskKind_raise_error:
		protoMsg = &tasksv1.RaiseTaskConfig{}
	case workflowv1.WorkflowTaskKind_run_workflow:
		protoMsg = &tasksv1.RunTaskConfig{}
	case workflowv1.WorkflowTaskKind_agent_call:
		protoMsg = &tasksv1.AgentCallTaskConfig{}
	case workflowv1.WorkflowTaskKind_llm_call:
		protoMsg = &tasksv1.LlmCallTaskConfig{}
	case workflowv1.WorkflowTaskKind_transform:
		protoMsg = &tasksv1.TransformTaskConfig{}
	case workflowv1.WorkflowTaskKind_human_input:
		protoMsg = &tasksv1.HumanInputTaskConfig{}
	case workflowv1.WorkflowTaskKind_validate:
		protoMsg = &tasksv1.ValidateTaskConfig{}
	case workflowv1.WorkflowTaskKind_emit_event:
		protoMsg = &tasksv1.EmitEventTaskConfig{}
	case workflowv1.WorkflowTaskKind_notification:
		protoMsg = &tasksv1.NotificationTaskConfig{}
	case workflowv1.WorkflowTaskKind_eval:
		protoMsg = &tasksv1.EvalTaskConfig{}
	default:
		return nil, fmt.Errorf("unsupported task kind: %v", kind)
	}

	jsonBytes = normalizeEnumShorthands(kind, jsonBytes)

	if err := protojson.Unmarshal(jsonBytes, protoMsg); err != nil {
		return nil, fmt.Errorf("failed to unmarshal JSON to proto: %w", err)
	}

	return protoMsg, nil
}

// normalizeEnumShorthands rewrites user-friendly enum values (e.g. "cursor")
// to the full proto enum names (e.g. "HARNESS_CURSOR") that protojson expects.
func normalizeEnumShorthands(kind workflowv1.WorkflowTaskKind, jsonBytes []byte) []byte {
	if kind != workflowv1.WorkflowTaskKind_agent_call {
		return jsonBytes
	}

	var m map[string]interface{}
	if err := json.Unmarshal(jsonBytes, &m); err != nil {
		return jsonBytes
	}

	changed := false

	if h, ok := m["harness"]; ok {
		if hs, isStr := h.(string); isStr {
			switch strings.ToLower(hs) {
			case "native":
				m["harness"] = "HARNESS_NATIVE"
				changed = true
			case "cursor":
				m["harness"] = "HARNESS_CURSOR"
				changed = true
			}
		}
	}

	if !changed {
		return jsonBytes
	}

	out, err := json.Marshal(m)
	if err != nil {
		return jsonBytes
	}
	return out
}
