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

package validation

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

// UnmarshalTaskConfig unmarshals google.protobuf.Struct to typed proto message
// based on WorkflowTaskKind.
//
// Returns the appropriate proto message type:
// - set_vars → SetTaskConfig
// - http_call → HttpCallTaskConfig
// - grpc_call → GrpcCallTaskConfig
// - switch_case → SwitchTaskConfig
// - for_each → ForTaskConfig
// - fork → ForkTaskConfig
// - try_catch → TryTaskConfig
// - listen → ListenTaskConfig
// - wait → WaitTaskConfig
// - activity_call → CallActivityTaskConfig
// - raise_error → RaiseTaskConfig
// - run_workflow → RunTaskConfig
// - agent_call → AgentCallTaskConfig
// - llm_call → LlmCallTaskConfig
// - transform → TransformTaskConfig
// - human_input → HumanInputTaskConfig
// - validate → ValidateTaskConfig
// - emit_event → EmitEventTaskConfig
// - notification → NotificationTaskConfig
func UnmarshalTaskConfig(
	kind workflowv1.WorkflowTaskKind,
	config *structpb.Struct,
) (proto.Message, error) {
	if config == nil {
		return nil, fmt.Errorf("task_config cannot be nil")
	}

	// Convert Struct to JSON bytes
	jsonBytes, err := config.MarshalJSON()
	if err != nil {
		return nil, fmt.Errorf("failed to marshal Struct to JSON: %w", err)
	}

	// Create appropriate proto message based on kind
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

	// Normalize friendly enum shorthands before protojson deserialization.
	// protojson requires full enum names (e.g. "HARNESS_CURSOR") but users
	// write shorthand ("cursor", "native") in workflow YAML/JSON.
	jsonBytes = normalizeEnumShorthands(kind, jsonBytes)

	// Unmarshal JSON to proto message
	err = protojson.Unmarshal(jsonBytes, protoMsg)
	if err != nil {
		return nil, fmt.Errorf("failed to unmarshal JSON to proto: %w", err)
	}

	// Validate the unmarshaled proto message
	if err := ValidateTaskConfig(protoMsg); err != nil {
		return nil, err
	}

	return protoMsg, nil
}

// normalizeEnumShorthands rewrites user-friendly enum values to the full proto
// enum names that protojson expects. Only applies to task kinds that contain
// enum fields with known shorthands.
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
