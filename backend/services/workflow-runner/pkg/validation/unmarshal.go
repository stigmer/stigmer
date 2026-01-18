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
	"fmt"

	apiresourcev1 "github.com/leftbin/stigmer-cloud/apis/stubs/go/ai/stigmer/commons/apiresource"
	tasksv1 "github.com/leftbin/stigmer-cloud/apis/stubs/go/ai/stigmer/agentic/workflow/v1/tasks"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

// UnmarshalTaskConfig unmarshals google.protobuf.Struct to typed proto message
// based on WorkflowTaskKind.
//
// Returns the appropriate proto message type:
// - SET → SetTaskConfig
// - HTTP_CALL → HttpCallTaskConfig
// - GRPC_CALL → GrpcCallTaskConfig
// - SWITCH → SwitchTaskConfig
// - FOR → ForTaskConfig
// - FORK → ForkTaskConfig
// - TRY → TryTaskConfig
// - LISTEN → ListenTaskConfig
// - WAIT → WaitTaskConfig
// - CALL_ACTIVITY → CallActivityTaskConfig
// - RAISE → RaiseTaskConfig
// - RUN → RunTaskConfig
func UnmarshalTaskConfig(
	kind apiresourcev1.WorkflowTaskKind,
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
	case apiresourcev1.WorkflowTaskKind_WORKFLOW_TASK_KIND_SET:
		protoMsg = &tasksv1.SetTaskConfig{}

	case apiresourcev1.WorkflowTaskKind_WORKFLOW_TASK_KIND_HTTP_CALL:
		protoMsg = &tasksv1.HttpCallTaskConfig{}

	case apiresourcev1.WorkflowTaskKind_WORKFLOW_TASK_KIND_GRPC_CALL:
		protoMsg = &tasksv1.GrpcCallTaskConfig{}

	case apiresourcev1.WorkflowTaskKind_WORKFLOW_TASK_KIND_SWITCH:
		protoMsg = &tasksv1.SwitchTaskConfig{}

	case apiresourcev1.WorkflowTaskKind_WORKFLOW_TASK_KIND_FOR:
		protoMsg = &tasksv1.ForTaskConfig{}

	case apiresourcev1.WorkflowTaskKind_WORKFLOW_TASK_KIND_FORK:
		protoMsg = &tasksv1.ForkTaskConfig{}

	case apiresourcev1.WorkflowTaskKind_WORKFLOW_TASK_KIND_TRY:
		protoMsg = &tasksv1.TryTaskConfig{}

	case apiresourcev1.WorkflowTaskKind_WORKFLOW_TASK_KIND_LISTEN:
		protoMsg = &tasksv1.ListenTaskConfig{}

	case apiresourcev1.WorkflowTaskKind_WORKFLOW_TASK_KIND_WAIT:
		protoMsg = &tasksv1.WaitTaskConfig{}

	case apiresourcev1.WorkflowTaskKind_WORKFLOW_TASK_KIND_CALL_ACTIVITY:
		protoMsg = &tasksv1.CallActivityTaskConfig{}

	case apiresourcev1.WorkflowTaskKind_WORKFLOW_TASK_KIND_RAISE:
		protoMsg = &tasksv1.RaiseTaskConfig{}

	case apiresourcev1.WorkflowTaskKind_WORKFLOW_TASK_KIND_RUN:
		protoMsg = &tasksv1.RunTaskConfig{}

	default:
		return nil, fmt.Errorf("unsupported task kind: %v", kind)
	}

	// Unmarshal JSON to proto message
	err = protojson.Unmarshal(jsonBytes, protoMsg)
	if err != nil {
		return nil, fmt.Errorf("failed to unmarshal JSON to proto: %w", err)
	}

	return protoMsg, nil
}
