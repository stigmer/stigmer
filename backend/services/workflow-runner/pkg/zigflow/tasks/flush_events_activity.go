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

package tasks

import (
	"context"
	"fmt"

	wfexecv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	"github.com/stigmer/stigmer/backend/services/workflow-runner/pkg/grpc_client"
	"google.golang.org/protobuf/encoding/protojson"
)

// FlushEventsInput is the input for the FlushEventsActivity.
//
// Events and tasks are carried as protojson-encoded byte slices rather than raw
// protobuf messages. This is necessary because Temporal's default Go data
// converter uses encoding/json for non-proto types, and encoding/json cannot
// round-trip protobuf oneof fields (they are Go interface types).
// Pre-serializing with protojson preserves type information across the
// Temporal boundary.
type FlushEventsInput struct {
	ExecutionID string   `json:"execution_id"`
	EventsJSON  [][]byte `json:"events_json"`
	TasksJSON   [][]byte `json:"tasks_json,omitempty"`
}

// NewFlushEventsInput creates a FlushEventsInput by serializing events and
// an optional task status snapshot with protojson.
func NewFlushEventsInput(
	executionID string,
	events []*wfexecv1.WorkflowExecutionEvent,
	tasks []*wfexecv1.WorkflowTask,
) (*FlushEventsInput, error) {
	marshaler := protojson.MarshalOptions{UseProtoNames: true}

	encodedEvents := make([][]byte, 0, len(events))
	for i, ev := range events {
		b, err := marshaler.Marshal(ev)
		if err != nil {
			return nil, fmt.Errorf("failed to marshal event %d: %w", i, err)
		}
		encodedEvents = append(encodedEvents, b)
	}

	var encodedTasks [][]byte
	if len(tasks) > 0 {
		encodedTasks = make([][]byte, 0, len(tasks))
		for i, t := range tasks {
			b, err := marshaler.Marshal(t)
			if err != nil {
				return nil, fmt.Errorf("failed to marshal task %d: %w", i, err)
			}
			encodedTasks = append(encodedTasks, b)
		}
	}

	return &FlushEventsInput{
		ExecutionID: executionID,
		EventsJSON:  encodedEvents,
		TasksJSON:   encodedTasks,
	}, nil
}

// decodeEvents deserializes the protojson-encoded events back into proto messages.
func (f *FlushEventsInput) decodeEvents() ([]*wfexecv1.WorkflowExecutionEvent, error) {
	unmarshaler := protojson.UnmarshalOptions{DiscardUnknown: true}
	out := make([]*wfexecv1.WorkflowExecutionEvent, 0, len(f.EventsJSON))
	for i, raw := range f.EventsJSON {
		ev := &wfexecv1.WorkflowExecutionEvent{}
		if err := unmarshaler.Unmarshal(raw, ev); err != nil {
			return nil, fmt.Errorf("failed to unmarshal event %d: %w", i, err)
		}
		out = append(out, ev)
	}
	return out, nil
}

// decodeTasks deserializes the protojson-encoded tasks back into proto messages.
func (f *FlushEventsInput) decodeTasks() ([]*wfexecv1.WorkflowTask, error) {
	if len(f.TasksJSON) == 0 {
		return nil, nil
	}
	unmarshaler := protojson.UnmarshalOptions{DiscardUnknown: true}
	out := make([]*wfexecv1.WorkflowTask, 0, len(f.TasksJSON))
	for i, raw := range f.TasksJSON {
		t := &wfexecv1.WorkflowTask{}
		if err := unmarshaler.Unmarshal(raw, t); err != nil {
			return nil, fmt.Errorf("failed to unmarshal task %d: %w", i, err)
		}
		out = append(out, t)
	}
	return out, nil
}

// FlushEventsActivity sends accumulated workflow execution events to the
// backend via the updateStatus RPC. Runs as a Temporal activity so it can
// make gRPC calls (workflow code is deterministic and cannot do I/O).
//
// When a task status snapshot is included, it is sent as part of the status
// update so the server-side status.tasks list stays in sync with the event log.
func FlushEventsActivity(ctx context.Context, input *FlushEventsInput) error {
	if input == nil || len(input.EventsJSON) == 0 {
		return nil
	}

	events, err := input.decodeEvents()
	if err != nil {
		return fmt.Errorf("failed to decode events for execution %s: %w", input.ExecutionID, err)
	}

	tasks, err := input.decodeTasks()
	if err != nil {
		return fmt.Errorf("failed to decode tasks for execution %s: %w", input.ExecutionID, err)
	}

	client, err := grpc_client.GetWorkflowExecutionCommandClient()
	if err != nil {
		return fmt.Errorf("failed to get workflow execution client: %w", err)
	}

	var status *wfexecv1.WorkflowExecutionStatus
	if len(tasks) > 0 {
		status = &wfexecv1.WorkflowExecutionStatus{
			Phase: wfexecv1.ExecutionPhase_EXECUTION_IN_PROGRESS,
			Tasks: tasks,
		}
	}

	_, err = client.UpdateStatusWithEvents(ctx, input.ExecutionID, status, events)
	if err != nil {
		return fmt.Errorf("failed to flush %d events for execution %s: %w",
			len(events), input.ExecutionID, err)
	}

	return nil
}

func init() {
	activitiesRegistry = append(activitiesRegistry, FlushEventsActivity)
}
